// Public-data connectors. Each one uses an official/public JSON endpoint that
// requires no login. A fetcher returns a normalised profile or throws NotFound.
import { getJson, NotFound, stripHtml } from './http.js';

const enc = encodeURIComponent;
const toIso = (v) => {
  if (v == null || v === '') return null;
  const d = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const clean = (arr) => [...new Set(arr.filter(Boolean).map((s) => String(s).trim()).filter(Boolean))];

function profile(base) {
  return {
    displayName: null, bio: null, location: null, company: null, website: null,
    emails: [], links: [], avatar: null, createdAt: null, stats: {}, activity: [], extraText: [],
    ...base,
    emails: clean(base.emails || []),
    links: clean(base.links || []),
  };
}

const githubHeaders = () =>
  process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {};

export const PLATFORMS = {
  github: {
    name: 'GitHub',
    profileUrl: (u) => `https://github.com/${u}`,
    async fetch(u) {
      const d = await getJson(`https://api.github.com/users/${enc(u)}`, { headers: githubHeaders() });
      let activity = [];
      try {
        const events = await getJson(`https://api.github.com/users/${enc(u)}/events/public?per_page=100`, { headers: githubHeaders() });
        activity = events.map((e) => e.created_at).filter(Boolean);
      } catch { /* activity is optional */ }
      return profile({
        username: d.login, url: d.html_url, displayName: d.name, bio: d.bio, location: d.location,
        company: d.company, website: d.blog || null, emails: [d.email],
        links: [d.blog, d.twitter_username && `https://x.com/${d.twitter_username}`],
        avatar: d.avatar_url, createdAt: toIso(d.created_at),
        stats: { followers: d.followers, publicRepos: d.public_repos }, activity,
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

  dockerhub: {
    name: 'Docker Hub',
    profileUrl: (u) => `https://hub.docker.com/u/${u}`,
    async fetch(u) {
      const d = await getJson(`https://hub.docker.com/v2/users/${enc(u)}/`);
      return profile({
        username: d.username, url: `https://hub.docker.com/u/${d.username}`, displayName: d.full_name || null,
        location: d.location || null, company: d.company || null, website: d.profile_url || null,
        links: [d.profile_url], avatar: d.gravatar_url || null, createdAt: toIso(d.date_joined),
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

  reddit: {
    name: 'Reddit',
    profileUrl: (u) => `https://www.reddit.com/user/${u}`,
    async fetch(u) {
      const d = await getJson(`https://www.reddit.com/user/${enc(u)}/about.json`);
      const r = d.data;
      if (!r || r.is_suspended) throw new NotFound();
      return profile({
        username: r.name, url: `https://www.reddit.com/user/${r.name}`,
        displayName: r.subreddit?.title || null, bio: r.subreddit?.public_description || null,
        avatar: r.icon_img?.split('?')[0] || null, createdAt: toIso(r.created_utc),
        stats: { karma: r.total_karma },
      });
    },
  },

  duolingo: {
    name: 'Duolingo',
    profileUrl: (u) => `https://www.duolingo.com/profile/${u}`,
    async fetch(u) {
      const d = await getJson(`https://www.duolingo.com/2017-06-30/users?username=${enc(u)}&fields=users{username,name,bio,creationDate,streak,courses{title}}`);
      const r = d.users?.[0];
      if (!r) throw new NotFound();
      return profile({
        username: r.username, url: `https://www.duolingo.com/profile/${r.username}`, displayName: r.name || null,
        bio: r.bio || null, createdAt: toIso(r.creationDate),
        extraText: r.courses?.length ? [`Learning: ${r.courses.map((c) => c.title).join(', ')}`] : [],
        stats: { streak: r.streak },
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

// Platforms we recognise from URLs but never fetch (login walls / scraping prohibited).
export const DECLARED_ONLY = {
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
  return PLATFORMS[id]?.name || DECLARED_ONLY[id]?.name || id;
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
    const reason = e.status === 429 || e.status === 403 ? 'rate-limited or blocked' : e.name === 'TimeoutError' ? 'timed out' : e.message;
    return { ...base, status: 'unknown', reason, checkUrl: p.profileUrl(username) };
  }
}
