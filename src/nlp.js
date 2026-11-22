// NLP layer: pulls personal entities out of profile text.
// Combines pattern matching (emails, phones, wallets, dates...) with
// part-of-speech based named-entity recognition from `compromise`
// (people, places, organisations) and keyword lexicons for sensitive topics.
import nlp from 'compromise';
import { parseProfileUrl } from './urlParser.js';

const trimPunct = (s) => String(s).replace(/^[\s"'([{]+|[\s"',.;:!?)\]}]+$/g, '').trim();
const norm = (s) => trimPunct(s).toLowerCase().replace(/\s+/g, ' ');

const COUNTRIES = new Set(`afghanistan albania algeria argentina australia austria bangladesh belgium brazil bulgaria canada chile china colombia croatia czechia czech republic denmark egypt estonia finland france germany ghana greece hungary iceland india indonesia iran iraq ireland israel italy japan jordan kenya latvia lithuania malaysia mexico morocco nepal netherlands new zealand nigeria norway pakistan peru philippines poland portugal qatar romania russia saudi arabia serbia singapore slovakia slovenia south africa south korea korea spain sri lanka sweden switzerland taiwan thailand turkey uae united arab emirates uganda ukraine united kingdom uk united states usa us vietnam zimbabwe earth worldwide remote internet`.split(' '));
// Multi-word country names (the split above only yields single words).
['czech republic', 'new zealand', 'saudi arabia', 'south africa', 'south korea', 'sri lanka', 'united arab emirates', 'united kingdom', 'united states'].forEach((c) => COUNTRIES.add(c));

const PATTERNS = [
  { type: 'email', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  {
    type: 'email',
    re: /\b([A-Za-z0-9._%+-]+)\s*(?:\[at\]|\(at\)|\{at\}|\s+at\s+)\s*([A-Za-z0-9-]+)\s*(?:\[dot\]|\(dot\)|\{dot\}|\s+dot\s+)\s*([A-Za-z]{2,})\b/gi,
    map: (m) => `${m[1]}@${m[2]}.${m[3]}`.toLowerCase(),
    note: 'obfuscated',
  },
  {
    type: 'phone',
    re: /(?<![\w/.-])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{2,5}(?:[\s.-]?\d{2,5}){1,3}(?![\w/-])/g,
    filter: (v) => {
      const digits = v.replace(/\D/g, '');
      if (digits.length < 10 || digits.length > 15) return false;
      if (/^(19|20)\d{2}\s*[-–]\s*(19|20)\d{2}$/.test(v.trim())) return false; // year ranges
      return v.trim().startsWith('+') || /[\s.()-]/.test(v.trim()) || digits.length === 10;
    },
  },
  {
    type: 'address',
    re: /\b\d{1,5}[A-Za-z]?,?\s+(?:[A-Z][a-z]+\s){1,4}(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Boulevard|Blvd|Way|Court|Ct|Place|Pl|Nagar|Marg|Colony|Sector)\b\.?/g,
  },
  { type: 'crypto', re: /\b0x[a-fA-F0-9]{40}\b/g, note: 'Ethereum address' },
  { type: 'crypto', re: /\bbc1[a-z0-9]{25,59}\b/g, note: 'Bitcoin address' },
  { type: 'crypto', re: /\b[a-z0-9-]{3,}\.eth\b/gi, note: 'ENS name' },
  { type: 'age', re: /\b(\d{2})\s*(?:y\/o|yo|years?\s+old|yrs?\s+old)\b/gi, map: (m) => `${m[1]} years old` },
  { type: 'age', re: /\bage[:\s]+(\d{2})\b/gi, map: (m) => `${m[1]} years old` },
  {
    type: 'birthdate',
    re: /(?:\b(?:born|b\.|bday|birthday|dob|date of birth)|🎂)\s*[:\-–]?\s*(?:on\s+|in\s+)?((?:\d{1,2}(?:st|nd|rd|th)?\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?(?:\s+\d{1,2}(?:st|nd|rd|th)?(?!\d))?(?:,?\s+(?:19|20)\d{2})?|\d{1,2}[/.-]\d{1,2}(?:[/.-](?:19|20)?\d{2})?|(?:19|20)\d{2})/gi,
    map: (m) => trimPunct(m[1]),
  },
  { type: 'pronouns', re: /\b(she\/her|he\/him|they\/them|she\/they|he\/they|they\/she|they\/he|xe\/xem|any\/all)\b/gi, map: (m) => m[1].toLowerCase() },
  { type: 'url', re: /\bhttps?:\/\/[^\s<>"')\]]+/g, map: (m) => m[0].replace(/[.,;:]+$/, '') },
  { type: 'handle', re: /(?:^|[\s(,])@([A-Za-z0-9_][A-Za-z0-9_.-]{1,29})\b/g, map: (m) => `@${m[1]}` },
];

const JOB_TITLES = /\b(software engineer|software developer|full[- ]stack developer|frontend developer|backend developer|web developer|data scientist|data analyst|ml engineer|machine learning engineer|security researcher|product manager|engineering manager|co-?founder|founder|ceo|cto|cfo|developer|engineer|designer|researcher|student|intern|freelancer|consultant|professor|lecturer|teacher|nurse|doctor|physician|lawyer|architect|photographer|writer|journalist|devops|sre)\b/gi;

const EMPLOYER_TRIGGER = /\b(?:work(?:ing|s)?\s+(?:at|for|with)|employed\s+(?:at|by)|(?:engineer|developer|designer|manager|intern|scientist|analyst|researcher|founder|cto|ceo|lead|consultant|architect|sde|swe|head of [a-z]+)\s+(?:at|@))\s+@?([^\n,.;|]{2,60})/gi;
const EDUCATION_PATTERNS = [
  /\b(?:student|studying|undergrad|graduate|grad student|alum(?:nus|na|ni)?|ph\.?d\.?(?: candidate)?|b\.?tech|m\.?tech|b\.?sc|m\.?sc|bachelor'?s|master'?s)\b[^\n.]{0,30}?\b(?:at|@|from|in)\s+([^\n,.;|]{2,60})/gi,
  /\b((?:University|College|Institute|School|Academy) of [A-Z][\w-]*(?:\s+[A-Z][\w-]*){0,3})/g,
  /\b([A-Z][\w-]*(?:\s+[A-Z][\w-]*){0,3}\s+(?:University|College|Institute of Technology|Institute|Academy|High School|School))\b/g,
  /\b((?:IIT|NIT|IIIT|BITS)\s?[A-Z][a-z]+|MIT|Caltech|UCLA|UC Berkeley)\b/g,
];
const LOCATION_TRIGGER = /\b(?:based in|living in|lives in|live in|located in|from|currently in|📍)\s+([A-Z][\w-]*(?:[\s,]+[A-Z][\w-]*){0,3})/g;

const FAMILY = /\b(mom|mum|mother|dad|father|wife|husband|married|parent of|son|daughter|kids?|children|grandma|grandpa|fianc[ée]e?|girlfriend|boyfriend|newlywed|twins)\b/gi;
const TRAVEL = /\b(on vacation|on holiday|travel(?:l)?ing (?:to|in|through)|away (?:until|till|from)|out of (?:the )?office|ooo until|moving to|relocating to|visiting [A-Z][a-z]+)\b[^\n.|;]{0,40}/gi;
const SENSITIVE = {
  health: /\b(diagnosed|adhd|autis(?:m|tic)|anxiety|depression|bipolar|cancer (?:survivor|patient)|diabetic|diabetes|chronic(?:ally)? ill(?:ness)?|disab(?:led|ility)|mental health|in therapy|pregnant|ptsd|ocd|neurodivergent|spoonie)\b/gi,
  religion: /\b(christian|muslim|hindu|jewish|buddhist|sikh|catholic|atheist|agnostic|church|mosque|synagogue|bible|quran|jesus)\b/gi,
  politics: /\b(democrat|republican|liberal|conservative|socialist|communist|libertarian|leftist|maga|progressive|labour party|tory|activist|anti-?fascist|feminist)\b/gi,
};

/** Keep leading proper-noun-ish tokens from a captured phrase ("Google and I love tea" -> "Google"). */
function takeProper(phrase) {
  const tokens = trimPunct(phrase).split(/\s+/);
  const out = [];
  for (const t of tokens) {
    if (/^(?:[A-Z@&]|[a-z]+[A-Z])/.test(t) || (out.length && /^(of|&|and|de|la|the)$/.test(t))) out.push(t);
    else break;
  }
  while (out.length && /^(of|&|and|de|la|the)$/i.test(out[out.length - 1])) out.pop();
  return trimPunct(out.join(' ').replace(/^@/, ''));
}

function snippetAround(text, index, length) {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + length + 40);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`;
}

export function classifyLocation(value) {
  if (/\b\d{1,5}\s+\w+\s+(street|st|road|rd|avenue|ave|lane|ln|drive|dr|nagar|marg)\b/i.test(value)) return 'address';
  const parts = norm(value).split(/\s*,\s*/).filter(Boolean);
  if (parts.length === 1 && COUNTRIES.has(parts[0])) return 'country';
  return 'city';
}

export function looksLikeRealName(name) {
  if (!name) return false;
  const n = name.trim();
  if (/\d|_|@|\.(com|io|dev)/.test(n)) return false;
  if (/^\p{Lu}[\p{L}'’-]+(?:\s+\p{Lu}\.?)?(?:\s+\p{Lu}[\p{L}'’.-]+){1,3}$/u.test(n)) return true;
  return nlp(n).people().found && n.split(/\s+/).length >= 2;
}

/**
 * Extract entities from one normalised profile.
 * @returns {Array<{type, value, subtype?, field, snippet, platform}>}
 */
export function extractEntities(p) {
  const found = [];
  const add = (type, value, field, snippet, subtype) => {
    const v = trimPunct(value);
    if (!v || v.length < 2) return;
    // Links to other platform profiles are linkability (handled by matching), not personal data.
    if (type === 'url' && parseProfileUrl(v)) return;
    found.push({ type, subtype, value: v, field, snippet: snippet || v, platform: p.platform });
  };

  // Structured fields first — these are explicit disclosures.
  if (p.displayName && looksLikeRealName(p.displayName)) add('name', p.displayName, 'display name');
  if (p.location) {
    const kind = classifyLocation(p.location);
    add(kind === 'address' ? 'address' : 'location', p.location, 'location field', p.location, kind);
  }
  if (p.company) add('organization', p.company.replace(/^@/, ''), 'company field');
  for (const e of p.emails) add('email', e.toLowerCase(), 'public email field');
  if (p.website) add('url', p.website, 'website field');

  // Free text: bio + extra fields.
  const texts = [['bio', p.bio], ...p.extraText.map((t) => ['profile fields', t])].filter(([, t]) => t);
  for (const [field, raw] of texts) {
    const text = String(raw);

    for (const pat of PATTERNS) {
      for (const m of text.matchAll(pat.re)) {
        const value = pat.map ? pat.map(m) : m[0];
        if (pat.filter && !pat.filter(value)) continue;
        add(pat.type, pat.type === 'email' ? value.toLowerCase() : value, field, snippetAround(text, m.index, m[0].length), pat.note);
      }
    }

    for (const m of text.matchAll(JOB_TITLES)) add('job', m[1].toLowerCase(), field, snippetAround(text, m.index, m[0].length));
    for (const m of text.matchAll(EMPLOYER_TRIGGER)) {
      const org = takeProper(m[1]);
      if (org) add('organization', org, field, snippetAround(text, m.index, m[0].length));
    }
    for (const re of EDUCATION_PATTERNS) {
      for (const m of text.matchAll(re)) {
        const school = /^[A-Z]/.test(m[1]) ? trimPunct(m[1]) : takeProper(m[1]);
        if (school) add('education', school, field, snippetAround(text, m.index, m[0].length));
      }
    }
    for (const m of text.matchAll(LOCATION_TRIGGER)) {
      const place = trimPunct(m[1]);
      if (place) add('location', place, field, snippetAround(text, m.index, m[0].length), classifyLocation(place));
    }
    for (const m of text.matchAll(FAMILY)) add('family', m[1].toLowerCase(), field, snippetAround(text, m.index, m[0].length));
    for (const m of text.matchAll(TRAVEL)) add('travel', trimPunct(m[0]), field, snippetAround(text, m.index, m[0].length));
    for (const [topic, re] of Object.entries(SENSITIVE)) {
      for (const m of text.matchAll(re)) add('sensitive', m[1].toLowerCase(), field, snippetAround(text, m.index, m[0].length), topic);
    }

    // Statistical NER (compromise) for places / organisations the patterns missed.
    // Only on free-form bios: structured fields and package descriptions produce noise.
    if (field !== 'bio') continue;
    const doc = nlp(text);
    for (const place of doc.places().out('array')) {
      const v = trimPunct(place);
      if (v.length > 2) add('location', v, field, snippetAround(text, text.indexOf(place), place.length), classifyLocation(v));
    }
    for (const org of doc.organizations().out('array')) {
      const v = trimPunct(org);
      if (v.length > 1 && !/^(university|college)$/i.test(v)) {
        const isSchool = /universit|college|institute|school|academy|\bIIT\b|\bNIT\b/i.test(v);
        add(isSchool ? 'education' : 'organization', v, field, snippetAround(text, text.indexOf(org), org.length));
      }
    }
  }

  return found;
}

/** Merge entities across profiles: same type + normalised value -> one entity with many sources. */
export function mergeEntities(list) {
  const map = new Map();
  for (const e of list) {
    let key = `${e.type}:${norm(e.value)}`;
    if (e.type === 'url') key = `url:${norm(e.value).replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}`;
    if (!map.has(key)) map.set(key, { type: e.type, subtype: e.subtype, value: e.value, sources: [] });
    const ent = map.get(key);
    if (!ent.sources.some((s) => s.platform === e.platform && s.field === e.field)) {
      ent.sources.push({ platform: e.platform, field: e.field, snippet: e.snippet });
    }
  }
  // A place that is also an organisation name, or a substring of a longer location, is noise.
  const ents = [...map.values()];
  return ents.filter((e) => {
    if (e.type !== 'location') return true;
    const v = norm(e.value);
    return !ents.some((o) => o !== e && o.type === 'location' && norm(o.value) !== v && norm(o.value).includes(v) && o.sources.length >= e.sources.length);
  });
}

// ---------- shared text utilities (used by entity matching) ----------
const STOP = new Set('a an and are as at be by for from has have i im i\'m in is it its me my of on or our so that the this to was we with you your love like just'.split(' '));
export function tokens(text) {
  return String(text || '').toLowerCase().replace(/https?:\/\/\S+/g, ' ').split(/[^\p{L}\p{N}+#]+/u).filter((t) => t.length > 1 && !STOP.has(t));
}
export { norm };
