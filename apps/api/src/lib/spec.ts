import type { Capability } from '../capabilities';

const MAX_SLIDES = 12;
const MAX_BULLETS = 8;

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function hex(value: unknown, fallback: string): string {
  const candidate = str(value);
  return /^#[0-9a-f]{6}$/i.test(candidate) ? candidate : fallback;
}

function bullets(value: unknown, limit = 5): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, limit);
}

export interface Validation {
  ok: boolean;
  spec: Record<string, unknown>;
  problem?: string;
}

export function validateSpec(capability: Capability, raw: unknown): Validation {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  if (capability.id === 'deck-native') {
    const title = str(input.title);
    const slides = Array.isArray(input.slides)
      ? input.slides
          .map((slide) => {
            const item = (slide && typeof slide === 'object' ? slide : {}) as Record<string, unknown>;
            const slideTitle = str(item.title);
            const slideBullets = bullets(item.bullets);
            if (!slideTitle) return null;
            return {
              title: slideTitle,
              bullets: slideBullets.length ? slideBullets : ['Key point to expand'],
              notes: str(item.notes) || undefined,
            };
          })
          .filter(Boolean)
          .slice(0, MAX_SLIDES)
      : [];

    if (!title) return { ok: false, spec: {}, problem: 'A deck needs a title.' };
    if (!slides.length) return { ok: false, spec: {}, problem: 'A deck needs at least one content slide.' };

    return {
      ok: true,
      spec: {
        title,
        subtitle: str(input.subtitle) || undefined,
        theme: str(input.theme) || 'gtm',
        slides,
      },
    };
  }

  if (capability.id === 'film-brand') {
    const title = str(input.title);
    const subtitle = str(input.subtitle);
    const lines = bullets(input.bullets, 3);
    if (!title) return { ok: false, spec: {}, problem: 'A film needs a title.' };
    while (lines.length < 3) lines.push('');
    return {
      ok: true,
      spec: {
        title,
        subtitle,
        bullets: lines.slice(0, 3),
        accent: hex(input.accent, '#34D399'),
      },
    };
  }

  if (capability.id === 'voice-kokoro') {
    const text = str(input.text);
    if (!text) return { ok: false, spec: {}, problem: 'Narration needs a script.' };
    const speed = Number(input.speed);
    return {
      ok: true,
      spec: {
        text: text.slice(0, 3000),
        voice: str(input.voice) || 'af_heart',
        speed: Number.isFinite(speed) ? Math.min(1.5, Math.max(0.5, speed)) : 1,
      },
    };
  }

  if (capability.id === 'voice-xtts') {
    const text = str(input.text);
    const reference = str(input.reference_url);
    if (!text) return { ok: false, spec: {}, problem: 'Narration needs a script.' };
    if (!/^https?:\/\//i.test(reference)) {
      return { ok: false, spec: {}, problem: 'Voice cloning needs a public reference audio URL.' };
    }
    return {
      ok: true,
      spec: {
        text: text.slice(0, 2000),
        reference_url: reference,
        language: str(input.language) || 'en',
      },
    };
  }

  return { ok: false, spec: {}, problem: `No spec contract for ${capability.id}.` };
}

export function normaliseVoice(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 40) || 'af_heart';
}
