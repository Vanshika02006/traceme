// Risk classification: turns exposed entities + linkability into scored,
// explained findings, then classifies overall exposure and threat vectors.

export const SEVERITY_POINTS = { low: 4, medium: 10, high: 18, critical: 28 };
const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];

export const THREATS = {
  doxxing: 'Doxxing',
  identity_theft: 'Identity theft',
  phishing: 'Phishing & social engineering',
  account_takeover: 'Account takeover',
  stalking: 'Stalking & physical safety',
};

// How each entity type is classified when exposed.
const RULES = {
  phone: { severity: 'critical', threats: ['doxxing', 'phishing', 'account_takeover'], title: 'Phone number exposed', rec: 'Remove the number from public profiles. Phone numbers enable SIM-swap attacks, SMS phishing and reverse lookups. Use an authenticator app instead of SMS 2FA.' },
  address: { severity: 'critical', threats: ['doxxing', 'stalking', 'identity_theft'], title: 'Street address exposed', rec: 'Remove the street address immediately. Use only a city or region, or nothing at all.' },
  commit_email: { severity: 'high', threats: ['phishing', 'account_takeover'], title: 'Email address exposed in your public git commits', rec: 'Anyone can read the author email of every public commit. On GitHub, go to Settings → Emails and turn on "Keep my email addresses private" and "Block command line pushes that expose my email". Then run git config --global user.email "<ID>+<username>@users.noreply.github.com" (your exact noreply address is shown on that page). Old commits keep the old email unless you rewrite the history, so also make sure this inbox has a strong unique password and 2FA.' },
  email: { severity: 'high', threats: ['phishing', 'account_takeover'], title: 'Email address exposed', rec: 'Hide the email or replace it with a forwarding alias (e.g. a GitHub noreply address, SimpleLogin, Firefox Relay). Check it on haveibeenpwned.com and make sure it has a unique password and 2FA.' },
  birthdate: { severity: 'high', threats: ['identity_theft', 'account_takeover'], title: 'Birth date disclosed', rec: 'Birth dates are a common security question and identity-verification field. Remove them from public bios.' },
  travel: { severity: 'high', threats: ['stalking', 'phishing'], title: 'Travel plans or absence disclosed', rec: 'Announcing when you are away tells people when your home is empty and gives scammers a convincing pretext. Post about trips after you return.' },
  first_name: { severity: 'low', threats: ['phishing'], title: 'First name visible and built into your username', rec: 'Your first name alone is low risk, but a username made from it is easy to guess and search. Combined with an email or location it makes you easier to find and to address convincingly in scam messages.' },
  name: { severity: 'medium', threats: ['doxxing', 'identity_theft', 'phishing'], title: 'Real name linked to username', rec: 'Consider using a pseudonym on hobby or community platforms so they cannot be tied to your legal identity.' },
  location_city: { severity: 'medium', threats: ['doxxing', 'stalking'], title: 'City-level location exposed', rec: 'Use a broader region (country or "Earth") unless the location is needed professionally.' },
  location_country: { severity: 'low', threats: ['doxxing'], title: 'Country exposed', rec: 'Low risk on its own, but it narrows down searches when combined with other details.' },
  organization: { severity: 'medium', threats: ['phishing'], title: 'Employer or organisation exposed', rec: 'Employer details let attackers impersonate colleagues or IT staff (spear-phishing). Be suspicious of unexpected "work" messages and consider removing the employer from non-professional profiles.' },
  education: { severity: 'low', threats: ['phishing', 'identity_theft'], title: 'School or university exposed', rec: 'School names are common security-question answers. Remove them from profiles that do not need them.' },
  age: { severity: 'medium', threats: ['identity_theft'], title: 'Age disclosed', rec: 'Age plus name and location narrows identity lookups considerably. Consider removing it.' },
  family: { severity: 'medium', threats: ['phishing', 'stalking'], title: 'Family or relationship details', rec: 'Family details fuel "grandparent"/impersonation scams and can expose people who did not consent. Keep them off public bios.' },
  crypto: { severity: 'medium', threats: ['phishing', 'doxxing'], title: 'Crypto wallet linked to identity', rec: 'Public wallets reveal balances and full transaction history. Use a separate wallet for public donations.' },
  pronouns: { severity: 'low', threats: [], title: 'Pronouns listed', rec: 'Sharing pronouns is a personal choice; it is listed only so you know it is public.' },
  job: { severity: 'low', threats: ['phishing'], title: 'Job role disclosed', rec: 'Usually fine on professional profiles; combined with an employer it makes targeted phishing easier.' },
};
const SENSITIVE_RULE = {
  health: { severity: 'high', title: 'Health information disclosed' },
  religion: { severity: 'medium', title: 'Religious affiliation disclosed' },
  politics: { severity: 'medium', title: 'Political views disclosed' },
};

const scoreFrom = (points) => Math.round(100 * (1 - Math.exp(-points / 60)));
const levelOf = (s) => (s >= 75 ? 'Critical' : s >= 50 ? 'High' : s >= 25 ? 'Moderate' : 'Low');

/**
 * @param ctx { profiles, entities, matching, activity }
 */
export function classifyRisk({ profiles, entities, matching, activity }) {
  const conf = (platform) => {
    const ps = profiles.filter((p) => p.platform === platform);
    return Math.max(0, ...ps.map((p) => matching.confidence[p.id]?.score ?? 0));
  };
  const findings = [];
  const push = (f) => findings.push({ id: `f${findings.length + 1}`, ...f });

  // 1. Per-entity exposure findings.
  const groups = new Map();
  for (const e of entities) {
    let key = e.type;
    if (e.type === 'location') key = e.subtype === 'country' ? 'location_country' : e.subtype === 'address' ? 'address' : 'location_city';
    if (e.type === 'sensitive') key = `sensitive_${e.subtype}`;
    if (e.type === 'name' && e.subtype === 'first name') key = 'first_name';
    if (e.type === 'email' && e.sources.some((src) => src.field === 'commit author email')) key = 'commit_email';
    if (!RULES[key] && !key.startsWith('sensitive_')) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }

  const groupConfidence = new Map();
  const entConf = (e) => Math.max(...e.sources.map((s) => conf(s.platform)));
  for (const [key, all] of groups) {
    let rule = RULES[key];
    if (key.startsWith('sensitive_')) {
      const topic = key.slice(10);
      rule = { ...SENSITIVE_RULE[topic], threats: ['phishing', 'doxxing'], rec: 'Special-category data (health, religion, politics) can lead to discrimination or harassment. Share it only where you are comfortable with it being permanent and public.' };
    }
    // Split into details from accounts that are probably yours vs. ones that may be someone else's.
    const parts = [all.filter((e) => entConf(e) >= 0.45), all.filter((e) => entConf(e) < 0.45)];
    parts.forEach((ents, idx) => {
      if (!ents.length) return;
      const unverified = idx === 1;
      const confidence = Math.max(...ents.map(entConf));
      const platforms = [...new Set(ents.flatMap((e) => e.sources.map((s) => s.platform)))];
      if (!unverified) groupConfidence.set(key, confidence);
      push({
        category: 'exposure', type: key, severity: rule.severity,
        title: unverified ? `${rule.title} (unverified account)` : rule.title, threats: rule.threats,
        detail: `${ents.map((e) => `“${e.value}”`).slice(0, 4).join(', ')}${ents.length > 4 ? ` and ${ents.length - 4} more` : ''} visible on ${platforms.length} platform${platforms.length > 1 ? 's' : ''}.${unverified ? ' These accounts share your username but may belong to someone else — check them before acting.' : ''}`,
        evidence: ents.flatMap((e) => e.sources.map((s) => ({ platform: s.platform, value: e.value, field: s.field, snippet: s.snippet }))).slice(0, 8),
        recommendation: rule.rec, confidence: +confidence.toFixed(2), unverified,
      });
    });
  }

  // 2. Cross-platform linkability.
  const likely = profiles.filter((p) => (matching.confidence[p.id]?.score ?? 0) >= 0.45);
  const reuseCount = new Set(likely.map((p) => p.platform)).size;
  if (reuseCount >= 2) {
    push({
      category: 'linkability', type: 'username_reuse', severity: reuseCount >= 6 ? 'high' : reuseCount >= 3 ? 'medium' : 'low',
      title: `Same identity found on ${reuseCount} platforms`, threats: ['doxxing', 'account_takeover', 'phishing'],
      detail: `A single username search links ${likely.map((p) => p.platformName).join(', ')}. Details shared on one site can be combined with the others.`,
      evidence: likely.map((p) => ({ platform: p.platform, value: p.username, field: 'username', snippet: p.url })),
      recommendation: 'Use different usernames for unrelated parts of your life (work, hobbies, gaming), and delete accounts you no longer use.',
      confidence: 1,
    });
  }
  const cluster = matching.clusters[0] || [];
  if (cluster.length >= 2) {
    const strongEdges = matching.edges.filter((e) => e.score >= 0.5 && cluster.includes(e.source));
    push({
      category: 'linkability', type: 'identity_cluster', severity: cluster.length >= 3 ? 'high' : 'medium',
      title: `${cluster.length} accounts can be joined into one profile`, threats: ['doxxing', 'stalking'],
      detail: 'Strong matching signals (cross-links, shared email/website, identical names or bios) let an observer confirm these accounts belong to the same person, not just share a username.',
      evidence: strongEdges.slice(0, 6).map((e) => ({ platform: e.source.split(':')[0], value: `${e.source} ↔ ${e.target}`, field: 'match', snippet: e.evidence.join('; ') })),
      recommendation: 'Remove cross-links between personal and professional accounts, and avoid reusing the same bio, photo or website everywhere.',
      confidence: 1,
    });
  }

  // 3. Temporal fingerprint.
  if (activity?.inferred && activity.inferred.quietShare < 0.08) {
    push({
      category: 'behavioural', type: 'timezone', severity: 'low', title: `Activity pattern reveals your timezone (${activity.inferred.label})`,
      threats: ['doxxing', 'stalking'],
      detail: `${activity.events} public activity timestamps show a consistent quiet period (likely sleep) from ${activity.inferred.quietWindowUtc[0]}:00 to ${activity.inferred.quietWindowUtc[1]}:00 UTC.`,
      evidence: [{ platform: 'github', value: activity.inferred.label, field: 'public events', snippet: `Peak activity at ${activity.inferred.peakHourUtc}:00 UTC` }],
      recommendation: 'Timezone inference is hard to avoid. Be aware that "anonymous" accounts with the same rhythm can be correlated with this one.',
      confidence: conf('github'),
    });
  }

  // 4. Combination rules — risks that only exist when details are combined.
  // Combinations only count details from accounts that are probably yours.
  const has = (k) => (groupConfidence.get(k) ?? 0) >= 0.45;
  if (has('name') && (has('birthdate') || has('age')) && (has('location_city') || has('address'))) {
    push({
      category: 'combination', type: 'identity_kit', severity: 'critical', title: 'Identity-theft starter kit',
      threats: ['identity_theft'],
      detail: 'Your real name, age/birth date and location are all public. Together these are enough to start account-recovery fraud or impersonation.',
      evidence: [], recommendation: 'Remove at least the birth date or age, and generalise your location. Consider a credit freeze if you live in a country that offers one.', confidence: 1,
    });
  }
  if (has('email') && reuseCount >= 3) {
    push({
      category: 'combination', type: 'credential_stuffing', severity: 'high', title: 'Email + reused username: credential-stuffing target',
      threats: ['account_takeover'],
      detail: 'A known email plus a username used across several sites is what automated account-takeover tools look for.',
      evidence: [], recommendation: 'Use a password manager with a unique password per site and turn on 2FA everywhere, especially on the email account itself.', confidence: 1,
    });
  }
  if (has('organization') && (has('name') || has('email'))) {
    push({
      category: 'combination', type: 'spear_phishing', severity: 'medium', title: 'Spear-phishing profile available',
      threats: ['phishing'],
      detail: 'Name/email plus employer is enough to write a convincing message pretending to be a colleague, recruiter or IT department.',
      evidence: [], recommendation: 'Verify unexpected work requests through a second channel, and tell your security team if you are a likely target.', confidence: 1,
    });
  }

  // Scoring: details from accounts that may not be yours barely count.
  const weightOf = (f) => SEVERITY_POINTS[f.severity] * (f.unverified ? 0.15 : f.confidence >= 0.75 ? 1 : 0.5 + 0.5 * f.confidence);
  findings.sort((a, b) => (a.unverified ? 1 : 0) - (b.unverified ? 1 : 0) || SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || b.confidence - a.confidence);
  const total = findings.reduce((s, f) => s + weightOf(f), 0);
  const score = scoreFrom(total);

  const threats = Object.entries(THREATS).map(([id, label]) => {
    const pts = findings.filter((f) => f.threats.includes(id)).reduce((s, f) => s + weightOf(f), 0);
    const s = scoreFrom(pts * 1.4);
    return { id, label, score: s, level: levelOf(s), findings: findings.filter((f) => f.threats.includes(id)).length };
  }).sort((a, b) => b.score - a.score);

  const counts = Object.fromEntries(SEVERITY_ORDER.map((s) => [s, findings.filter((f) => f.severity === s && !f.unverified).length]));
  counts.unverified = findings.filter((f) => f.unverified).length;
  return { score, level: levelOf(score), counts, threats, findings };
}
