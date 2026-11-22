// Public-data connectors. Each one uses an official/public JSON endpoint that
// requires no login and allows cross-origin requests (the app runs entirely in
// the browser on GitHub Pages). A fetcher returns a normalised profile or throws NotFound.
import { getJson, NotFound, stripHtml } from './http.js';

const enc = encodeURIComponent;
const toIso = (v) => {
  if (v == null || v === '') return null;
  const d = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
/** Markdown/HTML README -> plain text (keeps URLs). */
export function stripMarkdown(md) {
  return stripHtml(String(md)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\(([^)]+)\)/g, ' ')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 $2')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/[*_`|]/g, ' '))
    .replace(/[ \t]+/g, ' ');
}
const clean = (arr) => [...new Set(arr.filter(Boolean).map((s) => String(s).trim()).filter(Boolean))];

function profile(base) {
  return {
    displayName: null, bio: null, location: null, company: null, website: null,
    emails: [], emailFields: {}, links: [], avatar: null, createdAt: null, stats: {}, activity: [], extraText: [],
    extraEntities: [], readme: null, privacy: {},
    ...base,
    emails: clean(base.emails || []),
    links: clean(base.links || []),
  };
}

// GitHub allows 60 unauthenticated requests/hour per IP. A visitor may supply their
// own token (kept in memory for this tab only) to raise that to 5,000/hour.
let githubToken = '';
export const setGithubToken = (t) => { githubToken = /^[A-Za-z0-9_]{20,255}$/.test(String(t || '').trim()) ? String(t).trim() : ''; };
const githubHeaders = () => (githubToken ? { Authorization: `Bearer ${githubToken}` } : {});

export const PLATFORMS = {
  github: {
    name: 'GitHub',
    profileUrl: (u) => `https://github.com/${u}`,
    async fetch(u) {
      const api = 'https://api.github.com';
      const d = await getJson(`${api}/users/${enc(u)}`, { headers: githubHeaders() });
      const login = d.login;
      // Everything below is optional public data: a failure just means less detail.
      const opt = (url) => getJson(url, { headers: githubHeaders() }).catch(() => null);
      const [events, repos, social, orgs, readme] = await Promise.all([
        opt(`${api}/users/${enc(login)}/events/public?per_page=100`),
        opt(`${api}/users/${enc(login)}/repos?per_page=100&sort=pushed`),
        opt(`${api}/users/${enc(login)}/social_accounts`),
        opt(`${api}/users/${enc(login)}/orgs`),
        opt(`${api}/repos/${enc(login)}/${enc(login)}/readme`),
      ]);
      const ownRepos = (repos || []).filter((r) => !r.fork);

      // Commit metadata is the classic leak: author name + email on every public commit.
      const commitRepos = ownRepos.slice(0, 3);
      const commitLists = await Promise.all(commitRepos.map((r) => opt(`${api}/repos/${enc(login)}/${enc(r.name)}/commits?author=${enc(login)}&per_page=30`)));
      const emailFields = {};
      const extraEntities = [];
      const commitDates = [];
      const noreply = new Set();
      commitLists.forEach((list, i) => {
        for (const c of list || []) {
          const a = c.commit?.author;
          if (!a) continue;
          if (a.date) commitDates.push(a.date);
          const email = String(a.email || '').toLowerCase();
          if (/noreply\.github\.com$/.test(email)) { noreply.add(email); continue; }
          if (email && !emailFields[email]) emailFields[email] = { field: 'commit author email', snippet: `Author of commits in ${login}/${commitRepos[i].name}` };
          if (a.name && !extraEntities.some((e) => e.value === a.name)) extraEntities.push({ type: 'commit_name', value: a.name, field: 'commit author name', snippet: `Author of commits in ${login}/${commitRepos[i].name}` });
        }
      });
      if (d.email) emailFields[d.email.toLowerCase()] = { field: 'public email field', snippet: d.email };
      for (const o of orgs || []) extraEntities.push({ type: 'organization', value: o.login, field: 'GitHub organisation', snippet: `Public member of github.com/${o.login}` });

      let readmeText = '';
      if (readme?.content) {
        try {
          const bytes = Uint8Array.from(atob(readme.content.replace(/\s/g, '')), (ch) => ch.charCodeAt(0));
          readmeText = stripMarkdown(new TextDecoder().decode(bytes)).slice(0, 6000);
        } catch { /* undecodable README */ }
      }
      const repoText = ownRepos.filter((r) => r.description).slice(0, 15).map((r) => `Repository ${r.name}: ${r.description}`);

      return profile({
        username: login, url: d.html_url, displayName: d.name, bio: d.bio, location: d.location,
        company: d.company, website: d.blog || null, emails: Object.keys(emailFields), emailFields,
        links: [
          d.blog, d.twitter_username && `https://x.com/${d.twitter_username}`,
          ...(social || []).map((s) => s.url),
          ...ownRepos.map((r) => r.homepage),
          ...(readmeText.match(/https?:\/\/[^\s)>\]"']+/g) || []),
        ],
        avatar: d.avatar_url, createdAt: toIso(d.created_at),
        readme: readmeText || null,
        extraText: repoText,
        extraEntities,
        privacy: { noreplyCommits: noreply.size > 0 },
        stats: { followers: d.followers, publicRepos: d.public_repos, commitsScanned: commitDates.length },
        activity: [...(events || []).map((e) => e.created_at), ...commitDates].filter(Boolean),
      });
    },
  },

  gitlab: {
    name: 'GitLab',
    profileUrl: (u) => `https://gitlab.com/${u}`,
    async fetch(u) {
      const list = await getJson(`https://gitlab.com/api/v4/users?username=${enc(u)}`);
      if (!list.length) throw new NotFound();
      const d = await getJson(`https://gitlab.com/api/v4/users/${list[0].id}`);
      return profile({
        username: d.username, url: d.web_url, displayName: d.name, bio: d.bio, location: d.location,
        company: d.organization, website: d.website_url || null, emails: [d.public_email],
        links: [d.website_url, d.twitter && `https://x.com/${d.twitter}`, d.linkedin && `https://linkedin.com/in/${d.linkedin}`],
        avatar: d.avatar_url, createdAt: toIso(d.created_at),
        extraText: [d.job_title && `Job title: ${d.job_title}`, d.pronouns && `Pronouns: ${d.pronouns}`],
        stats: { followers: d.followers },
      });
    },
  },

  hackernews: {
    name: 'Hacker News',
    profileUrl: (u) => `https://news.ycombinator.com/user?id=${u}`,
    async fetch(u) {
      const d = await getJson(`https://hacker-news.firebaseio.com/v0/user/${enc(u)}.json`);
      if (!d) throw new NotFound();
      const about = stripHtml(d.about);
      return profile({
        username: d.id, url: `https://news.ycombinator.com/user?id=${d.id}`, bio: about,
        links: about.match(/https?:\/\/\S+/g) || [], createdAt: toIso(d.created),
        stats: { karma: d.karma, submissions: d.submitted?.length || 0 },
      });
    },
  },

  devto: {
    name: 'DEV Community',
    profileUrl: (u) => `https://dev.to/${u}`,
    async fetch(u) {
      const d = await getJson(`https://dev.to/api/users/by_username?url=${enc(u)}`);
      return profile({
        username: d.username, url: `https://dev.to/${d.username}`, displayName: d.name, bio: d.summary,
        location: d.location, website: d.website_url || null,
        links: [d.website_url, d.twitter_username && `https://x.com/${d.twitter_username}`, d.github_username && `https://github.com/${d.github_username}`],
        avatar: d.profile_image, createdAt: toIso(d.joined_at),
      });
    },
  },

  keybase: {
    name: 'Keybase',
    profileUrl: (u) => `https://keybase.io/${u}`,
    async fetch(u) {
      const d = await getJson(`https://keybase.io/_/api/1.0/user/lookup.json?usernames=${enc(u)}&fields=basics,profile,proofs_summary,pictures`);
      const t = d.them?.[0];
      if (!t) throw new NotFound();
      const proofs = t.proofs_summary?.all || [];
      return profile({
        username: t.basics.username, url: `https://keybase.io/${t.basics.username}`,
        displayName: t.profile?.full_name, bio: t.profile?.bio, location: t.profile?.location,
        links: proofs.map((p) => p.service_url), avatar: t.pictures?.primary?.url,
        createdAt: toIso(t.basics.ctime), stats: { verifiedProofs: proofs.length },
      });
    },
  },

  chesscom: {
    name: 'Chess.com',
    profileUrl: (u) => `https://www.chess.com/member/${u}`,
    async fetch(u) {
      const d = await getJson(`https://api.chess.com/pub/player/${enc(u.toLowerCase())}`);
      const country = d.country ? d.country.split('/').pop() : null;
      return profile({
        username: d.username, url: d.url, displayName: d.name, location: [d.location, country].filter(Boolean).join(', ') || null,
        avatar: d.avatar, createdAt: toIso(d.joined), stats: { followers: d.followers, lastOnline: toIso(d.last_online) },
      });
    },
  },

  lichess: {
    name: 'Lichess',
    profileUrl: (u) => `https://lichess.org/@/${u}`,
    async fetch(u) {
      const d = await getJson(`https://lichess.org/api/user/${enc(u)}`);
      if (d.disabled || d.closed) throw new NotFound();
      const p = d.profile || {};
      return profile({
        username: d.username, url: d.url || `https://lichess.org/@/${d.username}`,
        displayName: p.realName || [p.firstName, p.lastName].filter(Boolean).join(' ') || null,
        bio: p.bio, location: [p.location, p.flag || p.country].filter(Boolean).join(', ') || null,
        links: (p.links || '').split(/\s+/), createdAt: toIso(d.createdAt), stats: { lastSeen: toIso(d.seenAt) },
      });
    },
  },

  codeforces: {
    name: 'Codeforces',
    profileUrl: (u) => `https://codeforces.com/profile/${u}`,
    async fetch(u) {
      const d = await getJson(`https://codeforces.com/api/user.info?handles=${enc(u)}`, { notFoundStatuses: [400, 404] });
      const r = d.result?.[0];
      if (d.status !== 'OK' || !r) throw new NotFound();
      return profile({
        username: r.handle, url: `https://codeforces.com/profile/${r.handle}`,
        displayName: [r.firstName, r.lastName].filter(Boolean).join(' ') || null,
        location: [r.city, r.country].filter(Boolean).join(', ') || null, company: r.organization || null,
        avatar: r.titlePhoto, createdAt: toIso(r.registrationTimeSeconds), stats: { rating: r.rating },
      });
    },
  },

  mastodon: {
    name: 'Mastodon (mastodon.social)',
    profileUrl: (u) => `https://mastodon.social/@${u}`,
    async fetch(u) {
      const d = await getJson(`https://mastodon.social/api/v1/accounts/lookup?acct=${enc(u)}`);
      const fields = (d.fields || []).map((f) => `${f.name}: ${stripHtml(f.value)}`);
      return profile({
        username: d.username, url: d.url, displayName: d.display_name, bio: stripHtml(d.note),
        links: (d.fields || []).map((f) => stripHtml(f.value)).filter((v) => /^https?:\/\//.test(v)),
        avatar: d.avatar, createdAt: toIso(d.created_at), extraText: fields,
        stats: { followers: d.followers_count, posts: d.statuses_count },
      });
    },
  },

  bluesky: {
    name: 'Bluesky',
    profileUrl: (u) => `https://bsky.app/profile/${u.includes('.') ? u : `${u}.bsky.social`}`,
    async fetch(u) {
      const handle = u.includes('.') ? u : `${u}.bsky.social`;
      const d = await getJson(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${enc(handle)}`, { notFoundStatuses: [400, 404] });
      return profile({
        username: d.handle, url: `https://bsky.app/profile/${d.handle}`, displayName: d.displayName,
        bio: d.description, links: (d.description || '').match(/https?:\/\/\S+/g) || [],
        avatar: d.avatar, createdAt: toIso(d.createdAt), stats: { followers: d.followersCount, posts: d.postsCount },
      });
    },
  },

  npm: {
    name: 'npm',
    profileUrl: (u) => `https://www.npmjs.com/~${u}`,
    async fetch(u) {
      const d = await getJson(`https://registry.npmjs.org/-/v1/search?text=maintainer:${enc(u)}&size=25`);
      const pkgs = (d.objects || []).map((o) => o.package);
      const mine = pkgs.filter((p) => (p.maintainers || []).some((m) => m.username?.toLowerCase() === u.toLowerCase()));
      if (!mine.length) throw new NotFound();
      const emails = mine.flatMap((p) => (p.maintainers || []).filter((m) => m.username?.toLowerCase() === u.toLowerCase()).map((m) => m.email));
      return profile({
        username: u, url: `https://www.npmjs.com/~${u}`, emails,
        links: mine.map((p) => p.links?.repository).filter(Boolean).slice(0, 10),
        extraText: mine.map((p) => p.description).filter(Boolean).slice(0, 10),
        stats: { packages: mine.length },
      });
    },
  },

  wikipedia: {
    name: 'Wikipedia',
    profileUrl: (u) => `https://en.wikipedia.org/wiki/User:${u}`,
    async fetch(u) {
      const d = await getJson(`https://en.wikipedia.org/w/api.php?action=query&list=users&ususers=${enc(u)}&usprop=registration|editcount&format=json&origin=*`);
      const r = d.query?.users?.[0];
      if (!r || 'missing' in r || 'invalid' in r) throw new NotFound();
      return profile({
        username: r.name, url: `https://en.wikipedia.org/wiki/User:${enc(r.name)}`,
        createdAt: toIso(r.registration), stats: { edits: r.editcount },
      });
    },
  },
};

// Platforms we recognise from URLs but never fetch: login walls, scraping
// prohibited, or no CORS support for a browser-only app.
export const DECLARED_ONLY = {
  reddit: { name: 'Reddit', profileUrl: (u) => `https://www.reddit.com/user/${u}` },
  dockerhub: { name: 'Docker Hub', profileUrl: (u) => `https://hub.docker.com/u/${u}` },
  duolingo: { name: 'Duolingo', profileUrl: (u) => `https://www.duolingo.com/profile/${u}` },
  twitter: { name: 'X (Twitter)', profileUrl: (u) => `https://x.com/${u}` },
  instagram: { name: 'Instagram', profileUrl: (u) => `https://instagram.com/${u}` },
  linkedin: { name: 'LinkedIn', profileUrl: (u) => `https://linkedin.com/in/${u}` },
  facebook: { name: 'Facebook', profileUrl: (u) => `https://facebook.com/${u}` },
  tiktok: { name: 'TikTok', profileUrl: (u) => `https://tiktok.com/@${u}` },
  youtube: { name: 'YouTube', profileUrl: (u) => `https://youtube.com/@${u}` },
  medium: { name: 'Medium', profileUrl: (u) => `https://medium.com/@${u}` },
  threads: { name: 'Threads', profileUrl: (u) => `https://threads.net/@${u}` },
  pinterest: { name: 'Pinterest', profileUrl: (u) => `https://pinterest.com/${u}` },
};

export function platformName(id) {
  return PLATFORMS[id]?.name || DECLARED_ONLY[id]?.name || (id === 'gravatar' ? 'Gravatar' : id);
}

function describeError(e) {
  if (e.rateLimitReset) return `rate limit reached, try again after ${e.rateLimitReset.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  if (e.status === 429 || e.status === 403) return 'rate-limited or blocked';
  if (e.name === 'TimeoutError') return 'timed out';
  if (e.name === 'TypeError') return 'blocked by the browser or offline';
  return e.message;
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Gravatar is keyed by email (SHA-256 hash), not username. Never throws. */
export async function lookupGravatar(email) {
  const base = { platform: 'gravatar', platformName: 'Gravatar', query: email };
  try {
    const hash = await sha256Hex(email.trim().toLowerCase());
    const d = await getJson(`https://api.gravatar.com/v3/profiles/${hash}`);
    const handle = (d.profile_url || '').split('/').pop() || hash.slice(0, 12);
    return {
      ...base,
      status: 'found',
      profile: {
        platform: 'gravatar', platformName: 'Gravatar',
        ...profile({
          username: handle, url: d.profile_url, displayName: d.display_name || null, bio: d.description || null,
          location: d.location || null, company: d.company || null,
          emails: [email], emailFields: { [email]: { field: 'Gravatar email hash', snippet: 'Profile registered to this email' } },
          links: [...(d.verified_accounts || []).map((a) => a.url), ...(d.links || []).map((l) => l.url)],
          avatar: d.avatar_url || null,
          extraText: [d.job_title && `Job title: ${d.job_title}`, d.pronouns && `Pronouns: ${d.pronouns}`].filter(Boolean),
          stats: { verifiedAccounts: (d.verified_accounts || []).length },
        }),
      },
    };
  } catch (e) {
    if (e instanceof NotFound) return { ...base, status: 'not_found' };
    return { ...base, status: 'unknown', reason: describeError(e), checkUrl: 'https://gravatar.com' };
  }
}

/** Look up one username on one platform. Never throws. */
export async function lookup(platformId, username) {
  const p = PLATFORMS[platformId];
  const base = { platform: platformId, platformName: p.name, query: username };
  try {
    const data = await p.fetch(username);
    return { ...base, status: 'found', profile: { platform: platformId, platformName: p.name, ...data } };
  } catch (e) {
    if (e instanceof NotFound) return { ...base, status: 'not_found' };
    return { ...base, status: 'unknown', reason: describeError(e), checkUrl: p.profileUrl(username) };
  }
}
