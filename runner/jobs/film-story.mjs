import path from 'node:path';
import { run } from '../lib/shell.mjs';
import { fitAspect } from '../lib/aspect.mjs';
import {
  makeBed,
  mixMusicPair,
  mixVoiceMusic,
  muxAudio,
  muxMusic,
  pickMusicTracks,
  renderTemplate,
} from '../lib/hero.mjs';

const DEFAULT_SCRIPT =
  'Sales are falling. Leads have dried up. Retention is slipping. And every meeting feels like a fight. ' +
  'But this is not the end of the story. The GTM Hero breaks through the noise, and the weather changes. ' +
  'Pipeline recovers. Customers stay. Teams win again. Guardian of GTM. One idea. One guardian.';

export default async function filmStory({ spec, workDir, progress, root }) {
  const title = String(spec.title ?? 'GUARDIAN OF GTM').slice(0, 80);
  const tagline = String(spec.tagline ?? 'One idea. One guardian.').slice(0, 80);
  const cta = String(spec.cta ?? 'gtm-360.com').slice(0, 40);
  const accent = /^#[0-9a-f]{6}$/i.test(String(spec.accent ?? '')) ? String(spec.accent) : '#F5B544';
  const aspect = ['9:16', '1:1'].includes(String(spec.aspect)) ? String(spec.aspect) : '16:9';
  const script = String(spec.script ?? DEFAULT_SCRIPT).trim().slice(0, 2000);
  const voiceEngine = spec.voice_engine === 'xtts' ? 'xtts' : 'none';
  const reference = String(spec.reference_url ?? '').trim();
  const language = String(spec.language ?? 'en').slice(0, 8);

  const template = path.join(root, 'templates', 'story-30s');
  const silent = path.join(workDir, 'story-silent.mp4');
  const scored = path.join(workDir, 'score.m4a');
  const final = path.join(workDir, 'story-30s.mp4');

  await progress('rendering', 12, 'Rendering the 30-second story');
  await renderTemplate({
    root,
    template,
    vars: { title, tagline, cta, accent },
    out: silent,
  });

  let voice = null;
  if (voiceEngine === 'xtts') {
    if (!/^https?:\/\//i.test(reference)) {
      throw new Error('Voice cloning needs a public reference audio URL');
    }
    await progress('voice', 52, 'Cloning the reference voice (the slow part)');
    voice = path.join(workDir, 'voice.wav');
    const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
    await run(
      python,
      [
        path.join(root, 'py', 'xtts_tts.py'),
        '--text',
        script,
        '--reference',
        reference,
        '--language',
        language,
        '--out',
        voice,
      ],
      {
        onStdout: (line) => console.log(line.trim()),
        onStderr: (line) => console.log(line.trim()),
      },
    );
  }

  await progress('scoring', 76, 'Scoring the film');
  const tracks = await pickMusicTracks(workDir, 2);
  let music = null;
  if (tracks.length >= 2) {
    music = await mixMusicPair({ workDir, dark: tracks[0], hopeful: tracks[1], out: scored });
  } else if (tracks.length === 1) {
    music = tracks[0];
  }

  if (voice && music) {
    await mixVoiceMusic({ video: silent, music, voice, out: final });
  } else if (voice) {
    await muxAudio({ video: silent, audio: voice, out: final });
  } else if (music) {
    await muxMusic({ video: silent, music, out: final });
  } else {
    const bed = await makeBed({ workDir, seconds: 30, kind: 'bed' });
    await muxAudio({ video: silent, audio: bed, out: final });
  }

  const formatted = await fitAspect(final, aspect, workDir, 'pad');

  await progress('encoding', 94, 'Film encoded');

  return {
    file: formatted,
    filename: 'story-30s.mp4',
    contentType: 'video/mp4',
    meta: {
      engine: 'HyperFrames',
      duration: 30,
      resolution: aspect === '16:9' ? '1920x1080' : aspect === '9:16' ? '1080x1920' : '1080x1080',
      fps: 30,
      aspect,
      voice: voice ? 'xtts-v2' : 'none',
      music: tracks.length >= 2 ? 'two-track' : tracks.length === 1 ? 'library' : 'generated',
    },
  };
}
