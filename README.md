# TraceMe – Your Digital Footprint Investigator

Enter your publicly available usernames or profile URLs. TraceMe analyses publicly accessible information to show your digital footprint, privacy exposure and potential risks.

## Features

- **Account discovery**: checks each username on 15 platforms through their official public APIs (GitHub, GitLab, Hacker News, DEV, Keybase, Chess.com, Lichess, Codeforces, Mastodon, Bluesky, Docker Hub, npm, Reddit, Duolingo, Wikipedia). Links found in profiles are followed one hop. Login-walled sites (Instagram, LinkedIn, X, …) are recorded but never scraped.
- **NLP entity extraction** (`src/nlp.js`): finds emails (including obfuscated `name [at] domain [dot] com`), phone numbers, street addresses, locations, employers, schools, job roles, birth dates, ages, pronouns, family mentions, travel/absence announcements, crypto wallets and sensitive topics (health, religion, politics). It combines regex patterns, keyword lists and named-entity recognition with [compromise](https://github.com/spencermountain/compromise).
- **Entity matching** (`src/matching.js`): works out which accounts really belong to the same person, so a stranger who happens to share your username isn't counted as you. Signals: cross-links, shared email or website, Jaro-Winkler name similarity, location overlap and TF-IDF bio similarity. They are combined with a noisy-OR and reduced by conflicting evidence. The output is a per-account "is this you?" score and identity clusters.
- **Risk classification** (`src/risk.js`): rates each exposure by severity, maps it to threat vectors (doxxing, identity theft, phishing, account takeover, stalking) and flags dangerous combinations (e.g. name + birth date + city). The result is a 0–100 exposure score. Details from unverified accounts are shown separately and barely affect the score.
- **Temporal fingerprinting** (`src/activity.js`): estimates your timezone from the quiet hours (sleep) in your public GitHub activity.
- **Report UI**: score, threat-vector chart, ranked findings with fixes, account cards with match explanations, exposed-data table, identity graph, activity chart, JSON export and print/PDF.

## Run it

Requires Node.js 18.17+.

```bash
npm install
npm start          # http://localhost:3000
npm test           # unit tests
```

Optional environment variables:

| Variable | Purpose |
|---|---|
| `PORT` | Port to listen on (default 3000) |
| `GITHUB_TOKEN` | Raises the GitHub API limit from 60 to 5,000 requests/hour |

## Privacy and ethics

- Only public, unauthenticated endpoints are used. No logins, no scraping behind login walls.
- Nothing is stored: scans run in memory and the report exists only in the browser.
- Users must confirm that the accounts are their own. The API is rate-limited (5 scans/minute per IP).
- Strict Content-Security-Policy, and all third-party data is escaped before rendering.

## Project structure

```
server.js            Express server, API, rate limiting, security headers
src/analyze.js       Scan pipeline orchestration
src/platforms.js     Platform connectors (public APIs)
src/urlParser.js     Username / profile-URL parsing
src/nlp.js           Entity extraction
src/matching.js      Cross-platform identity matching
src/risk.js          Risk scoring and classification
src/activity.js      Activity-time analysis
public/              Front end (vanilla HTML/CSS/JS)
test/                Unit tests (node:test)
```
