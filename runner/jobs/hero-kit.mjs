import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { run } from '../lib/shell.mjs';
import heroIntro from './hero-intro.mjs';
import heroOutro from './hero-outro.mjs';
import heroSting from './hero-sting.mjs';

export default async function heroKit({ spec, workDir, progress, root }) {
  const episodeNumber = String(spec.episodeNumber ?? '01').slice(0, 4);
  const episodeTitle = String(spec.episodeTitle ?? 'PIPELINE HYGIENE').slice(0, 80);
  const cta = String(spec.cta ?? 'SUBSCRIBE').slice(0, 24);
  const tagline = String(spec.tagline ?? 'New episode every Tuesday').slice(0, 60);
  const accent = /^#[0-9a-f]{6}$/i.test(String(spec.accent ?? '')) ? String(spec.accent) : '#34D399';
  const aspect = String(spec.aspect) === '9:16' ? '9:16' : '16:9';

  const introDir = path.join(workDir, 'intro');
  const outroDir = path.join(workDir, 'outro');
  const stingDir = path.join(workDir, 'sting');
  const thumbDir = path.join(workDir, 'thumbs');
  await Promise.all([introDir, outroDir, stingDir, thumbDir].map((dir) => mkdir(dir, { recursive: true })));

  await progress('intro', 10, 'Rendering the intro');
  const intro = await heroIntro({
    spec: { episodeNumber, episodeTitle, accent, aspect },
    workDir: introDir,
    progress,
    root,
  });

  await progress('outro', 40, 'Rendering the outro');
  const outro = await heroOutro({
    spec: { cta, tagline, accent, aspect },
    workDir: outroDir,
    progress,
    root,
  });

  await progress('sting', 62, 'Rendering the sting');
  const sting = await heroSting({
    spec: { episodeNumber, episodeTitle, accent, aspect },
    workDir: stingDir,
    progress,
    root,
  });

  await progress('thumbnails', 78, 'Generating three thumbnails');
  const python = process.env.PYTHON || 'python3';
  await run(
    python,
    [
      path.join(root, '..', 'scripts', 'make_thumbnails.py'),
      '--poses',
      path.join(root, 'templates', 'hero-kit', 'poses'),
      '--out',
      thumbDir,
      '--title',
      episodeTitle,
      '--episode',
      episodeNumber,
    ],
    { shell: false, timeoutMs: 300_000, onStderr: (line) => console.log(line.trim()) },
  );

  await copyFile(intro.file, path.join(workDir, 'intro.mp4'));
  await copyFile(outro.file, path.join(workDir, 'outro.mp4'));
  await copyFile(sting.file, path.join(workDir, 'sting.mp4'));

  await writeFile(
    path.join(workDir, 'README.txt'),
    [
      `Guardian of GTM - Episode ${episodeNumber}`,
      `Title: ${episodeTitle}`,
      `Aspect: ${aspect}`,
      '',
      'intro.mp4   6s, 30fps',
      'outro.mp4   5s, 30fps',
      'sting.mp4   2s, 30fps',
      'thumbs/     three 1280x720 thumbnail variants',
      '',
      'Music: library track if one is available, otherwise a generated bed.',
    ].join('\n'),
    'utf8',
  );

  await progress('packaging', 92, 'Packaging the kit');
  await run('zip', ['-r', 'hero-kit.zip', 'intro.mp4', 'outro.mp4', 'sting.mp4', 'thumbs', 'README.txt'], {
    cwd: workDir,
    shell: false,
    timeoutMs: 120_000,
  });

  await progress('finalising', 98, 'Kit ready');

  return {
    file: path.join(workDir, 'hero-kit.zip'),
    filename: `hero-kit-ep${episodeNumber}.zip`,
    contentType: 'application/zip',
    meta: {
      engine: 'HyperFrames + Pillow',
      episodeNumber,
      episodeTitle,
      aspect,
      files: ['intro.mp4', 'outro.mp4', 'sting.mp4', 'thumb-a.png', 'thumb-b.png', 'thumb-c.png'],
      duration: 13,
    },
  };
}
