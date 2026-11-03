import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { run } from '../lib/shell.mjs';

const HYPERFRAMES = process.env.HYPERFRAMES_VERSION || '0.8.226';

export default async function heroIntro({ spec, workDir, progress, root }) {
  const episodeNumber = String(spec.episodeNumber ?? '01').slice(0, 4);
  const episodeTitle = String(spec.episodeTitle ?? 'PIPELINE HYGIENE').slice(0, 80);
  const accent = /^#[0-9a-f]{6}$/i.test(String(spec.accent ?? '')) ? String(spec.accent) : '#34D399';

  const template = path.join(root, 'templates', 'hero-intro');
  const varsPath = path.join(workDir, 'variables.json');
  const silent = path.join(workDir, 'intro-silent.mp4');
  const bed = path.join(workDir, 'bed.m4a');
  const final = path.join(workDir, 'hero-intro.mp4');

  await writeFile(
    varsPath,
    JSON.stringify({ episodeNumber, episodeTitle, accent }, null, 2),
    'utf8',
  );

  await progress('rendering', 20, 'Rendering the hero intro');

  await run(
    'npx',
    [
      '--yes',
      `hyperframes@${HYPERFRAMES}`,
      'render',
      template,
      '-o',
      silent,
      '--quality',
      'looks',
      '--variables-file',
      varsPath,
      '--strict-variables',
      '--workers',
      '1',
      '--quiet',
    ],
    {
      cwd: root,
      timeoutMs: 900_000,
      onStdout: (line) => console.log(line.trim()),
      onStderr: (line) => console.log(line.trim()),
    },
  );

  await progress('scoring', 80, 'Adding the music bed');

  // Free cinematic bed: low drone with a slow swell and fade.
  await run(
    'ffmpeg',
    [
      '-y', '-v', 'error',
      '-f', 'lavfi', '-i', 'sine=frequency=55:duration=6',
      '-f', 'lavfi', '-i', 'sine=frequency=110:duration=6',
      '-f', 'lavfi', '-i', 'sine=frequency=164.81:duration=6',
      '-filter_complex',
      '[0:a]volume=0.22[a0];[1:a]volume=0.10[a1];[2:a]volume=0.05[a2];[a0][a1][a2]amix=inputs=3,afade=t=in:st=0:d=1.2,afade=t=out:st=4.8:d=1.2[a]',
      '-map', '[a]',
      '-c:a', 'aac', '-b:a', '160k',
      bed,
    ],
    { shell: false, timeoutMs: 120_000 },
  );

  await run(
    'ffmpeg',
    [
      '-y', '-v', 'error',
      '-i', silent,
      '-i', bed,
      '-map', '0:v',
      '-map', '1:a',
      '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '160k',
      '-shortest',
      '-movflags', '+faststart',
      final,
    ],
    { shell: false, timeoutMs: 120_000 },
  );

  await progress('finalising', 95, 'Intro ready');

  return {
    file: final,
    filename: 'hero-intro.mp4',
    contentType: 'video/mp4',
    meta: {
      engine: `HyperFrames ${HYPERFRAMES}`,
      episodeNumber,
      episodeTitle,
      accent,
      duration: 6,
      resolution: '1920x1080',
      fps: 30,
    },
  };
}
