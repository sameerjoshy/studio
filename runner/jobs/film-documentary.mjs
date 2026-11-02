import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { callModel } from '../lib/model.mjs';
import { run } from '../lib/shell.mjs';

const REPO = 'https://github.com/calesthio/OpenMontage.git';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalisePlan(data, seconds, tone) {
  const rawSlots = Array.isArray(data?.slots) ? data.slots : [];
  const fallbackSeconds = Math.round(seconds / Math.max(1, rawSlots.length || 5));

  const slots = rawSlots
    .map((slot) => ({
      query: String(slot?.query ?? '').trim(),
      seconds: clamp(Number(slot?.seconds) || fallbackSeconds, 3, 8),
      intent: String(slot?.intent ?? '').slice(0, 140),
    }))
    .filter((slot) => slot.query)
    .slice(0, 10);

  if (!slots.length) throw new Error('The planner returned no usable shot queries');

  return {
    title: String(data?.title ?? 'Documentary').slice(0, 120),
    tone: String(data?.tone ?? tone).slice(0, 60),
    slots,
  };
}

export default async function filmDocumentary({ job, spec, workDir, progress, root }) {
  const brief = String(spec.brief ?? '').trim();
  const seconds = clamp(Number(spec.seconds) || 30, 10, 90);
  const tone = String(spec.tone ?? 'observational');

  if (!brief) throw new Error('No brief supplied');

  await progress('planning', 8, 'Planning the montage');

  const planned = await callModel({
    system: [
      'You are a documentary editor planning a real-footage montage.',
      'Return JSON only: {"title": string, "tone": string, "slots": [{"query": string, "seconds": number, "intent": string}]}',
      'Rules:',
      '- 4-8 slots whose seconds add up to roughly the requested duration.',
      '- Each query is 2-5 literal, filmable words that a stock or archive search can match (e.g. "rain on city street", "apollo rocket launch", "crowd walking subway").',
      '- Never use abstract phrases, emotions, or brand names.',
      '- intent explains what the shot does for the story, in one short sentence.',
    ].join('\n'),
    user: `BRIEF:\n${brief}\n\nTarget duration: ${seconds} seconds\nTone: ${tone}`,
    maxTokens: 1200,
  });

  const plan = normalisePlan(planned.data, seconds, tone);
  const planPath = path.join(workDir, 'plan.json');
  await writeFile(planPath, JSON.stringify(plan, null, 2), 'utf8');

  await progress('cloning', 15, 'Fetching OpenMontage');

  const repo = path.join(workDir, 'OpenMontage');
  await run('git', ['clone', '--depth', '1', REPO, repo], { cwd: workDir, shell: false });

  await progress('sourcing', 28, `Sourcing footage for ${plan.slots.length} shots`);

  const python = process.env.PYTHON || 'python3';
  const out = path.join(workDir, 'documentary.mp4');

  const result = await run(
    python,
    [
      path.join(root, 'py', 'openmontage_documentary.py'),
      '--repo',
      repo,
      '--plan',
      planPath,
      '--out',
      out,
      '--project',
      `studio-${String(job.id).slice(0, 8)}`,
    ],
    {
      cwd: root,
      shell: false,
      timeoutMs: 1_500_000,
      onStderr: (line) => console.log(line.trim()),
    },
  );

  const lines = result.stdout.trim().split('\n').filter(Boolean);
  let parsed;
  try {
    parsed = JSON.parse(lines[lines.length - 1]);
  } catch {
    throw new Error(`OpenMontage returned no result: ${result.stdout.slice(-300)}`);
  }

  if (!parsed.ok) throw new Error(parsed.error || 'OpenMontage failed');

  await progress('finalising', 95, 'Documentary rendered');

  return {
    file: out,
    filename: 'documentary.mp4',
    contentType: 'video/mp4',
    meta: {
      engine: 'OpenMontage',
      title: plan.title,
      tone: plan.tone,
      requestedSeconds: seconds,
      slots: plan.slots.length,
      cuts: parsed.cuts,
      renderedSeconds: parsed.seconds,
      assets: parsed.assets,
      sources: parsed.sources,
      providers: [planned.provider],
      cost_usd: Number(planned.usage?.cost_usd ?? 0),
      tokens_in: Number(planned.usage?.tokens_in ?? 0),
      tokens_out: Number(planned.usage?.tokens_out ?? 0),
    },
  };
}
