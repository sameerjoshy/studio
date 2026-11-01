import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { run } from '../lib/shell.mjs';
import { runHarness } from '../lib/harness.mjs';
import deckNative from './deck-native.mjs';

const PPT_REPO = 'https://github.com/hugohe3/ppt-master.git';

async function newestDirectory(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  let best = null;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    const info = await stat(full).catch(() => null);
    if (!info) continue;
    if (!best || info.mtimeMs > best.mtimeMs) best = { path: full, mtime: info.mtimeMs };
  }
  return best?.path ?? null;
}

async function newestPptx(dir) {
  let best = null;

  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name.toLowerCase().endsWith('.pptx')) {
        const info = await stat(full).catch(() => null);
        if (info && (!best || info.mtimeMs > best.mtime)) best = { file: full, mtime: info.mtimeMs };
      }
    }
  }

  await walk(dir);
  return best?.file ?? null;
}

function chunkSentences(brief, count) {
  const sentences = brief
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 15);

  const slides = [];
  const bodyCount = Math.max(1, count - 2);
  const perSlide = Math.max(1, Math.ceil(sentences.length / bodyCount));

  for (let index = 0; index < bodyCount; index += 1) {
    const bullets = sentences.slice(index * perSlide, (index + 1) * perSlide);
    if (!bullets.length) break;
    slides.push({ title: `Point ${index + 1}`, bullets });
  }

  if (!slides.length) {
    slides.push({ title: 'Overview', bullets: [brief.slice(0, 240)] });
  }

  return slides;
}

export default async function deckPptmaster({ spec, workDir, progress, root }) {
  const brief = String(spec.brief ?? '').trim();
  const slideCount = Math.min(10, Math.max(3, Number(spec.slides) || 6));
  const audience = String(spec.audience ?? 'business audience');
  const repo = path.join(workDir, 'ppt-master');
  const python = process.env.PYTHON || 'python3';

  if (!brief) throw new Error('No brief supplied');

  await progress('cloning', 6, 'Fetching the ppt-master skill');

  await run(
    'git',
    ['clone', '--depth', '1', '--filter=blob:none', '--sparse', PPT_REPO, repo],
    { cwd: workDir, shell: false },
  );
  await run('git', ['sparse-checkout', 'set', 'skills/ppt-master'], {
    cwd: repo,
    shell: false,
  });

  const skill = path.join(repo, 'skills', 'ppt-master');

  await progress('scaffolding', 12, 'Creating the project');

  await run(
    python,
    [path.join(skill, 'scripts', 'project_manager.py'), 'init', 'studio', '--quick-generate'],
    { cwd: repo, shell: false },
  );

  const project = await newestDirectory(path.join(repo, 'projects'));
  if (!project) throw new Error('ppt-master did not create a project directory');

  await progress('authoring', 16, 'Harness authoring slides');

  let harness = null;
  let harnessError = null;

  try {
    harness = await runHarness({
      repo,
      project,
      brief,
      slides: slideCount,
      audience,
      progress,
      python,
    });
  } catch (error) {
    harnessError = error instanceof Error ? error.message : String(error);
    await progress('fallback', 60, `Harness failed: ${harnessError.slice(0, 180)}`);
  }

  let file = harness?.file ?? (await newestPptx(project));

  if (!file) {
    await progress('fallback', 70, 'No deck exported; using the deterministic fallback');
    const fallback = await deckNative({
      spec: {
        title: brief.split(/[.!?]/)[0]?.slice(0, 90) || 'Studio deck',
        subtitle: `Prepared for ${audience}`,
        slides: chunkSentences(brief, slideCount),
      },
      workDir,
      progress,
    });

    return {
      ...fallback,
      filename: 'deck-pptmaster.pptx',
      meta: {
        ...(fallback.meta ?? {}),
        engine: 'ppt-master (fallback: deck-native)',
        harnessError,
        slides: slideCount,
      },
    };
  }

  await progress('exporting', 92, 'Native PowerPoint exported');

  return {
    file,
    filename: 'deck-pptmaster.pptx',
    contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    meta: {
      engine: 'ppt-master',
      harnessSteps: harness?.steps ?? 0,
      providers: harness?.providers ?? [],
      slides: harness?.total ?? slideCount,
      approvedPlan: harness?.plan?.title,
      harnessError,
    },
  };
}
