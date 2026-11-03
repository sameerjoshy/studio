import path from 'node:path';
import { makeBed, muxAudio, renderTemplate } from '../lib/hero.mjs';

export default async function heroSting({ spec, workDir, progress, root }) {
  const accent = /^#[0-9a-f]{6}$/i.test(String(spec.accent ?? '')) ? String(spec.accent) : '#34D399';
  const template = path.join(root, 'templates', 'hero-sting');
  const silent = path.join(workDir, 'sting-silent.mp4');
  const final = path.join(workDir, 'hero-sting.mp4');

  await progress('rendering', 25, 'Rendering the sting');

  await renderTemplate({
    root,
    template,
    vars: {
      episodeNumber: String(spec.episodeNumber ?? '01').slice(0, 4),
      episodeTitle: String(spec.episodeTitle ?? 'PIPELINE HYGIENE').slice(0, 80),
      accent,
    },
    out: silent,
  });

  await progress('scoring', 80, 'Adding the hit');
  const hit = await makeBed({ workDir, seconds: 2, kind: 'sting' });
  await muxAudio({ video: silent, audio: hit, out: final });

  await progress('finalising', 95, 'Sting ready');

  return {
    file: final,
    filename: 'hero-sting.mp4',
    contentType: 'video/mp4',
    meta: { engine: 'HyperFrames', duration: 2, resolution: '1920x1080', fps: 30 },
  };
}
