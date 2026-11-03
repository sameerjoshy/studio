import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { run } from './shell.mjs';
import { downloadObject, listObjects } from './supabase.mjs';

const HYPERFRAMES = process.env.HYPERFRAMES_VERSION || '0.8.226';

export async function renderTemplate({ root, template, vars, out }) {
  const varsPath = path.join(path.dirname(out), `${path.basename(template)}-vars.json`);
  await writeFile(varsPath, JSON.stringify(vars, null, 2), 'utf8');

  await run(
    'npx',
    [
      '--yes',
      `hyperframes@${HYPERFRAMES}`,
      'render',
      template,
      '-o',
      out,
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

  return out;
}

/**
 * Free score bed. `bed` is a low drone; `sting` is a short, punchier hit.
 */
export async function makeBed({ workDir, seconds, kind = 'bed', out }) {
  const target = out || path.join(workDir, kind === 'sting' ? 'sting.m4a' : 'bed.m4a');

  if (kind === 'sting') {
    await run(
      'ffmpeg',
      [
        '-y', '-v', 'error',
        '-f', 'lavfi', '-i', `sine=frequency=220:duration=${seconds}`,
        '-f', 'lavfi', '-i', `sine=frequency=330:duration=${seconds}`,
        '-filter_complex',
        '[0:a]volume=0.16[a0];[1:a]volume=0.07[a1];[a0][a1]amix=inputs=2,afade=t=in:st=0:d=0.04,afade=t=out:st=' +
          Math.max(0.1, seconds - 0.5).toFixed(2) +
          ':d=0.5[a]',
        '-map', '[a]',
        '-c:a', 'aac', '-b:a', '160k',
        target,
      ],
      { shell: false, timeoutMs: 120_000 },
    );
    return target;
  }

  await run(
    'ffmpeg',
    [
      '-y', '-v', 'error',
      '-f', 'lavfi', '-i', `sine=frequency=55:duration=${seconds}`,
      '-f', 'lavfi', '-i', `sine=frequency=110:duration=${seconds}`,
      '-f', 'lavfi', '-i', `sine=frequency=164.81:duration=${seconds}`,
      '-filter_complex',
      '[0:a]volume=0.22[a0];[1:a]volume=0.10[a1];[2:a]volume=0.05[a2];[a0][a1][a2]amix=inputs=3,afade=t=in:st=0:d=1.2,afade=t=out:st=' +
        Math.max(0.5, seconds - 1.2).toFixed(2) +
        ':d=1.2[a]',
      '-map', '[a]',
      '-c:a', 'aac', '-b:a', '160k',
      target,
    ],
    { shell: false, timeoutMs: 120_000 },
  );

  return target;
}

export async function pickMusic(workDir) {
  try {
    const objects = await listObjects('studio-music');
    const track = (objects ?? []).find((object) => object.name && !object.name.endsWith('/'));
    if (!track) return null;
    const file = path.join(workDir, `music${path.extname(track.name) || '.mp3'}`);
    await downloadObject('studio-music', track.name, file);
    return file;
  } catch {
    return null;
  }
}

export async function muxMusic({ video, music, out, volume = 0.35 }) {
  await run(
    'ffmpeg',
    [
      '-y', '-v', 'error',
      '-i', video,
      '-stream_loop', '-1', '-i', music,
      '-filter_complex', `[1:a]volume=${volume}[a]`,
      '-map', '0:v',
      '-map', '[a]',
      '-shortest',
      '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '160k',
      '-movflags', '+faststart',
      out,
    ],
    { shell: false, timeoutMs: 180_000 },
  );
  return out;
}

export async function muxAudio({ video, audio, out }) {
  await run(
    'ffmpeg',
    [
      '-y', '-v', 'error',
      '-i', video,
      '-i', audio,
      '-map', '0:v',
      '-map', '1:a',
      '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '160k',
      '-shortest',
      '-movflags', '+faststart',
      out,
    ],
    { shell: false, timeoutMs: 180_000 },
  );
  return out;
}
