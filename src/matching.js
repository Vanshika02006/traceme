// Entity matching: decides which discovered accounts most likely belong to the
// same person. Each pairwise comparison produces explainable evidence that is
// combined with a noisy-OR (independent signals that each "vote" for a match),
// then damped by conflicting evidence (different real names, different cities).
import { parseProfileUrl } from './urlParser.js';
import { tokens, norm } from './nlp.js';

export function jaroWinkler(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const am = new Array(a.length).fill(false);
  const bm = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j++) {
      if (!bm[j] && a[i] === b[j]) { am[i] = bm[j] = true; matches++; break; }
    }
  }
  if (!matches) return 0;
  let t = 0;
  for (let i = 0, k = 0; i < a.length; i++) {
    if (!am[i]) continue;
    while (!bm[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

const handleKey = (u) => String(u || '').toLowerCase().replace(/\.bsky\.social$/, '').replace(/[^a-z0-9]/g, '');

/** Similarity of two personal names, tolerant of order, initials and diacritics. */
export function nameSimilarity(a, b) {
  const t = (s) => norm(s).normalize('NFD').replace(/\p{M}/gu, '').split(/[\s.-]+/).filter(Boolean);
  const ta = t(a), tb = t(b);
  if (!ta.length || !tb.length) return 0;
  let score = 0;
  for (const x of ta) {
    let best = 0;
    for (const y of tb) {
      const s = x.length === 1 || y.length === 1 ? (x[0] === y[0] ? 0.8 : 0) : jaroWinkler(x, y);
      best = Math.max(best, s);
    }
    score += best >= 0.85 ? best : 0; // unrelated short words still score ~0.5 on Jaro-Winkler
  }
  return score / Math.max(ta.length, tb.length);
}

function locationOverlap(a, b) {
  const ta = new Set(norm(a).split(/[\s,]+/).filter((x) => x.length > 1));
  const tb = new Set(norm(b).split(/[\s,]+/).filter((x) => x.length > 1));
  if (!ta.size || !tb.size) return 0;
  const inter = [...ta].filter((x) => tb.has(x)).length;
  return inter / Math.min(ta.size, tb.size);
}

const PLATFORM_HOSTS = /(github|gitlab|twitter|x|linkedin|instagram|facebook|keybase|mastodon|bsky|dev|chess|lichess|codeforces|npmjs|reddit|youtube|medium|tiktok|docker|duolingo|wikipedia|ycombinator)\./;
const siteHosts = (p) =>
  new Set(
    [p.website, ...p.links]
      .filter(Boolean)
      .map((l) => { try { return new URL(/^https?:/.test(l) ? l : `https://${l}`).hostname.replace(/^www\./, ''); } catch { return null; } })
      .filter((h) => h && !PLATFORM_HOSTS.test(h)),
  );

function linksTo(from, to) {
  return from.links.some((l) => {
    const parsed = parseProfileUrl(l);
    return parsed && parsed.platform === to.platform && handleKey(parsed.username) === handleKey(to.username);
  });
}

// TF-IDF over all bios so common words carry little weight.
function buildTfidf(profiles) {
  const docs = profiles.map((p) => tokens([p.bio, ...p.extraText].join(' ')));
  const df = new Map();
  docs.forEach((d) => new Set(d).forEach((t) => df.set(t, (df.get(t) || 0) + 1)));
  const N = docs.length;
  return docs.map((d) => {
    const tf = new Map();
    d.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
    const v = new Map();
    tf.forEach((c, t) => v.set(t, (c / d.length) * Math.log(1 + N / df.get(t))));
    return v;
  });
}
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  a.forEach((x, t) => { na += x * x; if (b.has(t)) dot += x * b.get(t); });
  b.forEach((x) => { nb += x * x; });
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

const noisyOr = (ws) => 1 - ws.reduce((acc, w) => acc * (1 - Math.max(0, Math.min(1, w))), 1);

export function compareProfiles(a, b, va, vb) {
  const evidence = [];
  const penalties = [];

  if (linksTo(a, b) || linksTo(b, a)) evidence.push({ signal: 'Profiles link to each other', weight: 0.95 });

  const sharedEmails = a.emails.filter((e) => b.emails.map((x) => x.toLowerCase()).includes(e.toLowerCase()));
  if (sharedEmails.length) evidence.push({ signal: `Same public email (${sharedEmails[0]})`, weight: 0.9 });

  const ha = siteHosts(a), hb = siteHosts(b);
  const sharedSite = [...ha].find((h) => hb.has(h));
  if (sharedSite) evidence.push({ signal: `Same personal website (${sharedSite})`, weight: 0.75 });

  if (a.displayName && b.displayName) {
    const s = nameSimilarity(a.displayName, b.displayName);
    if (s >= 0.85) evidence.push({ signal: `Matching display name (“${a.displayName}” ≈ “${b.displayName}”)`, weight: 0.6 * s });
    else if (s < 0.5) penalties.push({ signal: `Different display names (“${a.displayName}” vs “${b.displayName}”)`, factor: 0.6 });
  }

  if (a.location && b.location) {
    const s = locationOverlap(a.location, b.location);
    if (s >= 0.5) evidence.push({ signal: `Same location (${a.location})`, weight: 0.3 * s });
    else if (s === 0) penalties.push({ signal: `Different locations (${a.location} vs ${b.location})`, factor: 0.8 });
  }

  const bio = cosine(va, vb);
  if (bio > 0.15) evidence.push({ signal: `Similar bio wording (${Math.round(bio * 100)}% overlap)`, weight: Math.min(0.5, bio * 0.6) });

  const ua = handleKey(a.username), ub = handleKey(b.username);
  if (ua === ub) evidence.push({ signal: 'Identical username', weight: 0.35 });
  else {
    const s = jaroWinkler(ua, ub);
    if (s > 0.85) evidence.push({ signal: `Similar usernames (${a.username} / ${b.username})`, weight: 0.3 * s });
  }

  const strong = evidence.some((e) => e.weight >= 0.9);
  const combine = (ev) => {
    let sc = noisyOr(ev.map((e) => e.weight));
    // Hard links (cross-links, shared email) are not overridden by soft conflicts.
    if (!strong) penalties.forEach((p) => { sc *= p.factor; });
    return sc;
  };
  // `scoreBeyondUsername` ignores the shared-username signal: every candidate already
  // shares the username, so confidence must come from *other* corroborating evidence.
  const beyond = evidence.filter((e) => !/username/i.test(e.signal));
  return { score: combine(evidence), scoreBeyondUsername: beyond.length ? combine(beyond) : 0, evidence, penalties, beyond };
}

function seedMatch(p, seed) {
  const evidence = [];
  const penalties = [];
  if (seed.fullName && p.displayName) {
    const s = nameSimilarity(seed.fullName, p.displayName);
    if (s >= 0.8) evidence.push({ signal: `Display name matches your name`, weight: 0.75 * s });
    else if (s < 0.5) penalties.push({ signal: `Display name “${p.displayName}” doesn't match your name`, factor: 0.45 });
  }
  if (seed.location && p.location) {
    const s = locationOverlap(seed.location, p.location);
    if (s >= 0.5) evidence.push({ signal: 'Location matches yours', weight: 0.35 });
    else penalties.push({ signal: `Location “${p.location}” differs from yours`, factor: 0.75 });
  }
  return { evidence, penalties };
}

/**
 * @param profiles normalised profiles (each has .id)
 * @param claimedIds ids of profiles the user explicitly gave as URLs
 * @param seed { fullName?, location? }
 */
export function matchIdentities(profiles, claimedIds = new Set(), seed = {}) {
  const vectors = buildTfidf(profiles);
  const edges = [];
  const pair = new Map();
  for (let i = 0; i < profiles.length; i++) {
    for (let j = i + 1; j < profiles.length; j++) {
      const r = compareProfiles(profiles[i], profiles[j], vectors[i], vectors[j]);
      pair.set(`${i}|${j}`, r);
      if (r.score >= 0.3) edges.push({ source: profiles[i].id, target: profiles[j].id, score: +r.score.toFixed(3), evidence: r.evidence.map((e) => e.signal), penalties: r.penalties.map((p) => p.signal) });
    }
  }
  const get = (i, j) => pair.get(i < j ? `${i}|${j}` : `${j}|${i}`);

  const confidence = {};
  profiles.forEach((p, i) => {
    if (claimedIds.has(p.id)) {
      confidence[p.id] = { score: 1, label: 'You (provided)', reasons: ['You entered this profile URL'] };
      return;
    }
    const reasons = ['Matches a username you entered'];
    const weights = [0.3];
    let bestClaimed = 0, bestClaimedWhy = null, bestOther = 0, bestOtherWhy = null;
    const conflicts = [];
    profiles.forEach((q, j) => {
      if (i === j) return;
      const r = get(i, j);
      const s = r.scoreBeyondUsername;
      if (claimedIds.has(q.id)) {
        if (s > bestClaimed) { bestClaimed = s; bestClaimedWhy = `${r.beyond[0]?.signal} with your ${q.platformName} profile`; }
        if (!r.beyond.length) r.penalties.forEach((pen) => conflicts.push({ ...pen, signal: `${pen.signal} vs your ${q.platformName}` }));
      } else if (s > bestOther) { bestOther = s; bestOtherWhy = `${r.beyond[0]?.signal} with ${q.platformName}`; }
    });
    if (bestClaimed > 0.2) { weights.push(bestClaimed); reasons.push(bestClaimedWhy); }
    if (bestOther > 0.2) { weights.push(0.6 * bestOther); reasons.push(bestOtherWhy); }
    const s = seedMatch(p, seed);
    s.evidence.forEach((e) => { weights.push(e.weight); reasons.push(e.signal); });
    let score = noisyOr(weights);
    [...s.penalties, ...conflicts.slice(0, 2)].forEach((pen) => { score *= pen.factor; reasons.push(`⚠ ${pen.signal}`); });
    const label = score >= 0.75 ? 'Likely you' : score >= 0.45 ? 'Possibly you' : 'Uncertain – may be someone else';
    confidence[p.id] = { score: +score.toFixed(3), label, reasons };
  });

  // Connected components over strong edges = linkable identity clusters.
  const parent = Object.fromEntries(profiles.map((p) => [p.id, p.id]));
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  edges.filter((e) => e.score >= 0.5).forEach((e) => { parent[find(e.source)] = find(e.target); });
  const clusters = {};
  profiles.forEach((p) => { (clusters[find(p.id)] ||= []).push(p.id); });

  return { edges, confidence, clusters: Object.values(clusters).sort((a, b) => b.length - a.length) };
}
