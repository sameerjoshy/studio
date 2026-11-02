import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fitAspect } from '../lib/aspect.mjs';
import { callModel } from '../lib/model.mjs';
import { run } from '../lib/shell.mjs';
import { downloadObject, listObjects } from '../lib/supabase.mjs';

const REPO = 'https://github.com/calesthio/OpenMontage.git';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function filenameOf(url) {
  try {
    const base = new URL(String(url)).pathname.split('/').pop() ?? '';
    return decodeURIComponent(base);
  } catch {
    return String(url ?? '');
  }
}

function normalisePlan(data, seconds, tone) {
  const rawSlots = Array.isArray(data?.slots) ? data.slots : [];
  const fallbackSeconds = Math.round(seconds / Math.max(1, rawSlots.length || 5));

  const slots = rawSlots
    .map((slot, index) => ({
      slot_id: `slot_${String(index).padStart(2, '0')}`,
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

async function runSearch({ repo, python, root, workDir, plan, project, label }) {
  const planPath = path.join(workDir, `${label}-plan.json`);
  const outPath = path.join(workDir, `${label}-candidates.json`);

  await writeFile(planPath, JSON.stringify(plan, null, 2), 'utf8');

  await run(
    python,
    [
      path.join(root, 'py', 'openmontage_documentary.py'),
      '--mode',
      'search',
      '--repo',
      repo,
      '--plan',
      planPath,
      '--out-json',
      outPath,
      '--project',
      project,
    ],
    {
      cwd: root,
      shell: false,
      timeoutMs: 900_000,
      onStderr: (line) => console.log(line.trim()),
    },
  );

  const data = JSON.parse(await readFile(outPath, 'utf8'));
  if (!data.ok) throw new Error(data.error || 'Clip search failed');
  return data;
}

async function selectPicks({ brief, slots, providers }) {
  if (!slots.length) return [];

  const listing = slots.map((slot) => ({
    slot: slot.slot,
    query: slot.query,
    intent: slot.intent,
    candidates: slot.candidates.map((candidate, index) => ({
      i: index,
      file: filenameOf(candidate.source_url),
      source: candidate.source,
      seconds: Math.round(candidate.duration),
      lexical: candidate.relevance,
    })),
  }));

  const result = await callModel({
    system: [
      'You are selecting B-roll for a documentary.',
      'For each slot, choose the candidate whose filename best matches the slot query and the brief.',
      'Choose -1 when no candidate matches; an unrelated shot is worse than a missing one.',
      'Reject same-word-different-subject traps (a Mars helicopter for a Wright Flyer slot, a wind turbine for a jet engine slot).',
      'Return JSON only: {"picks":[{"slot":"slot_00","candidate":0,"reason":"one short sentence"}]}',
    ].join('\n'),
    user: `BRIEF:\n${brief}\n\nSLOTS AND CANDIDATES:\n${JSON.stringify(listing, null, 2)}`,
    maxTokens: 1200,
    prefer: 'groq',
  });

  providers.push(result.provider);

  const picks = [];
  const choiceBySlot = new Map();
  for (const pick of Array.isArray(result.data?.picks) ? result.data.picks : []) {
    if (pick?.slot) choiceBySlot.set(String(pick.slot), pick);
  }

  for (const slot of slots) {
    const choice = choiceBySlot.get(slot.slot);
    const rejected = choice && Number(choice.candidate) < 0;
    let candidate = null;

    if (!rejected) {
      if (choice && Number(choice.candidate) >= 0) {
        const chosen = slot.candidates[Number(choice.candidate)] ?? null;
        if (chosen && chosen.relevance > 0) candidate = chosen;
      }
      if (!candidate) {
        candidate = slot.candidates.find((item) => item.relevance > 0) ?? null;
      }
    }

    if (!candidate) continue;

    picks.push({
      slot: slot.slot,
      query: slot.query,
      path: candidate.path,
      source: candidate.source,
      source_url: candidate.source_url,
      license: candidate.license,
      duration: candidate.duration,
      hold: Math.max(1.5, Math.min(slot.seconds, candidate.duration)),
      reason: choice?.reason ?? slot.intent,
    });
  }

  return picks;
}

async function probeDuration(file) {
  const result = await run(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
    { shell: false },
  );
  return Number(result.stdout.trim()) || 0;
}

async function hasAudio(file) {
  const result = await run(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file],
    { shell: false },
  );
  return result.stdout.trim().includes('audio');
}

/**
 * Cinematic finish: warm grade, fade in/out, and a music bed from the private
 * library. No paid providers and no AI video generation.
 */
async function finishCinematic(file, workDir) {
  const duration = await probeDuration(file);
  const fadeOut = Math.max(0, duration - 0.8);
  const graded = path.join(workDir, 'cinematic-grade.mp4');

  await run(
    'ffmpeg',
    [
      '-y', '-v', 'error',
      '-i', file,
      '-vf',
      `eq=contrast=1.06:saturation=1.1:brightness=-0.01,fade=t=in:st=0:d=0.8,fade=t=out:st=${fadeOut.toFixed(2)}:d=0.8`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
      '-c:a', 'aac', '-b:a', '160k',
      graded,
    ],
    { shell: false, timeoutMs: 900_000 },
  );

  let music = null;
  try {
    const objects = await listObjects('studio-music');
    const track = (objects ?? []).find((object) => object.name && !object.name.endsWith('/'));
    if (track) {
      music = path.join(workDir, `music${path.extname(track.name) || '.mp3'}`);
      await downloadObject('studio-music', track.name, music);
    }
  } catch {
    music = null;
  }

  if (!music) return graded;

  const audio = await hasAudio(graded);
  const out = path.join(workDir, 'cinematic-final.mp4');
  const filter = audio
    ? '[1:a]volume=0.35[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=2[a]'
    : '[1:a]volume=0.45[a]';

  await run(
    'ffmpeg',
    [
      '-y', '-v', 'error',
      '-i', graded,
      '-stream_loop', '-1', '-i', music,
      '-filter_complex', filter,
      '-map', '0:v', '-map', '[a]',
      '-shortest',
      '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '160k',
      '-movflags', '+faststart',
      out,
    ],
    { shell: false, timeoutMs: 900_000 },
  );

  return out;
}

export default async function filmDocumentary({ job, spec, workDir, progress, root }) {
  const cinematic = job.capability === 'film-cinematic';
  const brief = String(spec.brief ?? '').trim();
  const seconds = clamp(Number(spec.seconds) || 30, 10, 90);
  const tone = String(spec.tone ?? 'observational');

  if (!brief) throw new Error('No brief supplied');

  const providers = [];
  let costUsd = 0;

  await progress('planning', 8, 'Planning the montage');

  const planned = await callModel({
    system: (cinematic
      ? [
          'You are a film editor planning a mood-led cinematic montage from real footage.',
          'Return JSON only: {"title": string, "tone": string, "slots": [{"query": string, "seconds": number, "intent": string}]}',
          'Rules:',
          '- 5-7 slots whose seconds add up to roughly the requested duration.',
          '- Each slot holds 5-7 seconds; this is slower and more atmospheric than a documentary cut.',
          '- Each query is 2-5 literal, filmable words a stock or archive search can match.',
          '- Mood and texture over exposition. No abstract phrases, no brand names.',
        ].join('\n')
      : [
          'You are a documentary editor planning a real-footage montage.',
          'Return JSON only: {"title": string, "tone": string, "slots": [{"query": string, "seconds": number, "intent": string}]}',
          'Rules:',
          '- 6-9 slots whose seconds add up to roughly the requested duration.',
          '- Each query is 2-5 literal, filmable words that a stock or archive search can match (e.g. "rain on city street", "apollo rocket launch", "crowd walking subway").',
          '- Never use abstract phrases, emotions, or brand names.',
          '- intent explains what the shot does for the story, in one short sentence.',
        ].join('\n')),
    user: `BRIEF:\n${brief}\n\nTarget duration: ${seconds} seconds\nTone: ${tone}`,
    maxTokens: 1400,
  });

  providers.push(planned.provider);
  costUsd += Number(planned.usage?.cost_usd ?? 0);

  const plan = normalisePlan(planned.data, seconds, tone);

  const repo = process.env.OPENMONTAGE_REPO_DIR || path.join(workDir, 'OpenMontage');
  if (!process.env.OPENMONTAGE_REPO_DIR) {
    await progress('cloning', 14, 'Fetching OpenMontage');
    await run('git', ['clone', '--depth', '1', REPO, repo], { cwd: workDir, shell: false });
  }

  const python = process.env.PYTHON || 'python3';
  const projectBase = `studio-${String(job.id).slice(0, 8)}`;

  await progress('sourcing', 24, `Sourcing footage for ${plan.slots.length} shots`);

  const first = await runSearch({
    repo,
    python,
    root,
    workDir,
    plan,
    project: `${projectBase}-a`,
    label: 'pass1',
  });

  await progress('selecting', 58, 'Reviewing candidates');
  let picks = await selectPicks({ brief, slots: first.slots, providers });

  // Second pass: when the strict gate drops shots, retry those slots with the
  // shortest form of the query, which open-archive search handles much better.
  const covered = new Set(picks.map((pick) => pick.slot));
  const uncovered = plan.slots.filter((slot) => !covered.has(slot.slot_id));

  if (uncovered.length && picks.length < plan.slots.length) {
    await progress('retrying', 66, `Retrying ${uncovered.length} shot(s) with simpler queries`);

    const simplified = uncovered.map((slot) => ({
      ...slot,
      query: slot.query.split(/\s+/).slice(0, 2).join(' '),
    }));

    try {
      const second = await runSearch({
        repo,
        python,
        root,
        workDir,
        plan: { ...plan, slots: simplified },
        project: `${projectBase}-b`,
        label: 'pass2',
      });

      const more = await selectPicks({ brief, slots: second.slots, providers });
      const seen = new Set(picks.map((pick) => pick.slot));
      picks = [...picks, ...more.filter((pick) => !seen.has(pick.slot))];
    } catch (error) {
      console.log(`second pass skipped: ${error.message}`);
    }
  }

  // The two search passes can surface the same file for different slots.
  // Repeating a shot reads as a mistake, so keep the first occurrence only.
  const seenPaths = new Set();
  picks = picks.filter((pick) => {
    if (seenPaths.has(pick.path)) return false;
    seenPaths.add(pick.path);
    return true;
  });

  const totalSeconds = picks.reduce((sum, pick) => sum + pick.hold, 0);
  if (picks.length < 3 || totalSeconds < 8) {
    throw new Error(
      `Only ${picks.length} relevant shot(s) found in the open archives. ` +
        'Add a free Pexels key (PEXELS_API_KEY) or use a more literal, filmable brief.',
    );
  }

  const picksPath = path.join(workDir, 'picks.json');
  await writeFile(picksPath, JSON.stringify({ picks }, null, 2), 'utf8');

  await progress('composing', 80, `Cutting ${picks.length} shots`);

  const out = path.join(workDir, 'documentary.mp4');

  const result = await run(
    python,
    [
      path.join(root, 'py', 'openmontage_documentary.py'),
      '--mode',
      'compose',
      '--repo',
      repo,
      '--picks',
      picksPath,
      '--out',
      out,
    ],
    {
      cwd: root,
      shell: false,
      timeoutMs: 900_000,
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
  if (!parsed.ok) throw new Error(parsed.error || 'OpenMontage compose failed');

  let final = out;
  if (cinematic) {
    await progress('grading', 90, 'Grading and adding music');
    final = await finishCinematic(out, workDir);
  }

  const aspect = ['9:16', '1:1'].includes(String(spec.aspect)) ? String(spec.aspect) : '16:9';
  final = await fitAspect(final, aspect, workDir, 'pad');

  await progress('finalising', 95, cinematic ? 'Cinematic rendered' : 'Documentary rendered');

  return {
    file: final,
    filename: cinematic ? 'cinematic.mp4' : 'documentary.mp4',
    contentType: 'video/mp4',
    meta: {
      engine: cinematic ? 'OpenMontage cinematic' : 'OpenMontage',
      style: cinematic ? 'cinematic' : 'documentary',
      title: plan.title,
      tone: plan.tone,
      requestedSeconds: seconds,
      slots: plan.slots.length,
      cuts: parsed.cuts,
      renderedSeconds: parsed.seconds,
      assets: parsed.assets,
      sources: first.sources,
      providers: [...new Set(providers)],
      cost_usd: costUsd,
    },
  };
}
