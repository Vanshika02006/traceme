// TraceMe front end — no framework, no inline styles/scripts (strict CSP).
// The whole scan runs in the browser (static hosting on GitHub Pages).
import { PLATFORMS as PLATFORM_DEFS } from './core/platforms.js';
import { MAX_INPUTS as MAX } from './core/analyze.js';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeUrl = (u) => { try { const x = new URL(u, location.href); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } };
const pct = (x) => `${Math.round(x * 100)}%`;
const SVG_NS = 'http://www.w3.org/2000/svg';

let MAX_INPUTS = 5;
let PLATFORMS = [];
let lastReport = null;
const inputs = [];

// ---------------- status vocabulary (icon + label, never color alone) ----------------
const ICONS = {
  good: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m5 8.2 2 2 4-4.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  warning: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8 15 14H1z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 6v3.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="11.9" r="1" fill="currentColor"/></svg>',
  serious: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8 15 14H1z" fill="currentColor"/><path d="M8 6v3.8" stroke="#1a1a19" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="11.9" r="1" fill="#1a1a19"/></svg>',
  critical: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.2 1.5h5.6l3.7 3.7v5.6l-3.7 3.7H5.2l-3.7-3.7V5.2z" fill="currentColor"/><path d="M8 4.6v4.2" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="11.2" r="1" fill="#fff"/></svg>',
  neutral: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 7.2v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="4.9" r="1" fill="currentColor"/></svg>',
};
const LEVEL_STATUS = { Low: 'good', Moderate: 'warning', High: 'serious', Critical: 'critical' };
const SEV_STATUS = { critical: 'critical', high: 'serious', medium: 'warning', low: 'neutral' };
const SEV_LABEL = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
const STATUS_COLOR = { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b', neutral: '#898781' };
const statusChip = (status, label, cls = '') => `<span class="status status-${status} ${cls}">${ICONS[status]}${esc(label)}</span>`;

const TYPE_LABEL = {
  phone: 'Phone number', address: 'Street address', email: 'Email', birthdate: 'Birth date', age: 'Age', name: 'Real name',
  location: 'Location', organization: 'Employer / org', education: 'Education', job: 'Job role', family: 'Family', travel: 'Travel / absence',
  sensitive: 'Sensitive topic', crypto: 'Crypto wallet', pronouns: 'Pronouns', url: 'Website / link', handle: 'Mentioned handle',
};
const TYPE_ORDER = Object.keys(TYPE_LABEL);

// ---------------- tooltip ----------------
const tip = $('#tooltip');
const tips = new Map();
let tipSeq = 0;
const registerTip = (html) => { const id = `t${++tipSeq}`; tips.set(id, html); return id; };
document.addEventListener('pointerover', (e) => {
  const t = e.target.closest?.('[data-tip]');
  if (!t) return;
  tip.innerHTML = tips.get(t.dataset.tip) || '';
  tip.hidden = false;
  moveTip(e);
});
document.addEventListener('pointermove', (e) => { if (!tip.hidden) moveTip(e); });
document.addEventListener('pointerout', (e) => { if (e.target.closest?.('[data-tip]') && !e.relatedTarget?.closest?.('[data-tip]')) tip.hidden = true; });
function moveTip(e) {
  const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
  let x = e.clientX + pad, y = e.clientY + pad;
  if (x + w > innerWidth - 8) x = e.clientX - w - pad;
  if (y + h > innerHeight - 8) y = e.clientY - h - pad;
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${Math.max(8, y)}px`;
}

// ---------------- input chips ----------------
const entry = $('#input-entry');
const looksLikeUrl = (v) => /[/:]/.test(v) || /\.[a-z]{2,}\//i.test(v);

function addInput(raw) {
  const v = raw.trim().replace(/^<|>$/g, '');
  if (!v) return;
  if (inputs.length >= MAX_INPUTS) return showError(`You can add up to ${MAX_INPUTS} usernames or URLs.`);
  if (inputs.some((x) => x.toLowerCase() === v.toLowerCase())) return;
  inputs.push(v);
  renderChips();
}
function renderChips() {
  $('#chips').innerHTML = inputs.map((v, i) => `<li class="chip"><span class="chip-kind">${looksLikeUrl(v) ? 'URL' : '@'}</span><span class="chip-text" title="${esc(v)}">${esc(v)}</span><button type="button" data-remove="${i}" aria-label="Remove ${esc(v)}">×</button></li>`).join('');
  entry.placeholder = inputs.length ? 'Add another…' : 'e.g. janedoe or https://github.com/janedoe';
}
entry.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ',' || e.key === 'Tab') && entry.value.trim()) {
    e.preventDefault();
    addInput(entry.value);
    entry.value = '';
  } else if (e.key === 'Backspace' && !entry.value && inputs.length) {
    inputs.pop();
    renderChips();
  }
});
entry.addEventListener('paste', (e) => {
  const text = e.clipboardData.getData('text');
  if (/[\n,\s]/.test(text.trim())) {
    e.preventDefault();
    text.split(/[\n,\s]+/).forEach(addInput);
  }
});
entry.addEventListener('blur', () => { if (entry.value.trim()) { addInput(entry.value); entry.value = ''; } });
$('#chip-input').addEventListener('click', (e) => {
  const rm = e.target.closest('[data-remove]');
  if (rm) { inputs.splice(+rm.dataset.remove, 1); renderChips(); }
  entry.focus();
});

function showError(msg) { const el = $('#form-error'); el.textContent = msg; el.hidden = !msg; }

// ---------------- scan flow ----------------
PLATFORMS = Object.entries(PLATFORM_DEFS).map(([id, p]) => ({ id, name: p.name }));
MAX_INPUTS = MAX;
$('#max-inputs').textContent = MAX_INPUTS;
$('#platform-ticker').innerHTML = PLATFORMS.map((p) => `<li>${esc(p.name)}</li>`).join('');

let scanTimers = [];
function startScanAnimation() {
  const steps = $$('.pipeline li');
  steps.forEach((s) => s.classList.remove('active', 'done'));
  let i = 0;
  steps[0].classList.add('active');
  scanTimers.push(setInterval(() => {
    if (i < steps.length - 1) { steps[i].classList.replace('active', 'done'); steps[++i].classList.add('active'); }
  }, 1400));
  const chips = $$('#platform-ticker li');
  scanTimers.push(setInterval(() => {
    chips.forEach((c) => c.classList.remove('lit'));
    for (let k = 0; k < 3; k++) chips[Math.floor(Math.random() * chips.length)]?.classList.add('lit');
  }, 350));
}
function stopScanAnimation() { scanTimers.forEach(clearInterval); scanTimers = []; }

$('#scan-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (entry.value.trim()) { addInput(entry.value); entry.value = ''; }
  showError('');
  if (!inputs.length) return showError('Add at least one username or profile URL.');
  if (!$('#consent').checked) return showError('Please confirm these are your own accounts.');

  const btn = $('#scan-btn');
  btn.disabled = true;
  $('#search').hidden = true;
  $$('.info').forEach((s) => { s.hidden = true; });
  $('#scanning').hidden = false;
  scrollTo({ top: 0 });
  startScanAnimation();
  try {
    const { analyze } = await import('./core/analyze.js');
    const data = await analyze({ inputs, fullName: $('#full-name').value, location: $('#location').value });
    lastReport = data;
    render(data);
    $('#scanning').hidden = true;
    $('#results').hidden = false;
  } catch (err) {
    $('#scanning').hidden = true;
    $('#search').hidden = false;
    $$('.info').forEach((s) => { s.hidden = false; });
    showError(err.message);
  } finally {
    stopScanAnimation();
    btn.disabled = false;
  }
});

$('#btn-new').addEventListener('click', () => {
  $('#results').hidden = true;
  $('#search').hidden = false;
  $$('.info').forEach((s) => { s.hidden = false; });
  scrollTo({ top: 0, behavior: 'smooth' });
  entry.focus();
});
$('#btn-print').addEventListener('click', () => {
  $$('#results details').forEach((d) => { d.open = true; });
  print();
});
$('#btn-export').addEventListener('click', () => {
  if (!lastReport) return;
  const blob = new Blob([JSON.stringify(lastReport, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `traceme-report-${lastReport.generatedAt.slice(0, 10)}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// ---------------- rendering ----------------
function render(r) {
  tips.clear();
  const conf = Object.fromEntries(r.profiles.map((p) => [p.platform, Math.max(p.match.score, 0)]));
  r.profiles.forEach((p) => { conf[p.platform] = Math.max(conf[p.platform] ?? 0, p.match.score); });

  $('#report-title').textContent = `Footprint for ${r.query.usernames.map((u) => `@${u}`).join(', ')}`;
  $('#report-meta').textContent = `${r.summary.lookups} lookups across ${r.summary.platformsChecked} platforms · ${new Date(r.generatedAt).toLocaleString()}`
    + (r.query.invalid.length ? ` · Skipped unrecognised input: ${r.query.invalid.join(', ')}` : '');

  renderScore(r);
  renderStats(r);
  renderThreats(r.risk.threats);
  renderFindings(r.risk.findings);
  renderAccounts(r);
  renderEntities(r.entities, conf);
  renderGraph(r.graph);
  renderActivity(r.activity);
}

function renderScore(r) {
  const { score, level, counts } = r.risk;
  const status = LEVEL_STATUS[level];
  const blurb = {
    Low: 'Little personal information is publicly linked to you. Keep it that way.',
    Moderate: 'Some personal details are public. A few changes would reduce your exposure noticeably.',
    High: 'Enough is public for targeted phishing or profiling. Start with the top findings below.',
    Critical: 'Your public footprint exposes sensitive details. Act on the critical findings first.',
  }[level];
  $('#score-card').innerHTML = `
    <h3>Privacy exposure score</h3>
    <div><div class="hero-number">${score}<small> / 100</small></div></div>
    <div>${statusChip(status, `${level} exposure`, 'status-lg')}</div>
    <div><div class="meter" role="img" aria-label="Score ${score} out of 100"><div class="meter-fill"></div></div>
      <div class="meter-scale"><span>0 Low</span><span>25</span><span>50</span><span>75</span><span>100</span></div></div>
    <p class="score-summary">${esc(blurb)} <span class="muted">${counts.critical} critical · ${counts.high} high · ${counts.medium} medium · ${counts.low} low</span></p>`;
  const fill = $('#score-card .meter-fill');
  fill.style.width = `${Math.max(2, score)}%`;
  fill.style.background = STATUS_COLOR[status];
}

function renderStats(r) {
  const s = r.summary;
  const tiles = [
    [s.accountsFound, 'Accounts found', `of ${s.lookups} lookups`],
    [s.likelyYou, 'Confirmed or likely yours', `${s.accountsFound - s.likelyYou} need review`],
    [s.entities, 'Personal details exposed', 'extracted by NLP'],
    [s.declaredAccounts, 'Linked social accounts', 'not fetched (login walls)'],
  ];
  $('#stat-grid').innerHTML = tiles.map(([v, l, n]) => `<div class="stat"><div class="stat-value">${v}</div><div class="stat-label">${esc(l)}</div><div class="stat-note">${esc(n)}</div></div>`).join('');
}

/** Bar path with square baseline end and 4px rounded data end. */
function hbarPath(x, y, w, h, r = 4) {
  if (w <= 0) return '';
  r = Math.min(r, w, h / 2);
  return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
}
function vbarPath(x, yBase, w, h, r = 4) {
  if (h <= 0) return '';
  r = Math.min(r, h, w / 2);
  const top = yBase - h;
  return `M${x},${yBase}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${yBase}Z`;
}

function renderThreats(threats) {
  const W = 640, rowH = 36, labelW = 210, valueW = 112, barW = W - labelW - valueW, barH = 10;
  const H = threats.length * rowH;
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Threat vector scores">`;
  threats.forEach((t, i) => {
    const y = i * rowH + (rowH - barH) / 2;
    const id = registerTip(`<div class="tt-title">${esc(t.label)}</div><div class="tt-row">Score ${t.score} / 100 · ${esc(t.level)}</div><div class="tt-row">${t.findings} contributing finding${t.findings === 1 ? '' : 's'}</div>`);
    svg += `<g class="t-row" data-tip="${id}">
      <rect class="t-hit" x="0" y="${i * rowH}" width="${W}" height="${rowH}"/>
      <text class="t-label" x="0" y="${y + barH / 2 + 4}">${esc(t.label)}</text>
      <rect class="t-track" x="${labelW}" y="${y}" width="${barW}" height="${barH}" rx="5"/>
      <path class="t-bar" d="${hbarPath(labelW, y, (barW * t.score) / 100, barH)}"/>
      <text class="t-value" x="${W}" y="${y + barH / 2 + 4}" text-anchor="end">${t.score} · ${esc(t.level)}</text>
    </g>`;
  });
  $('#threat-chart').innerHTML = `${svg}</svg>`;
}

const platformLabel = (id) => lastReport?.profiles.find((p) => p.platform === id)?.platformName || id;

function findingCard(f) {
  const status = SEV_STATUS[f.severity];
  const ev = f.evidence.length
    ? `<details><summary>Evidence (${f.evidence.length})</summary><ul class="evidence">${f.evidence.map((e) => `<li><span class="ev-src">${esc(platformLabel(e.platform))}</span> · ${esc(e.field)}: ${esc(e.snippet || e.value)}</li>`).join('')}</ul></details>`
    : '';
  const threatNames = { doxxing: 'Doxxing', identity_theft: 'Identity theft', phishing: 'Phishing', account_takeover: 'Account takeover', stalking: 'Stalking' };
  return `<article class="finding sev-${f.severity}">
    <div class="finding-head">${statusChip(status, SEV_LABEL[f.severity])}<h4>${esc(f.title)}</h4>
      <div class="threat-tags">${f.threats.map((t) => `<span class="tag">${esc(threatNames[t] || t)}</span>`).join('')}</div></div>
    <p>${esc(f.detail)}</p>
    <div class="rec"><strong>What to do:</strong> ${esc(f.recommendation)}</div>
    ${ev}
  </article>`;
}

function renderFindings(findings) {
  const verified = findings.filter((f) => !f.unverified);
  const unverified = findings.filter((f) => f.unverified);
  $('#findings').innerHTML = verified.length ? verified.map(findingCard).join('') : `<div class="card empty">${ICONS.good.replace('<svg', '<svg width="22" height="22"')}<p>No significant exposure found on accounts that match you.</p></div>`;
  $('#review-wrap').hidden = !unverified.length;
  $('#review-count').textContent = `Needs your review: ${unverified.length} finding${unverified.length === 1 ? '' : 's'} from accounts that may not be yours`;
  $('#findings-unverified').innerHTML = unverified.map(findingCard).join('');
}

function renderAccounts(r) {
  const sorted = [...r.profiles].sort((a, b) => b.match.score - a.match.score);
  $('#accounts').innerHTML = sorted.length ? sorted.map((p) => {
    const url = safeUrl(p.url);
    const avatar = safeUrl(p.avatar);
    const s = p.match.score;
    const cls = s >= 0.75 ? '' : s >= 0.45 ? 'mid' : 'low';
    const meta = [
      p.createdAt && `Joined ${new Date(p.createdAt).getFullYear()}`,
      p.location && `📍 ${p.location}`,
      p.via && `via ${p.via}`,
      ...Object.entries(p.stats || {}).filter(([, v]) => typeof v === 'number').slice(0, 2).map(([k, v]) => `${v.toLocaleString()} ${k.replace(/([A-Z])/g, ' $1').toLowerCase()}`),
    ].filter(Boolean);
    return `<article class="account ${s < 0.45 ? 'dim' : ''}">
      <div class="acct-top">
        ${avatar ? `<img class="avatar" src="${esc(avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<div class="avatar">${esc((p.platformName || '?')[0])}</div>`}
        <div class="acct-id"><div class="acct-platform">${esc(p.platformName)}</div>
          <div class="acct-name">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(p.displayName || p.username)}</a>` : esc(p.displayName || p.username)}</div>
          <div class="acct-platform mono">@${esc(p.username)}</div></div>
      </div>
      ${p.bio ? `<p class="acct-bio">${esc(p.bio)}</p>` : ''}
      ${meta.length ? `<div class="acct-meta">${meta.map((m) => `<span>${esc(m)}</span>`).join('')}</div>` : ''}
      <div class="match">
        <div class="match-row"><span>${esc(p.match.label)}</span><strong>${pct(s)}</strong></div>
        <div class="match-bar ${cls}"><i data-w="${Math.round(s * 100)}"></i></div>
        <details><summary>Why?</summary><ul>${p.match.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>
      </div>
    </article>`;
  }).join('') : '<div class="card empty">No public accounts were found for these usernames.</div>';
  $$('#accounts [data-w]').forEach((el) => { el.style.width = `${el.dataset.w}%`; });
  $$('#accounts img.avatar').forEach((img) => img.addEventListener('error', () => { img.replaceWith(Object.assign(document.createElement('div'), { className: 'avatar', textContent: '?' })); }));

  $('#declared').innerHTML = r.declared.length ? `<div class="sub-list"><h4>Social accounts linked to you (not fetched)</h4><ul class="pill-list">${r.declared.map((d) => {
    const u = safeUrl(d.url);
    return `<li>${esc(d.platformName)}: ${u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">@${esc(d.username)}</a>` : `@${esc(d.username)}`} <span class="muted">· ${esc(d.via)}</span></li>`;
  }).join('')}</ul><p class="help">These platforms need a login or prohibit automated access, so their content isn't analysed. The fact that they can be linked to your other accounts still counts as exposure.</p></div>` : '';

  const unknown = r.unknown.length ? `<div class="sub-list"><h4>Couldn't check automatically (${r.unknown.length})</h4><ul class="pill-list">${r.unknown.map((u) => {
    const link = safeUrl(u.checkUrl);
    return `<li>${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(u.platformName)}</a>` : esc(u.platformName)} <span class="muted">· ${esc(u.reason)}</span></li>`;
  }).join('')}</ul><p class="help">Open these links to check by hand.</p></div>` : '';
  const notFound = r.notFound.length ? `<details class="sub-list"><summary class="muted">Not found on ${r.notFound.length} platform checks</summary><ul class="pill-list">${r.notFound.map((n) => `<li>${esc(n.platformName)} · @${esc(n.query)}</li>`).join('')}</ul></details>` : '';
  $('#other-checks').innerHTML = unknown + notFound;
}

function highlight(snippet, value) {
  const s = esc(snippet), v = esc(value);
  const i = s.toLowerCase().indexOf(v.toLowerCase());
  return i < 0 || !v ? s : `${s.slice(0, i)}<mark>${s.slice(i, i + v.length)}</mark>${s.slice(i + v.length)}`;
}

function renderEntities(entities, conf) {
  if (!entities.length) { $('#entities-table').innerHTML = '<tbody><tr><td class="empty">No personal details were extracted.</td></tr></tbody>'; return; }
  const sorted = [...entities].sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type));
  $('#entities-table').innerHTML = `<thead><tr><th>Type</th><th>Value</th><th>Found on</th><th>Context</th></tr></thead><tbody>${sorted.map((e) => {
    const type = TYPE_LABEL[e.type] || e.type;
    const sub = e.subtype && !['obfuscated'].includes(e.subtype) ? ` <span class="muted small">(${esc(e.subtype)})</span>` : e.subtype === 'obfuscated' ? ' <span class="muted small">(obfuscated)</span>' : '';
    const src = e.sources.map((s) => `<span class="src-badge ${(conf[s.platform] ?? 0) < 0.45 ? 'unv' : ''}" title="${(conf[s.platform] ?? 0) < 0.45 ? 'Account may not be yours' : ''}">${esc(platformLabel(s.platform))}</span>`).join('');
    const ctx = e.sources[0]?.snippet && e.sources[0].snippet !== e.value ? highlight(e.sources[0].snippet, e.value) : `<span class="muted">${esc(e.sources[0]?.field || '')}</span>`;
    return `<tr><td class="type-cell">${esc(type)}${sub}</td><td class="val">${esc(e.value)}</td><td>${src}</td><td class="ctx">${ctx}</td></tr>`;
  }).join('')}</tbody>`;
}

function renderGraph(graph) {
  const nodes = [...graph.nodes].sort((a, b) => b.confidence - a.confidence);
  if (!nodes.length) { $('#graph').innerHTML = '<p class="empty">No accounts to link.</p>'; $('#graph-legend').innerHTML = ''; return; }
  // Order nodes by cluster so linked accounts sit next to each other on the ring.
  const order = graph.clusters.flat();
  nodes.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const W = 820, H = nodes.length > 12 ? 600 : 500, cx = W / 2, cy = H / 2 + 4;
  const R = nodes.length === 1 ? 0 : Math.min(W, H) / 2 - 78;
  const r = nodes.length > 14 ? 19 : 25;
  const pos = {};
  nodes.forEach((n, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / nodes.length;
    pos[n.id] = { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a), a };
  });
  const fillFor = (c) => (c >= 0.75 ? '#3987e5' : c >= 0.45 ? '#1c5cab' : '#383835');
  let edges = '', hits = '';
  graph.edges.forEach((e) => {
    const a = pos[e.source], b = pos[e.target];
    if (!a || !b) return;
    const strong = e.score >= 0.5;
    const id = registerTip(`<div class="tt-title">${Math.round(e.score * 100)}% match</div><ul>${e.evidence.map((x) => `<li>${esc(x)}</li>`).join('')}${e.penalties.map((x) => `<li>⚠ ${esc(x)}</li>`).join('')}</ul>`);
    edges += `<line class="edge ${strong ? '' : 'edge-weak'}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke-width="${strong ? (1.5 + e.score * 4).toFixed(1) : 1.5}" stroke-opacity="${strong ? 0.35 + e.score * 0.6 : 0.7}"/>`;
    hits += `<line class="edge-hit" data-tip="${id}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;
  });
  const lookup = Object.fromEntries((lastReport?.profiles || []).map((p) => [p.id, p]));
  let nodeSvg = '';
  nodes.forEach((n) => {
    const { x, y, a } = pos[n.id];
    const p = lookup[n.id];
    const id = registerTip(`<div class="tt-title">${esc(n.label)} · @${esc(n.username)}</div><div class="tt-row">${esc(p?.match.label || '')} (${pct(n.confidence)})</div><ul>${(p?.match.reasons || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`);
    // Labels sit radially outside the ring so they never cross edges in the middle.
    const single = nodes.length === 1;
    const cos = single ? 0 : Math.cos(a), sin = single ? 1 : Math.sin(a);
    const anchor = cos > 0.35 ? 'start' : cos < -0.35 ? 'end' : 'middle';
    const lx = x + cos * (r + 8);
    const ly = anchor === 'middle' ? (sin >= 0 ? y + r + 16 : y - r - 22) : y + sin * (r + 6) - 2;
    nodeSvg += `<g data-tip="${id}">
      <circle class="node-ring" cx="${x}" cy="${y}" r="${r}" fill="${fillFor(n.confidence)}"/>
      <text class="node-pct ${n.confidence < 0.45 ? 'dark' : ''}" x="${x}" y="${y + 4}" text-anchor="middle">${Math.round(n.confidence * 100)}</text>
      <text class="node-label" x="${lx}" y="${ly}" text-anchor="${anchor}">${esc(n.label.replace(/ \(.*\)$/, ''))}</text>
      <text class="node-sub" x="${lx}" y="${ly + 14}" text-anchor="${anchor}">@${esc(n.username.length > 18 ? `${n.username.slice(0, 17)}…` : n.username)}</text>
    </g>`;
  });
  $('#graph').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Identity graph of ${nodes.length} accounts">${edges}${hits}${nodeSvg}</svg>`;
  $('#graph-legend').innerHTML = `
    <span><i class="swatch swatch-likely"></i>Likely you (≥75)</span>
    <span><i class="swatch swatch-possible"></i>Possibly you (45–74)</span>
    <span><i class="swatch swatch-uncertain"></i>Uncertain (&lt;45)</span>
    <span><i class="swatch-line"></i>Strong link</span>
    <span><i class="swatch-line weak"></i>Weak link</span>
    <span class="muted">Numbers are match scores (%)</span>`;
  $('.swatch-likely').style.background = '#3987e5';
  $('.swatch-possible').style.background = '#1c5cab';
  $('.swatch-uncertain').style.background = '#383835';
}

function renderActivity(act) {
  const box = $('#activity');
  if (!act || !act.events) {
    box.innerHTML = '<p class="empty">No public activity timestamps were available. Only public GitHub events are analysed.</p>';
    return;
  }
  const h = act.histogramUtc;
  const max = Math.max(...h, 1);
  const inf = act.inferred;
  const fmtH = (x) => `${String(x).padStart(2, '0')}:00`;
  const localOf = (hr) => (inf ? (((hr + inf.utcOffset) % 24) + 24) % 24 : null);
  box.innerHTML = `<div class="activity-summary">
      <div><strong>${act.events}</strong>public events</div>
      <div><strong>${inf ? esc(inf.label) : '—'}</strong>estimated timezone</div>
      <div><strong>${inf ? fmtH(inf.peakHourUtc) : '—'} UTC</strong>busiest hour</div>
      <div><strong>${Math.round(act.weekendShare * 100)}%</strong>on weekends</div>
    </div><div id="activity-chart"></div>
    <details class="table-toggle"><summary>View as table</summary><table class="data-table"><thead><tr><th>Hour (UTC)</th><th>Events</th>${inf ? '<th>Estimated local hour</th>' : ''}</tr></thead><tbody>${h.map((v, i) => `<tr><td>${fmtH(i)}</td><td>${v}</td>${inf ? `<td>${fmtH(localOf(i))}</td>` : ''}</tr>`).join('')}</tbody></table></details>`;

  const W = 820, H = 220, padL = 34, padB = 26, padT = 18, plotW = W - padL, plotH = H - padB - padT;
  const colW = plotW / 24, gap = 2;
  const niceMax = Math.max(4, Math.ceil(max / 4) * 4);
  const y = (v) => padT + plotH - (v / niceMax) * plotH;
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Activity by hour of day, UTC">`;
  if (inf && inf.quietShare < 0.08) {
    const [s] = inf.quietWindowUtc;
    for (const seg of s + 6 <= 24 ? [[s, 6]] : [[s, 24 - s], [0, s + 6 - 24]]) {
      svg += `<rect class="quiet" x="${padL + seg[0] * colW}" y="${padT}" width="${seg[1] * colW}" height="${plotH}"/>`;
    }
    const labelX = padL + ((s + 3) % 24) * colW;
    svg += `<text class="quiet-label" x="${labelX}" y="${padT - 5}" text-anchor="middle">Likely sleep</text>`;
  }
  for (let k = 0; k <= 4; k++) {
    const v = (niceMax / 4) * k, yy = y(v);
    svg += `<line class="${k === 0 ? 'axis' : 'grid'}" x1="${padL}" x2="${W}" y1="${yy}" y2="${yy}"/><text class="tick" x="${padL - 8}" y="${yy + 4}" text-anchor="end">${v}</text>`;
  }
  h.forEach((v, i) => {
    const x = padL + i * colW + gap / 2;
    const id = registerTip(`<div class="tt-title">${fmtH(i)}–${fmtH((i + 1) % 24)} UTC</div><div class="tt-row">${v} event${v === 1 ? '' : 's'}</div>${inf ? `<div class="tt-row">≈ ${fmtH(localOf(i))} estimated local time</div>` : ''}`);
    svg += `<g class="col" data-tip="${id}"><rect class="bar-hit" x="${padL + i * colW}" y="${padT}" width="${colW}" height="${plotH}"/><path class="bar" d="${vbarPath(x, y(0), colW - gap, y(0) - y(v))}"/></g>`;
    if (i % 3 === 0) svg += `<text class="tick" x="${padL + i * colW + colW / 2}" y="${H - 8}" text-anchor="middle">${fmtH(i)}</text>`;
  });
  $('#activity-chart').innerHTML = `${svg}</svg>`;
}
