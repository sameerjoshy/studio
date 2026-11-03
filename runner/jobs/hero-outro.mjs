import path from 'node:path';
import { makeBed, muxAudio, muxMusic, pickMusic, renderTemplate } from '../lib/hero.mjs';

export default async function heroOutro({ spec, workDir, progress, root }) {
  const accent = /^#[0-9a-f]{6}$/i.test(String(spec.accent ?? '')) ? String(spec.accent) : '#34D399';
  const vertical = String(spec.aspect) === '9:16';

  const template = path.join(root, 'templates', vertical ? 'hero-outro-vertical' : 'hero-outro');
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

  await progress('scoring', 80, 'Adding the music');

  const music = await pickMusic(workDir);
  if (music) {
    await muxMusic({ video: silent, music, out: final });
  } else {
    const bed = await makeBed({ workDir, seconds: 5, kind: 'bed' });
    await muxAudio({ video: silent, audio: bed, out: final });
  }

  await progress('finalising', 95, 'Outro ready');

  return {
    file: final,
    filename: 'hero-outro.mp4',
    contentType: 'video/mp4',
    meta: {
      engine: 'HyperFrames',
      duration: 5,
      resolution: vertical ? '1080x1920' : '1920x1080',
      fps: 30,
      aspect: vertical ? '9:16' : '16:9',
      music: music ? 'library' : 'generated',
    },
  };
}
