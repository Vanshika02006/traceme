// Turns raw user input (a username or a profile URL) into { platform, username }.
// Also used to recognise account links found inside profile bios/websites.

const URL_RULES = [
  { platform: 'github', host: /(^|\.)github\.com$/, path: /^\/([A-Za-z0-9-]{1,39})\/?$/ },
  { platform: 'gitlab', host: /(^|\.)gitlab\.com$/, path: /^\/([A-Za-z0-9_.-]+)\/?$/ },
  { platform: 'hackernews', host: /^news\.ycombinator\.com$/, query: 'id' },
  { platform: 'devto', host: /^dev\.to$/, path: /^\/([A-Za-z0-9_]+)\/?$/ },
  { platform: 'keybase', host: /^keybase\.io$/, path: /^\/([A-Za-z0-9_]+)\/?$/ },
  { platform: 'chesscom', host: /(^|\.)chess\.com$/, path: /^\/member\/([A-Za-z0-9_-]+)\/?$/ },
  { platform: 'lichess', host: /^lichess\.org$/, path: /^\/@\/([A-Za-z0-9_-]+)\/?$/ },
  { platform: 'codeforces', host: /^codeforces\.com$/, path: /^\/profile\/([A-Za-z0-9_.-]+)\/?$/ },
  { platform: 'mastodon', host: /^mastodon\.social$/, path: /^\/@([A-Za-z0-9_]+)\/?$/ },
  { platform: 'bluesky', host: /^bsky\.app$/, path: /^\/profile\/([A-Za-z0-9_.-]+)\/?$/ },
  { platform: 'dockerhub', host: /^hub\.docker\.com$/, path: /^\/u\/([A-Za-z0-9_-]+)\/?$/ },
  { platform: 'npm', host: /^(www\.)?npmjs\.com$/, path: /^\/~([A-Za-z0-9_.-]+)\/?$/ },
  { platform: 'reddit', host: /(^|\.)reddit\.com$/, path: /^\/(?:u|user)\/([A-Za-z0-9_-]+)\/?$/ },
  { platform: 'duolingo', host: /(^|\.)duolingo\.com$/, path: /^\/profile\/([A-Za-z0-9_.-]+)\/?$/ },
  { platform: 'wikipedia', host: /^en\.wikipedia\.org$/, path: /^\/wiki\/User:([^/]+)\/?$/ },
  // Declared-only platforms: we record them but never scrape them (ToS / login walls).
  { platform: 'twitter', host: /^(www\.|mobile\.)?(twitter|x)\.com$/, path: /^\/([A-Za-z0-9_]{1,15})\/?$/ },
  { platform: 'instagram', host: /^(www\.)?instagram\.com$/, path: /^\/([A-Za-z0-9_.]+)\/?$/ },
  { platform: 'linkedin', host: /(^|\.)linkedin\.com$/, path: /^\/in\/([A-Za-z0-9_-]+)\/?$/ },
  { platform: 'facebook', host: /(^|\.)facebook\.com$/, path: /^\/([A-Za-z0-9.]+)\/?$/ },
  { platform: 'tiktok', host: /(^|\.)tiktok\.com$/, path: /^\/@([A-Za-z0-9_.]+)\/?$/ },
  { platform: 'youtube', host: /(^|\.)youtube\.com$/, path: /^\/@([A-Za-z0-9_.-]+)\/?$/ },
  { platform: 'medium', host: /^medium\.com$/, path: /^\/@([A-Za-z0-9_.-]+)\/?$/ },
  { platform: 'threads', host: /^(www\.)?threads\.(net|com)$/, path: /^\/@([A-Za-z0-9_.]+)\/?$/ },
  { platform: 'pinterest', host: /(^|\.)pinterest\.[a-z.]+$/, path: /^\/([A-Za-z0-9_]+)\/?$/ },
];

const RESERVED = new Set(['about', 'login', 'signup', 'explore', 'settings', 'home', 'search', 'p', 'reel', 'share', 'intent', 'hashtag', 'watch']);

export function parseProfileUrl(raw) {
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  for (const rule of URL_RULES) {
    if (!rule.host.test(host)) continue;
    let username = null;
    if (rule.query) username = url.searchParams.get(rule.query);
    else {
      const m = decodeURIComponent(url.pathname).match(rule.path);
      if (m) username = m[1];
    }
    if (username && !RESERVED.has(username.toLowerCase())) {
      return { platform: rule.platform, username };
    }
  }
  return null;
}

const USERNAME_RE = /^@?([A-Za-z0-9][A-Za-z0-9_.-]{0,38})$/;

/**
 * Parse one line of user input.
 * Returns { kind: 'url', platform, username } | { kind: 'username', username } | null
 */
export function parseInput(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  if (/[/:]/.test(value) || /\.[a-z]{2,}\//i.test(value)) {
    const parsed = parseProfileUrl(value);
    return parsed ? { kind: 'url', ...parsed, raw: value } : null;
  }
  const m = value.match(USERNAME_RE);
  return m ? { kind: 'username', username: m[1], raw: value } : null;
}
