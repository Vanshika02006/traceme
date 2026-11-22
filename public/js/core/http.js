export class NotFound extends Error {}

/**
 * GET JSON with a timeout. Returns parsed body, throws NotFound on 404/410, Error otherwise.
 * Runs in the browser: only CORS-safelisted headers are sent so no preflight is needed.
 */
export async function getJson(url, { timeout = 7000, headers = {}, notFoundStatuses = [404, 410] } = {}) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(timeout),
    redirect: 'follow',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
  if (notFoundStatuses.includes(res.status)) throw new NotFound(`${res.status}`);
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    // GitHub (and others) expose when the rate-limit window resets.
    if (res.headers.get('x-ratelimit-remaining') === '0') {
      const reset = Number(res.headers.get('x-ratelimit-reset'));
      if (reset) err.rateLimitReset = new Date(reset * 1000);
    }
    throw err;
  }
  return res.json();
}

/** Run async tasks with a concurrency cap. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

export function stripHtml(html) {
  return String(html || '')
    .replace(/<br\s*\/?>|<\/p>/gi, '\n')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>.*?<\/a>/gi, ' $1 ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x2F;/g, '/')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}
