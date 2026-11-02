/**
 * Copy quality gate, adapted from the stop-slop idea.
 * Scores directness, rhythm, trust, authenticity and density out of 50.
 * Used as a review pass, not a rewrite engine: em dashes and adverbs are
 * warnings, not hard bans.
 */

export interface SlopIssue {
  kind: 'banned' | 'filler' | 'rhythm' | 'trust' | 'density' | 'warning';
  detail: string;
  weight: number;
}

export interface SlopResult {
  score: number;
  issues: SlopIssue[];
}

const BANNED: Array<[RegExp, string, number]> = [
  [/\bunlock(?:s|ed|ing)?\b/gi, 'unlock', 4],
  [/\bunleash(?:es|ed|ing)?\b/gi, 'unleash', 4],
  [/\belevat(?:e|es|ed|ing)\b/gi, 'elevate', 4],
  [/\bsupercharg(?:e|es|ed|ing)\b/gi, 'supercharge', 4],
  [/\bseamless(?:ly)?\b/gi, 'seamless', 3],
  [/\bgame[- ]changer\b/gi, 'game-changer', 4],
  [/\bcutting[- ]edge\b/gi, 'cutting-edge', 3],
  [/\brevolutioni[sz](?:e|es|ed|ing|ary)\b/gi, 'revolutionize', 4],
  [/\btransformative\b/gi, 'transformative', 3],
  [/\bdelve(?:s|d)?\b/gi, 'delve', 4],
  [/\bever[- ]evolving\b/gi, 'ever-evolving', 3],
  [/\btapestry\b/gi, 'tapestry', 4],
  [/\btestament to\b/gi, 'testament to', 4],
  [/\bnot just (?:a|an|the)\b/gi, "not just a…", 3],
  [/\bmore than just\b/gi, 'more than just', 3],
  [/\bthe future of\b/gi, 'the future of', 2],
  [/\bnext[- ]level\b/gi, 'next-level', 3],
  [/\bbest[- ]in[- ]class\b/gi, 'best-in-class', 3],
  [/\bworld[- ]class\b/gi, 'world-class', 3],
  [/\bsynerg(?:y|ies|istic)\b/gi, 'synergy', 4],
  [/\bleverag(?:e|es|ed|ing)\b/gi, 'leverage', 3],
  [/\bempower(?:s|ed|ing)?\b/gi, 'empower', 3],
  [/\bparadigm\b/gi, 'paradigm', 3],
  [/\bdisrupt(?:s|ed|ing|ive)?\b/gi, 'disrupt', 2],
  [/\bin today's fast[- ]paced\b/gi, "in today's fast-paced…", 5],
];

const FILLER: Array<[RegExp, string]> = [
  [/\bin order to\b/gi, 'in order to'],
  [/\bthe fact that\b/gi, 'the fact that'],
  [/\bit is important to note\b/gi, 'it is important to note'],
  [/\bat the end of the day\b/gi, 'at the end of the day'],
  [/\bwhen it comes to\b/gi, 'when it comes to'],
  [/\bneedless to say\b/gi, 'needless to say'],
];

const ABSOLUTES: Array<[RegExp, string]> = [
  [/\bguarantee(?:d|s)?\b/gi, 'guaranteed'],
  [/\balways\b/gi, 'always'],
  [/\bnever\b/gi, 'never'],
  [/\beveryone\b/gi, 'everyone'],
  [/\bno one\b/gi, 'no one'],
];

function linesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function adverbCount(text: string): number {
  const matches = text.match(/\b[a-z]{5,}ly\b/gi) ?? [];
  const allowed = new Set(['only', 'early', 'daily', 'weekly', 'monthly', 'yearly', 'family', 'reply']);
  return matches.filter((word) => !allowed.has(word.toLowerCase())).length;
}

export function scoreCopy(text: string): SlopResult {
  const value = String(text ?? '').trim();
  if (!value) return { score: 50, issues: [] };

  const issues: SlopIssue[] = [];
  let deduction = 0;

  for (const [pattern, label, weight] of BANNED) {
    const hits = value.match(pattern)?.length ?? 0;
    if (hits > 0) {
      const applied = Math.min(weight * hits, weight * 2);
      deduction += applied;
      issues.push({ kind: 'banned', detail: label, weight: applied });
    }
  }

  for (const [pattern, label] of FILLER) {
    const hits = value.match(pattern)?.length ?? 0;
    if (hits > 0) {
      deduction += Math.min(2 * hits, 4);
      issues.push({ kind: 'filler', detail: label, weight: Math.min(2 * hits, 4) });
    }
  }

  for (const [pattern, label] of ABSOLUTES) {
    const hits = value.match(pattern)?.length ?? 0;
    if (hits > 0) {
      deduction += Math.min(hits, 2);
      issues.push({ kind: 'trust', detail: label, weight: Math.min(hits, 2) });
    }
  }

  const emDashes = (value.match(/—/g) ?? []).length;
  if (emDashes > 2) {
    deduction += 2;
    issues.push({ kind: 'warning', detail: `${emDashes} em dashes`, weight: 2 });
  }

  const adverbs = adverbCount(value);
  if (adverbs > 3) {
    deduction += 2;
    issues.push({ kind: 'warning', detail: `${adverbs} -ly adverbs`, weight: 2 });
  }

  const softeners = (value.match(/\b(?:very|really|just|actually|quite|simply)\b/gi) ?? []).length;
  if (softeners > 2) {
    deduction += 2;
    issues.push({ kind: 'density', detail: `${softeners} softener words`, weight: 2 });
  }

  const lines = linesOf(value);
  const lengths = lines.map((line) => line.split(/\s+/).length).filter((n) => n > 0);
  if (lengths.length >= 4) {
    const average = lengths.reduce((sum, n) => sum + n, 0) / lengths.length;
    const variance = lengths.reduce((sum, n) => sum + (n - average) ** 2, 0) / lengths.length;
    if (variance < 4) {
      deduction += 2;
      issues.push({ kind: 'rhythm', detail: 'uniform sentence length', weight: 2 });
    }
    if (average > 28) {
      deduction += 2;
      issues.push({ kind: 'rhythm', detail: `average sentence ${Math.round(average)} words`, weight: 2 });
    }
  }

  const passive = (value.match(/\b(?:was|were|is being|are being)\s+\w+ed\b/gi) ?? []).length;
  if (passive > 1) {
    deduction += 2;
    issues.push({ kind: 'density', detail: `${passive} passive constructions`, weight: 2 });
  }

  return { score: Math.max(0, Math.min(50, 50 - deduction)), issues };
}

export interface CopyLine {
  path: string;
  value: string;
}

export function collectCopy(
  spec: Record<string, unknown>,
  capability: string,
): CopyLine[] {
  const lines: CopyLine[] = [];
  const push = (path: string, value: unknown) => {
    if (typeof value === 'string' && value.trim()) lines.push({ path, value: value.trim() });
  };

  if (capability === 'deck-native') {
    push('title', spec.title);
    push('subtitle', spec.subtitle);
    const slides = Array.isArray(spec.slides) ? spec.slides : [];
    slides.forEach((slide, index) => {
      const item = (slide ?? {}) as Record<string, unknown>;
      push(`slides.${index}.title`, item.title);
      const bullets = Array.isArray(item.bullets) ? item.bullets : [];
      bullets.forEach((bullet, bulletIndex) => push(`slides.${index}.bullets.${bulletIndex}`, bullet));
    });
  } else if (capability === 'film-brand') {
    push('title', spec.title);
    push('subtitle', spec.subtitle);
    const bullets = Array.isArray(spec.bullets) ? spec.bullets : [];
    bullets.forEach((bullet, index) => push(`bullets.${index}`, bullet));
  }

  return lines;
}

export function applyCopy(spec: Record<string, unknown>, lines: CopyLine[]): Record<string, unknown> {
  const next = JSON.parse(JSON.stringify(spec)) as Record<string, unknown>;
  for (const line of lines) {
    const parts = line.path.split('.');
    let cursor: unknown = next;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const key = parts[index];
      if (Array.isArray(cursor)) cursor = cursor[Number(key)];
      else if (cursor && typeof cursor === 'object') cursor = (cursor as Record<string, unknown>)[key];
      else cursor = undefined;
    }
    const last = parts[parts.length - 1];
    if (Array.isArray(cursor)) cursor[Number(last)] = line.value;
    else if (cursor && typeof cursor === 'object') (cursor as Record<string, unknown>)[last] = line.value;
  }
  return next;
}

export function summarise(issues: SlopIssue[]): string {
  return issues
    .slice(0, 6)
    .map((issue) => `${issue.detail} (-${issue.weight})`)
    .join(', ');
}
