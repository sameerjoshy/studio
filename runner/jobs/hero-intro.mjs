import path from 'node:path';
import { makeBed, muxAudio, muxMusic, pickMusic, renderTemplate } from '../lib/hero.mjs';

export default async function heroIntro({ spec, workDir, progress, root }) {
  const episodeNumber = String(spec.episodeNumber ?? '01').slice(0, 4);
  const episodeTitle = String(spec.episodeTitle ?? 'PIPELINE HYGIENE').slice(0, 80);
  const accent = /^#[0-9a-f]{6}$/i.test(String(spec.accent ?? '')) ? String(spec.accent) : '#34D399';
  const vertical = String(spec.aspect) === '9:16';

  const template = path.join(root, 'templates', vertical ? 'hero-intro-vertical' : 'hero-intro');
  const silent = path.join(workDir, 'intro-silent.mp4');
  const final = path.join(workDir, 'hero-intro.mp4');

  await progress('rendering', 20, 'Rendering the hero intro');

  await renderTemplate({
    root,
    template,
    vars: { episodeNumber, episodeTitle, accent },
    out: silent,
  });

  await progress('scoring', 80, 'Adding the music');

  const music = await pickMusic(workDir);
  if (music) {
    await muxMusic({ video: silent, music, out: final });
  } else {
    const bed = await makeBed({ workDir, seconds: 6, kind: 'bed' });
    await muxAudio({ video: silent, audio: bed, out: final });
  }

  await progress('finalising', 95, 'Intro ready');

  return {
    file: final,
    filename: 'hero-intro.mp4',
    contentType: 'video/mp4',
    meta: {
      engine: 'HyperFrames',
      episodeNumber,
      episodeTitle,
      accent,
      duration: 6,
      resolution: vertical ? '1080x1920' : '1920x1080',
      fps: 30,
      aspect: vertical ? '9:16' : '16:9',
      music: music ? 'library' : 'generated',
    },
  };
}
