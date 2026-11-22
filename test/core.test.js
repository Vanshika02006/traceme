import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInput, parseProfileUrl } from '../public/js/core/urlParser.js';
import { extractEntities, mergeEntities, classifyLocation, looksLikeRealName } from '../public/js/core/nlp.js';
import { jaroWinkler, nameSimilarity, matchIdentities } from '../public/js/core/matching.js';
import { classifyRisk } from '../public/js/core/risk.js';
import { analyzeActivity } from '../public/js/core/activity.js';

const mk = (o) => ({ displayName: null, bio: null, location: null, company: null, website: null, emails: [], links: [], extraText: [], ...o, id: `${o.platform}:${o.username}`, platformName: o.platform });

test('parseInput handles usernames and profile URLs', () => {
  assert.deepEqual(parseInput('@janedoe'), { kind: 'username', username: 'janedoe', raw: '@janedoe' });
  assert.equal(parseInput('https://github.com/janedoe').platform, 'github');
  assert.equal(parseInput('news.ycombinator.com/user?id=pg').username, 'pg');
  assert.equal(parseInput('https://x.com/jane_doe').platform, 'twitter');
  assert.equal(parseProfileUrl('https://x.com/home'), null);
  assert.equal(parseInput('not a username!'), null);
});

test('NLP extracts contact, identity and sensitive entities', () => {
  const ents = extractEntities(mk({
    platform: 'github', username: 'p', displayName: 'Priya Sharma', location: 'Pune, India',
    bio: 'Engineer at Acme Corp. 22 y/o, born 14 March 2003. Mail me: priya [at] gmail [dot] com, +91 98765 43210. On vacation until Dec 5. ADHD.',
  }));
  const has = (type, value) => ents.some((e) => e.type === type && (!value || e.value === value));
  assert.ok(has('name', 'Priya Sharma'));
  assert.ok(has('email', 'priya@gmail.com'));
  assert.ok(has('phone', '+91 98765 43210'));
  assert.ok(has('birthdate', '14 March 2003'));
  assert.ok(has('age', '22 years old'));
  assert.ok(has('organization', 'Acme Corp'));
  assert.ok(has('travel'));
  assert.ok(ents.some((e) => e.type === 'sensitive' && e.subtype === 'health'));
});

test('NLP does not flag year ranges as phone numbers', () => {
  const ents = extractEntities(mk({ platform: 'x', username: 'a', bio: 'Worked there 2019-2023.' }));
  assert.ok(!ents.some((e) => e.type === 'phone'));
});

test('location precision and real-name heuristics', () => {
  assert.equal(classifyLocation('India'), 'country');
  assert.equal(classifyLocation('Pune, India'), 'city');
  assert.equal(classifyLocation('221 Baker Street, London'), 'address');
  assert.ok(looksLikeRealName('Ada Lovelace'));
  assert.ok(!looksLikeRealName('xX_gamer_99'));
});

test('mergeEntities groups the same value across platforms', () => {
  const merged = mergeEntities([
    { type: 'email', value: 'a@b.com', platform: 'github', field: 'bio', snippet: '' },
    { type: 'email', value: 'A@B.com', platform: 'gitlab', field: 'bio', snippet: '' },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].sources.length, 2);
});

test('string similarity', () => {
  assert.equal(jaroWinkler('martha', 'martha'), 1);
  assert.ok(jaroWinkler('martha', 'marhta') > 0.95);
  assert.ok(nameSimilarity('Jane Doe', 'Doe Jane') > 0.95);
  assert.ok(nameSimilarity('Jane Doe', 'Bob Smith') < 0.6);
});

test('matching: cross-links create high confidence; bare username matches stay uncertain', () => {
  const gh = mk({ platform: 'github', username: 'jdoe', displayName: 'Jane Doe', links: ['https://keybase.io/jdoe'] });
  const kb = mk({ platform: 'keybase', username: 'jdoe', displayName: 'Jane Doe' });
  const chess = mk({ platform: 'chesscom', username: 'jdoe', displayName: 'Rahul Verma', location: 'Delhi' });
  const m = matchIdentities([gh, kb, chess], new Set([gh.id]));
  assert.equal(m.confidence[gh.id].score, 1);
  assert.ok(m.confidence[kb.id].score >= 0.75, `keybase ${m.confidence[kb.id].score}`);
  assert.ok(m.confidence[chess.id].score < 0.45, `chess ${m.confidence[chess.id].score}`);
  assert.deepEqual([...m.clusters[0]].sort(), [gh.id, kb.id].sort());
});

test('matching: seed name penalises a different person', () => {
  const p = mk({ platform: 'lichess', username: 'jdoe', displayName: 'Someone Else' });
  const m = matchIdentities([p], new Set(), { fullName: 'Jane Doe' });
  assert.ok(m.confidence[p.id].score < 0.2);
});

test('risk: combination rule and unverified down-weighting', () => {
  const gh = mk({ platform: 'github', username: 'jdoe' });
  const other = mk({ platform: 'chesscom', username: 'jdoe' });
  const matching = { confidence: { [gh.id]: { score: 1 }, [other.id]: { score: 0.2 } }, edges: [], clusters: [] };
  const entities = [
    { type: 'name', value: 'Jane Doe', sources: [{ platform: 'github' }] },
    { type: 'age', value: '22 years old', sources: [{ platform: 'github' }] },
    { type: 'location', subtype: 'city', value: 'Pune', sources: [{ platform: 'github' }] },
    { type: 'phone', value: '+1 555 123 4567', sources: [{ platform: 'chesscom' }] },
  ];
  const r = classifyRisk({ profiles: [gh, other], entities, matching, activity: null });
  assert.ok(r.findings.some((f) => f.type === 'identity_kit' && f.severity === 'critical'));
  const phone = r.findings.find((f) => f.type === 'phone');
  assert.ok(phone.unverified);
  assert.equal(r.counts.critical, 1); // only the identity kit; the unverified phone is excluded
});

test('activity: quiet window infers timezone', () => {
  // Active 14:00–23:00 UTC every day → quiet ~ 02:00–08:00 UTC → offset near −1.
  const ts = [];
  for (let d = 1; d <= 10; d++) for (let h = 14; h <= 23; h++) ts.push(`2026-01-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00Z`);
  const a = analyzeActivity(ts);
  assert.equal(a.events, 100);
  assert.ok(a.inferred);
  assert.equal(a.histogramUtc[3], 0);
});
