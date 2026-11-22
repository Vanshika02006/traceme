// Orchestrates one scan: parse inputs → discover accounts → follow links one hop →
// extract entities (NLP) → match identities → classify risk.
import { PLATFORMS, DECLARED_ONLY, lookup, platformName } from './platforms.js';
import { parseInput, parseProfileUrl } from './urlParser.js';
import { extractEntities, mergeEntities } from './nlp.js';
import { matchIdentities } from './matching.js';
import { analyzeActivity } from './activity.js';
import { classifyRisk } from './risk.js';
import { mapLimit } from './http.js';

export const MAX_INPUTS = 5;
const key = (platform, username) => `${platform}:${String(username).toLowerCase().replace(/\.bsky\.social$/, '')}`;

/**
 * @param {{inputs: string[], fullName?: string, location?: string}} query
 * @param {{onProgress?: (e: {stage: string, done?: number, total?: number, result?: object}) => void}} [opts]
 */
export async function analyze({ inputs = [], fullName = '', location = '' }, { onProgress = () => {} } = {}) {
  const parsed = inputs.slice(0, MAX_INPUTS).map((raw) => ({ raw, parsed: parseInput(raw) }));
  const invalid = parsed.filter((p) => !p.parsed).map((p) => p.raw);
  const valid = parsed.map((p) => p.parsed).filter(Boolean);

  const usernames = [...new Set(valid.map((v) => v.username))];
  const claimed = new Set(valid.filter((v) => v.kind === 'url').map((v) => key(v.platform, v.username)));
  const declared = new Map(); // platform-only accounts we do not fetch
  valid.filter((v) => v.kind === 'url' && DECLARED_ONLY[v.platform]).forEach((v) => {
    declared.set(key(v.platform, v.username), { platform: v.platform, platformName: platformName(v.platform), username: v.username, url: DECLARED_ONLY[v.platform].profileUrl(v.username), via: 'you entered it' });
  });

  // 1. Username sweep across every supported platform.
  const tasks = [];
  const seen = new Set();
  for (const u of usernames) {
    for (const pid of Object.keys(PLATFORMS)) {
      const k = key(pid, u);
      if (!seen.has(k)) { seen.add(k); tasks.push({ pid, u, via: null }); }
    }
  }
  // URL inputs might use a username that differs only by case/format; make sure they are looked up.
  valid.filter((v) => v.kind === 'url' && PLATFORMS[v.platform]).forEach((v) => {
    const k = key(v.platform, v.username);
    if (!seen.has(k)) { seen.add(k); tasks.push({ pid: v.platform, u: v.username, via: null }); }
  });

  let done = 0;
  const run = (stage, total) => async (t) => {
    const r = { ...(await lookup(t.pid, t.u)), via: t.via };
    onProgress({ stage, done: ++done, total, result: { platform: r.platform, platformName: r.platformName, status: r.status, query: r.query } });
    return r;
  };
  onProgress({ stage: 'discover', done: 0, total: tasks.length });
  const results = await mapLimit(tasks, 8, run('discover', tasks.length));

  // 2. Follow account links found in profiles (one hop).
  const hop = [];
  for (const r of results.filter((x) => x.status === 'found')) {
    for (const link of r.profile.links) {
      const p = parseProfileUrl(link);
      if (!p) continue;
      const k = key(p.platform, p.username);
      if (PLATFORMS[p.platform] && !seen.has(k)) { seen.add(k); hop.push({ pid: p.platform, u: p.username, via: r.platformName }); }
      else if (DECLARED_ONLY[p.platform] && !declared.has(k)) {
        declared.set(k, { platform: p.platform, platformName: platformName(p.platform), username: p.username, url: link, via: `linked from ${r.platformName}` });
      }
    }
  }
  const hopTasks = hop.slice(0, 10);
  done = 0;
  onProgress({ stage: 'links', done: 0, total: hopTasks.length });
  const hopResults = await mapLimit(hopTasks, 6, run('links', hopTasks.length));
  const all = [...results, ...hopResults];

  // 3. Normalise found profiles.
  const byKey = new Map();
  for (const r of all.filter((x) => x.status === 'found')) {
    const k = key(r.platform, r.profile.username);
    if (!byKey.has(k)) byKey.set(k, { id: k, via: r.via, ...r.profile });
  }
  const profiles = [...byKey.values()];
  // Treat a URL input as claimed even if the API returned the canonical-cased username.
  const claimedIds = new Set(profiles.filter((p) => claimed.has(p.id)).map((p) => p.id));

  // 4. NLP entity extraction.
  onProgress({ stage: 'extract' });
  const entities = mergeEntities(profiles.flatMap(extractEntities));

  // 5. Identity matching.
  onProgress({ stage: 'match' });
  const matching = matchIdentities(profiles, claimedIds, { fullName: fullName.trim(), location: location.trim() });

  // 6. Activity analysis (most confident GitHub profile).
  const gh = profiles.filter((p) => p.platform === 'github').sort((a, b) => matching.confidence[b.id].score - matching.confidence[a.id].score)[0];
  const activity = gh?.activity?.length ? analyzeActivity(gh.activity) : null;

  // 7. Risk classification.
  onProgress({ stage: 'risk' });
  const risk = classifyRisk({ profiles, entities, matching, activity });

  return {
    generatedAt: new Date().toISOString(),
    query: { usernames, invalid, fullNameProvided: !!fullName.trim(), locationProvided: !!location.trim() },
    summary: {
      platformsChecked: Object.keys(PLATFORMS).length,
      lookups: all.length,
      accountsFound: profiles.length,
      likelyYou: profiles.filter((p) => matching.confidence[p.id].score >= 0.75).length,
      unknown: all.filter((r) => r.status === 'unknown').length,
      entities: entities.length,
      declaredAccounts: declared.size,
    },
    profiles: profiles.map(({ activity: _a, ...p }) => ({ ...p, match: matching.confidence[p.id] })),
    notFound: all.filter((r) => r.status === 'not_found').map((r) => ({ platform: r.platform, platformName: r.platformName, query: r.query })),
    unknown: all.filter((r) => r.status === 'unknown').map((r) => ({ platform: r.platform, platformName: r.platformName, query: r.query, reason: r.reason, checkUrl: r.checkUrl })),
    declared: [...declared.values()],
    entities,
    graph: { nodes: profiles.map((p) => ({ id: p.id, platform: p.platform, label: p.platformName, username: p.username, confidence: matching.confidence[p.id].score })), edges: matching.edges, clusters: matching.clusters },
    activity,
    risk,
  };
}
