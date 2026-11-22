# TraceMe – Your Digital Footprint Investigator

Enter your publicly available usernames or profile URLs. TraceMe analyses publicly accessible information to show your digital footprint, privacy exposure and potential risks.

**Live site:** https://vanshika02006.github.io/traceme/

Everything runs in your browser. There is no TraceMe server: your browser talks directly to public platform APIs, and the report never leaves the tab.

## Features

- **Account discovery**: checks each username on 12 platforms through their official public APIs (GitHub, GitLab, Hacker News, DEV, Keybase, Chess.com, Lichess, Codeforces, Mastodon, Bluesky, npm, Wikipedia). Links found in profiles are followed one hop. Login-walled or non-CORS sites (Instagram, LinkedIn, X, Reddit, …) are recognised from URLs but never fetched.
- **NLP entity extraction** (`public/js/core/nlp.js`): finds emails (including obfuscated `name [at] domain [dot] com`), phone numbers, street addresses, locations, employers, schools, job roles, birth dates, ages, pronouns, family mentions, travel/absence announcements, crypto wallets and sensitive topics (health, religion, politics). It combines regex patterns, keyword lists and named-entity recognition with [compromise](https://github.com/spencermountain/compromise).
- **Entity matching** (`matching.js`): works out which accounts really belong to the same person, so a stranger who happens to share your username isn't counted as you. Signals: cross-links, shared email or website, Jaro-Winkler name similarity, location overlap and TF-IDF bio similarity. They are combined with a noisy-OR and reduced by conflicting evidence.
- **Risk classification** (`risk.js`): rates each exposure by severity, maps it to threat vectors (doxxing, identity theft, phishing, account takeover, stalking) and flags dangerous combinations (e.g. name + birth date + city). The result is a 0–100 exposure score.
- **Temporal fingerprinting** (`activity.js`): estimates your timezone from the quiet hours in your public GitHub activity.

## Interface

- Glass UI with light and dark themes (follows your OS setting; the toggle is remembered on your device) and fluid sizing from phone to widescreen
- Three.js background globe that pulses as accounts are discovered
- Interactive 3D identity graph (drag to rotate, hover for match evidence) with a 2D fallback
- Threat-vector and activity charts with hover details and table views; JSON export and print/PDF

## Run locally

Requires Node.js 18.17+.

```bash
npm install
npm start          # http://localhost:3000
npm test           # unit tests
```

`npm start` serves the static `public/` folder. Three.js and compromise load from jsDelivr through an import map.

## Deployment

Pushing to `main` runs `.github/workflows/pages.yml`: tests, then deploys `public/` to GitHub Pages.

## Privacy and security

- Only public, unauthenticated endpoints are used. No logins, no scraping behind login walls, nothing stored.
- Users must confirm that the accounts are their own.
- Strict Content-Security-Policy: scripts come only from this site and jsDelivr, the import map is allowed by hash, and network access is limited to the listed platform APIs. All third-party data is escaped before rendering.

## Project structure

```
public/
  index.html          Page shell, CSP, import map
  css/styles.css      Glass design system (light/dark, fluid)
  js/app.js           UI controller and report rendering
  js/scene.js         Three.js background globe
  js/graph3d.js       Three.js 3D identity graph
  js/theme.js         Theme bootstrap (no flash)
  js/core/            Scan engine: platforms, NLP, matching, risk, activity
server.js             Local static preview server
test/                 Unit tests (node:test)
```
