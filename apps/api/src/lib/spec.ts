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

function aspectOf(input: Record<string, unknown>): '16:9' | '9:16' | '1:1' {
  const value = str(input.aspect);
  return value === '9:16' || value === '1:1' ? value : '16:9';
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

  if (capability.id === 'deck-pptmaster') {
    const brief = str(input.brief) || str(input.source) || str(input.text);
    if (!brief) return { ok: false, spec: {}, problem: 'PPT Master needs a brief or source text.' };

    const requested = Number(input.slides);
    const spec: Record<string, unknown> = {
      brief: brief.slice(0, 6000),
      audience: str(input.audience) || 'business audience',
    };

    if (Number.isFinite(requested) && requested > 0) {
      spec.slides = Math.min(16, Math.max(3, Math.round(requested)));
    }

    return { ok: true, spec };
  }

  const SOURCE_CAPABILITIES = new Set([
    'film-talking-head',
    'film-clip-factory',
    'film-podcast',
    'film-dub',
    'film-screen-demo',
    'film-hybrid',
  ]);

  if (SOURCE_CAPABILITIES.has(capability.id)) {
    const sourcePath = str(input.source_path);
    if (!sourcePath.startsWith('sources/')) {
      return { ok: false, spec: {}, problem: 'Upload a source file first.' };
    }

    const requested = Number(input.seconds) || 60;
    const spec: Record<string, unknown> = {
      source_path: sourcePath,
      brief: str(input.brief).slice(0, 2000),
      seconds: Math.min(180, Math.max(5, Math.round(requested))),
      aspect: aspectOf(input),
    };

    if (capability.id === 'film-dub') {
      spec.language = str(input.language) || 'es';
      spec.engine = input.engine === 'xtts' ? 'xtts' : 'kokoro';
      spec.voice = str(input.voice) || 'af_heart';
    }

    return { ok: true, spec };
  }

  if (capability.id === 'film-explainer' || capability.id === 'film-motion-graphics') {
    const brief = str(input.brief) || str(input.source) || str(input.text);
    if (!brief) return { ok: false, spec: {}, problem: 'This film needs a brief.' };

    const requested = Number(input.seconds) || Number(input.duration);
    const seconds = Number.isFinite(requested) && requested > 0 ? Math.round(requested) : 30;

    return {
      ok: true,
      spec: {
        brief: brief.slice(0, 4000),
        seconds: Math.min(90, Math.max(12, seconds)),
        audience: str(input.audience) || 'business audience',
        aspect: aspectOf(input),
        ...(capability.id === 'film-motion-graphics' ? { theme: 'flat-motion-graphics' } : {}),
      },
    };
  }

  if (capability.id === 'film-explainer') {
    const brief = str(input.brief) || str(input.source) || str(input.text);
    if (!brief) return { ok: false, spec: {}, problem: 'An explainer needs a brief.' };

    const requested = Number(input.seconds) || Number(input.duration);
    const seconds = Number.isFinite(requested) && requested > 0 ? Math.round(requested) : 30;

    return {
      ok: true,
      spec: {
        brief: brief.slice(0, 4000),
        seconds: Math.min(90, Math.max(12, seconds)),
        audience: str(input.audience) || 'business audience',
      },
    };
  }

  if (capability.id === 'film-character') {
    const brief = str(input.brief) || 'The GTM Guardian in a hero shot.';
    const requested = Number(input.seconds) || 3;
    return {
      ok: true,
      spec: {
        brief: brief.slice(0, 1000),
        seconds: Math.min(8, Math.max(2, Math.round(requested))),
        aspect: aspectOf(input),
      },
    };
  }

  if (capability.id === 'film-cinematic') {
    const brief = str(input.brief) || str(input.source) || str(input.text);
    if (!brief) return { ok: false, spec: {}, problem: 'A cinematic film needs a brief.' };

    const requested = Number(input.seconds) || Number(input.duration);
    const seconds = Number.isFinite(requested) && requested > 0 ? Math.round(requested) : 30;

    return {
      ok: true,
      spec: {
        brief: brief.slice(0, 4000),
        seconds: Math.min(90, Math.max(15, seconds)),
        tone: str(input.tone) || 'cinematic',
        aspect: aspectOf(input),
      },
    };
  }

  if (capability.id === 'film-documentary') {
    const brief = str(input.brief) || str(input.source) || str(input.text);
    if (!brief) return { ok: false, spec: {}, problem: 'A documentary needs a brief.' };

    const requested = Number(input.seconds) || Number(input.duration);
    const seconds = Number.isFinite(requested) && requested > 0 ? Math.round(requested) : 30;

    return {
      ok: true,
      spec: {
        brief: brief.slice(0, 4000),
        seconds: Math.min(90, Math.max(10, seconds)),
        tone: str(input.tone) || 'observational',
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
        aspect: aspectOf(input),
      },
    };
  }

  if (capability.id === 'voice-kokoro') {
    const text = str(input.text);
    if (!text) return { ok: false, spec: {}, problem: 'Narration needs a script.' };
    const speed = Number(input.speed);
    const engine = input.engine === 'edge' ? 'edge' : 'kokoro';
    const requested = str(input.voice);

    const voice =
      engine === 'edge'
        ? /^[a-z]{2}-[A-Z]{2}-\w+Neural$/.test(requested)
          ? requested
          : 'en-US-ChristopherNeural'
        : normaliseVoice(requested);

    return {
      ok: true,
      spec: {
        text: text.slice(0, 3000),
        voice,
        speed: Number.isFinite(speed) ? Math.min(1.5, Math.max(0.5, speed)) : 1,
        engine,
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
