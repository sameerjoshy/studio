import path from 'node:path';
import { run } from '../lib/shell.mjs';

export default async function voiceXtts({ spec, workDir, progress, root }) {
  const text = String(spec.text ?? '').trim();
  const reference = String(spec.reference_url ?? '').trim();
  if (!text) throw new Error('No script supplied');
  if (!/^https?:\/\//i.test(reference)) throw new Error('A public reference audio URL is required');

  const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const out = path.join(workDir, 'clone.wav');

  await progress('installing', 8, 'Checking XTTS runtime');
  await progress('synthesising', 20, 'Cloning the reference voice (this is the slow part)');

  await run(
    python,
    [
      path.join(root, 'py', 'xtts_tts.py'),
      '--text',
      text.slice(0, 2000),
      '--reference',
      reference,
      '--language',
      String(spec.language ?? 'en'),
      '--out',
      out,
    ],
    {
      onStdout: (line) => console.log(line.trim()),
      onStderr: (line) => console.log(line.trim()),
    },
  );

  await progress('encoding', 88, 'Voice clone written');

  return {
    file: out,
    filename: 'voice-clone.wav',
    contentType: 'audio/wav',
    meta: { engine: 'xtts-v2', language: spec.language ?? 'en', licence: 'CPML non-commercial' },
  };
}
