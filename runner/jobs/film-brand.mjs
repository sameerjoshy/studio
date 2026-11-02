import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fitAspect } from '../lib/aspect.mjs';
import { run } from '../lib/shell.mjs';

const HYPERFRAMES = process.env.HYPERFRAMES_VERSION || '0.8.226';

export default async function filmBrand({ spec, workDir, progress, root }) {
  const title = String(spec.title ?? 'Untitled film').trim();
  const subtitle = String(spec.subtitle ?? '').trim();
  const bullets = Array.isArray(spec.bullets) ? spec.bullets.map(String) : [];
  const accent = /^#[0-9a-f]{6}$/i.test(String(spec.accent ?? '')) ? spec.accent : '#34D399';

  const varsPath = path.join(workDir, 'variables.json');
  await writeFile(
    varsPath,
    JSON.stringify(
      {
        title,
        subtitle,
        line1: bullets[0] ?? '',
        line2: bullets[1] ?? '',
        line3: bullets[2] ?? '',
        accent,
      },
      null,
      2,
    ),
    'utf8',
  );

  const template = path.join(root, 'templates', 'brand-film');
  const out = path.join(workDir, 'brand-film.mp4');

  await progress('preparing', 15, 'Writing the beat sheet');

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
      onStdout: (line) => console.log(line.trim()),
      onStderr: (line) => console.log(line.trim()),
    },
  );

  const aspect = ['9:16', '1:1'].includes(String(spec.aspect)) ? String(spec.aspect) : '16:9';
  const formatted = await fitAspect(out, aspect, workDir, 'pad');

  await progress('encoding', 90, 'Film encoded');

  return {
    file: formatted,
    filename: 'brand-film.mp4',
    contentType: 'video/mp4',
    meta: { engine: `hyperframes@${HYPERFRAMES}`, duration: 12, resolution: '1920x1080', fps: 30 },
  };
}
