import path from 'node:path';
import { makeBed, muxAudio, renderTemplate } from '../lib/hero.mjs';

export default async function heroOutro({ spec, workDir, progress, root }) {
  const accent = /^#[0-9a-f]{6}$/i.test(String(spec.accent ?? '')) ? String(spec.accent) : '#34D399';
  const template = path.join(root, 'templates', 'hero-outro');
  const silent = path.join(workDir, 'outro-silent.mp4');
  const final = path.join(workDir, 'hero-outro.mp4');

  await progress('rendering', 25, 'Rendering the outro');

  await renderTemplate({
    root,
    template,
    vars: {
      cta: String(spec.cta ?? 'SUBSCRIBE').slice(0, 24),
      tagline: String(spec.tagline ?? 'New episode every Tuesday').slice(0, 60),
      accent,
    },
    out: silent,
  });

  await progress('scoring', 80, 'Adding the music bed');
  const bed = await makeBed({ workDir, seconds: 5, kind: 'bed' });
  await muxAudio({ video: silent, audio: bed, out: final });

  await progress('finalising', 95, 'Outro ready');

  return {
    file: final,
    filename: 'hero-outro.mp4',
    contentType: 'video/mp4',
    meta: { engine: 'HyperFrames', duration: 5, resolution: '1920x1080', fps: 30 },
  };
}
