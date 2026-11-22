import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] || '';

test('CSP allows the inline import map by hash', () => {
  const importmap = html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1];
  const hash = createHash('sha256').update(importmap).digest('base64');
  assert.ok(csp.includes(`'sha256-${hash}'`), 'import map changed: update the sha256 hash in the CSP meta tag');
  assert.ok(!/<script(?![^>]*\bsrc=)(?![^>]*type="importmap")[^>]*>/.test(html), 'no other inline scripts allowed');
});

test('CSP connect-src covers every platform API host', () => {
  const src = readFileSync(new URL('../public/js/core/platforms.js', import.meta.url), 'utf8');
  const hosts = new Set([...src.matchAll(/getJson\(`(https:\/\/[^/`$]+)/g)].map((m) => m[1]));
  assert.ok(hosts.size >= 10);
  const connect = csp.split(';').find((d) => d.trim().startsWith('connect-src'));
  for (const h of hosts) assert.ok(connect.includes(h), `connect-src is missing ${h}`);
});

test('all asset paths are relative (GitHub Pages serves from /<repo>/)', () => {
  const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]).filter((u) => !/^(https?:|#|data:|mailto:)/.test(u));
  for (const r of refs) assert.ok(!r.startsWith('/'), `absolute path breaks on GitHub Pages: ${r}`);
});
