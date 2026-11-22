import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { analyze, MAX_INPUTS } from './src/analyze.js';
import { PLATFORMS } from './src/platforms.js';

const app = express();
const PORT = process.env.PORT || 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; connect-src 'self'",
  });
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// Simple in-memory rate limit: scans are expensive and hit third-party APIs.
const hits = new Map();
const WINDOW_MS = 60_000, MAX_PER_WINDOW = 5;
function rateLimit(req, res, next) {
  const now = Date.now();
  const ip = req.ip;
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) return res.status(429).json({ error: 'Too many scans. Please wait a minute and try again.' });
  recent.push(now);
  hits.set(ip, recent);
  next();
}

app.get('/api/platforms', (req, res) => {
  res.json({ platforms: Object.entries(PLATFORMS).map(([id, p]) => ({ id, name: p.name })), maxInputs: MAX_INPUTS });
});

app.post('/api/analyze', rateLimit, async (req, res) => {
  const { inputs, fullName = '', location = '', consent } = req.body || {};
  if (consent !== true) return res.status(400).json({ error: 'Please confirm these accounts are your own.' });
  if (!Array.isArray(inputs) || !inputs.some((i) => typeof i === 'string' && i.trim())) {
    return res.status(400).json({ error: 'Enter at least one username or profile URL.' });
  }
  if (inputs.length > MAX_INPUTS) return res.status(400).json({ error: `Enter at most ${MAX_INPUTS} usernames or URLs.` });
  try {
    const report = await analyze({
      inputs: inputs.filter((i) => typeof i === 'string').map((i) => i.slice(0, 200)),
      fullName: String(fullName).slice(0, 100),
      location: String(location).slice(0, 100),
    });
    res.set('Cache-Control', 'no-store').json(report);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'The scan failed unexpectedly. Please try again.' });
  }
});

app.listen(PORT, () => console.log(`TraceMe running at http://localhost:${PORT}`));
