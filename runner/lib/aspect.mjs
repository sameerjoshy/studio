import path from 'node:path';
import { run } from './shell.mjs';

export const ASPECT_SIZES = {
  '16:9': [1920, 1080],
  '9:16': [1080, 1920],
  '1:1': [1080, 1080],
};

/**
 * Normalise a rendered 16:9 file to a social aspect.
 * pad   - letterbox on the brand background (safe for text-heavy footage)
 * cover - fill the frame and crop the edges (safe for talking heads)
 */
export async function fitAspect(file, aspect, workDir, mode = 'pad') {
  if (!ASPECT_SIZES[aspect] || aspect === '16:9') return file;

  const [width, height] = ASPECT_SIZES[aspect];
  const out = path.join(workDir, `aspect-${aspect.replace(':', 'x')}.mp4`);

  const filter =
    mode === 'cover'
      ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`
      : `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x0A192F`;

  await run(
    'ffmpeg',
    [
      '-y',
      '-v',
      'error',
      '-i',
      file,
      '-vf',
      filter,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      '-movflags',
      '+faststart',
      out,
    ],
    { shell: false, timeoutMs: 600_000 },
  );

  return out;
}
