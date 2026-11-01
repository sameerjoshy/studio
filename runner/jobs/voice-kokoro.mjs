import path from 'node:path';
import { run } from '../lib/shell.mjs';

const MAX_CHARS = 3000;

export default async function voiceKokoro({ spec, workDir, progress, root }) {
  const text = String(spec.text ?? '').trim();
  if (!text) throw new Error('No script supplied');

  const voice = /^[a-z]{2}_[a-z0-9_]+$/i.test(String(spec.voice ?? '')) ? spec.voice : 'af_heart';
  const speed = Math.min(1.5, Math.max(0.5, Number(spec.speed) || 1));

  const model = process.env.KOKORO_MODEL || path.join(root, 'models', 'kokoro-v1.0.onnx');
  const voices = process.env.KOKORO_VOICES || path.join(root, 'models', 'voices-v1.0.bin');
  const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

  const out = path.join(workDir, 'narration.wav');

  await progress('synthesising', 25, `Synthesising ${Math.min(text.length, MAX_CHARS)} characters with ${voice}`);

  await run(
    python,
    [
      path.join(root, 'py', 'kokoro_tts.py'),
      '--text',
      text.slice(0, MAX_CHARS),
      '--voice',
      voice,
      '--speed',
      String(speed),
      '--model',
      model,
      '--voices',
      voices,
      '--out',
      out,
    ],
    {
      onStdout: (line) => console.log(line.trim()),
      onStderr: (line) => console.log(line.trim()),
    },
  );

  await progress('encoding', 85, 'Audio written');

  return {
    file: out,
    filename: 'narration.wav',
    contentType: 'audio/wav',
    meta: { engine: 'kokoro-82m', voice, speed, characters: Math.min(text.length, MAX_CHARS) },
  };
}
