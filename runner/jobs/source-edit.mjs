import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { callModel } from '../lib/model.mjs';
import { run } from '../lib/shell.mjs';
import { downloadObject } from '../lib/supabase.mjs';

const KINDS = new Set([
  'talking-head',
  'clip-factory',
  'podcast',
  'dub',
  'screen-demo',
  'hybrid',
]);

const MOMENT_COUNT = {
  'clip-factory': 4,
  hybrid: 4,
};

function clip(text, limit = 6000) {
  const value = String(text ?? '');
  return value.length > limit ? `${value.slice(0, limit)}\n...[truncated]` : value;
}

function transcriptText(transcript, limit = 6000) {
  const lines = (transcript.segments ?? [])
    .map(
      (segment) =>
        `[${Number(segment.start).toFixed(1)}-${Number(segment.end).toFixed(1)}] ${segment.text}`,
    )
    .join('\n');
  return clip(lines, limit);
}

async function planMoments({ brief, transcript, count, providers, usage }) {
  const result = await callModel({
    system: [
      'You select the strongest self-contained moments from a transcript for short-form video.',
      'Return JSON only: {"moments":[{"start":number,"end":number,"title":string,"reason":string}]}',
      `Pick exactly ${count} non-overlapping moments.`,
      'Each moment must be 6-18 seconds, start and end on a sentence boundary, and make sense without context.',
      'Use the segment timestamps. Never invent times outside the transcript.',
    ].join('\n'),
    user: `BRIEF:\n${brief || 'Choose the most compelling moments.'}\n\nTRANSCRIPT:\n${transcriptText(transcript)}`,
    maxTokens: 1200,
  });

  providers.push(result.provider);
  usage.costUsd += Number(result.usage?.cost_usd ?? 0);

  const moments = (Array.isArray(result.data?.moments) ? result.data.moments : [])
    .map((moment) => ({
      start: Number(moment?.start),
      end: Number(moment?.end),
      title: String(moment?.title ?? '').slice(0, 120),
      reason: String(moment?.reason ?? '').slice(0, 200),
    }))
    .filter((moment) => Number.isFinite(moment.start) && Number.isFinite(moment.end) && moment.end > moment.start)
    .slice(0, count);

  if (!moments.length) throw new Error('The model selected no usable moments');
  return moments;
}

async function translateTranscript({ transcript, language, providers, usage }) {
  const result = await callModel({
    system: [
      'You translate video narration for dubbing.',
      'Return JSON only: {"text": string}.',
      'Translate the transcript into the requested language.',
      'Keep it natural to speak aloud: no markdown, no timestamps, no speaker labels, no stage directions.',
      'Preserve names, numbers, and product terms.',
    ].join('\n'),
    user: `TARGET LANGUAGE: ${language}\n\nTRANSCRIPT:\n${transcriptText(transcript, 5000)}`,
    maxTokens: 2000,
  });

  providers.push(result.provider);
  usage.costUsd += Number(result.usage?.cost_usd ?? 0);

  const text = String(result.data?.text ?? '').trim();
  if (!text) throw new Error('The model returned no translation');
  return text;
}

export default async function sourceEdit({ job, spec, workDir, progress, root }) {
  const kind = String(job.capability).replace(/^film-/, '');
  if (!KINDS.has(kind)) throw new Error(`Unsupported source pipeline: ${kind}`);

  const sourcePath = String(spec.source_path ?? '');
  if (!sourcePath.startsWith('sources/')) throw new Error('No uploaded source');

  const providers = [];
  const usage = { costUsd: 0 };

  await progress('downloading', 6, 'Downloading the source');

  const extension = path.extname(sourcePath) || '.mp4';
  const local = path.join(workDir, `source${extension}`);
  await downloadObject('studio-sources', sourcePath, local);

  const python = process.env.PYTHON || 'python3';
  const transcriptPath = path.join(workDir, 'transcript.json');

  await progress('transcribing', 14, 'Transcribing the source (this is the slow part)');

  const transcription = await run(
    python,
    [
      path.join(root, 'py', 'openmontage_source_edit.py'),
      '--stage',
      'transcribe',
      '--source',
      local,
      '--work',
      workDir,
    ],
    {
      cwd: root,
      shell: false,
      timeoutMs: 1_800_000,
      onStderr: (line) => console.log(line.trim()),
    },
  );

  const transcriptLine = transcription.stdout.trim().split('\n').filter(Boolean).pop();
  let transcribed;
  try {
    transcribed = JSON.parse(transcriptLine);
  } catch {
    throw new Error('Transcription produced no result');
  }
  if (!transcribed.ok) throw new Error(transcribed.error || 'Transcription failed');

  const transcript = JSON.parse(await readFile(transcriptPath, 'utf8'));
  if (!Array.isArray(transcript.segments) || !transcript.segments.length) {
    throw new Error('No speech was found in the source');
  }

  await progress('planning', 50, 'Planning the edit');

  const seconds = Math.min(180, Math.max(5, Number(spec.seconds) || 60));
  const plan = { title: String(spec.brief ?? '').split(/[.!?]/)[0]?.slice(0, 80) || 'Source clip' };

  if (kind === 'clip-factory' || kind === 'hybrid') {
    plan.moments = await planMoments({
      brief: String(spec.brief ?? ''),
      transcript,
      count: MOMENT_COUNT[kind] ?? 4,
      providers,
      usage,
    });
  }

  if (kind === 'podcast') {
    plan.seconds = Math.min(seconds, 180);
    plan.title = String(spec.brief ?? 'Podcast clip').split(/[.!?]/)[0]?.slice(0, 80) || 'Podcast clip';
  }

  if (kind === 'screen-demo' || kind === 'talking-head') {
    plan.seconds = seconds;
  }

  if (kind === 'dub') {
    const language = String(spec.language ?? 'es');
    plan.language = language;
    plan.engine = spec.engine === 'xtts' ? 'xtts' : 'kokoro';
    plan.voice = String(spec.voice ?? 'af_heart');
    plan.text = await translateTranscript({ transcript, language, providers, usage });
  }

  const planPath = path.join(workDir, 'edit-plan.json');
  await writeFile(planPath, JSON.stringify(plan, null, 2), 'utf8');

  await progress('rendering', 65, `Rendering ${kind}`);

  const out = path.join(workDir, 'output.mp4');

  const rendered = await run(
    python,
    [
      path.join(root, 'py', 'openmontage_source_edit.py'),
      '--stage',
      'render',
      '--kind',
      kind,
      '--source',
      local,
      '--work',
      workDir,
      '--plan',
      planPath,
      '--out',
      out,
    ],
    {
      cwd: root,
      shell: false,
      timeoutMs: 2_400_000,
      env: {
        KOKORO_MODEL: path.join(root, 'models', 'kokoro-v1.0.onnx'),
        KOKORO_VOICES: path.join(root, 'models', 'voices-v1.0.bin'),
      },
      onStderr: (line) => console.log(line.trim()),
    },
  );

  const resultLine = rendered.stdout.trim().split('\n').filter(Boolean).pop();
  let result;
  try {
    result = JSON.parse(resultLine);
  } catch {
    throw new Error('Render produced no result');
  }
  if (!result.ok) throw new Error(result.error || 'Render failed');

  await progress('finalising', 95, 'Edit complete');

  return {
    file: out,
    filename: `${kind}.mp4`,
    contentType: 'video/mp4',
    meta: {
      engine: 'OpenMontage / source edit',
      kind,
      duration: result.duration,
      moments: plan.moments?.length ?? 0,
      language: plan.language,
      voiceEngine: kind === 'dub' ? plan.engine : undefined,
      providers: [...new Set(providers)],
      cost_usd: usage.costUsd,
    },
  };
}
