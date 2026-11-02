import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fitAspect } from '../lib/aspect.mjs';
import { run } from '../lib/shell.mjs';
import { downloadObject, listObjects } from '../lib/supabase.mjs';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export default async function filmCharacter({ spec, workDir, progress, root }) {
  const seconds = clamp(Number(spec.seconds) || 3, 2, 8);
  const fps = 24;
  const framesDir = path.join(workDir, 'frames');
  await mkdir(framesDir, { recursive: true });

  await progress('modelling', 10, 'Building the GTM Guardian');

  await run(
    'blender',
    [
      '-b',
      '--python',
      path.join(root, 'blender', 'gtm_guardian.py'),
      '--',
      '--out',
      framesDir,
      '--seconds',
      String(seconds),
      '--fps',
      String(fps),
      '--samples',
      String(Number(process.env.BLENDER_SAMPLES) || 32),
      '--resolution',
      '1280x720',
    ],
    {
      shell: false,
      timeoutMs: 1_800_000,
      onStdout: (line) => console.log(line.trim()),
      onStderr: (line) => console.log(line.trim()),
    },
  );

  await progress('encoding', 78, 'Encoding the render');

  const silent = path.join(workDir, 'hero-silent.mp4');

  await run(
    'ffmpeg',
    [
      '-y', '-v', 'error',
      '-framerate', String(fps),
      '-i', path.join(framesDir, 'frame_%04d.png'),
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      silent,
    ],
    { shell: false, timeoutMs: 600_000 },
  );

  let out = silent;
  let musicUsed = false;

  try {
    const objects = await listObjects('studio-music');
    const track = (objects ?? []).find((object) => object.name && !object.name.endsWith('/'));
    if (track) {
      const music = path.join(workDir, `music${path.extname(track.name) || '.mp3'}`);
      await downloadObject('studio-music', track.name, music);
      const mixed = path.join(workDir, 'hero.mp4');
      await run(
        'ffmpeg',
        [
          '-y', '-v', 'error',
          '-i', silent,
          '-stream_loop', '-1', '-i', music,
          '-filter_complex', '[1:a]volume=0.45[a]',
          '-map', '0:v',
          '-map', '[a]',
          '-shortest',
          '-c:v', 'copy',
          '-c:a', 'aac',
          '-b:a', '160k',
          '-movflags', '+faststart',
          mixed,
        ],
        { shell: false, timeoutMs: 600_000 },
      );
      out = mixed;
      musicUsed = true;
    }
  } catch {
    out = silent;
  }

  const aspect = ['9:16', '1:1'].includes(String(spec.aspect)) ? String(spec.aspect) : '16:9';
  out = await fitAspect(out, aspect, workDir, 'pad');

  await progress('finalising', 95, 'Guardian rendered');

  return {
    file: out,
    filename: 'gtm-guardian.mp4',
    contentType: 'video/mp4',
    meta: {
      engine: 'Blender / GTM Guardian',
      seconds,
      fps,
      frames: Math.round(seconds * fps),
      resolution: '1280x720',
      aspect,
      music: musicUsed,
    },
  };
}
