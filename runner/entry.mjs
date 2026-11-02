import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  addEvent,
  deleteObject,
  ensureBucket,
  getJob,
  updateJob,
  uploadObject,
} from './lib/supabase.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));

const JOBS = {
  'voice-kokoro': () => import('./jobs/voice-kokoro.mjs'),
  'voice-xtts': () => import('./jobs/voice-xtts.mjs'),
  'deck-native': () => import('./jobs/deck-native.mjs'),
  'deck-pptmaster': () => import('./jobs/deck-pptmaster.mjs'),
  'film-brand': () => import('./jobs/film-brand.mjs'),
  'film-documentary': () => import('./jobs/film-documentary.mjs'),
  'film-cinematic': () => import('./jobs/film-documentary.mjs'),
  'film-explainer': () => import('./jobs/film-explainer.mjs'),
  'film-motion-graphics': () => import('./jobs/film-explainer.mjs'),
  'film-talking-head': () => import('./jobs/source-edit.mjs'),
  'film-clip-factory': () => import('./jobs/source-edit.mjs'),
  'film-podcast': () => import('./jobs/source-edit.mjs'),
  'film-dub': () => import('./jobs/source-edit.mjs'),
  'film-screen-demo': () => import('./jobs/source-edit.mjs'),
  'film-hybrid': () => import('./jobs/source-edit.mjs'),
};

function cleanName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80) || 'output';
}

async function main() {
  const jobId = process.env.JOB_ID;
  if (!jobId) throw new Error('JOB_ID is required');

  const job = await getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  if (job.status === 'complete' || job.status === 'killed') {
    console.log(`Job ${jobId} already ${job.status}; nothing to do.`);
    return;
  }

  const loader = JOBS[job.capability];
  if (!loader) throw new Error(`No runner for capability ${job.capability}`);

  const workDir = await mkdtemp(path.join(os.tmpdir(), 'studio-'));
  let lastStage = 'starting';

  const progress = async (stage, percent, message) => {
    lastStage = stage;
    await updateJob(jobId, { status: 'running', stage, progress: Math.round(percent) });
    if (message) await addEvent(jobId, message, stage);
    console.log(`[${stage}] ${percent}% ${message ?? ''}`);
  };

  try {
    await updateJob(jobId, { status: 'running', stage: 'starting', progress: 2, error: null });
    await addEvent(jobId, 'Runner started', 'starting');

    const module = await loader();
    const result = await module.default({ job, spec: job.spec ?? {}, workDir, progress, root });

    const fileStat = await stat(result.file);
    if (!fileStat.size) throw new Error('Runner produced an empty file');

    await progress('uploading', 94, 'Uploading the result');
    await ensureBucket();

    const filename = cleanName(result.filename);
    const objectPath = `${jobId}/${filename}`;
    const bytes = await readFile(result.file);
    await uploadObject(objectPath, bytes, result.contentType);

    await updateJob(jobId, {
      status: 'complete',
      stage: 'complete',
      progress: 100,
      output_path: objectPath,
      output_name: filename,
      meta: { ...(job.meta ?? {}), ...(result.meta ?? {}), bytes: fileStat.size },
    });
    await addEvent(jobId, `Complete: ${filename}`, 'complete');
    console.log(`Done: ${objectPath} (${fileStat.size} bytes)`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateJob(jobId, { status: 'error', stage: lastStage, error: message.slice(0, 2000) });
    await addEvent(jobId, message.slice(0, 2000), lastStage, 'error');
    console.error(message);
    process.exitCode = 1;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});

    // Sources are working files: delete the upload once the job is done,
    // whether it succeeded or failed.
    const sourcePath = job.spec?.source_path;
    if (sourcePath) {
      await deleteObject('studio-sources', sourcePath).catch(() => {});
    }
  }
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  const jobId = process.env.JOB_ID;
  if (jobId) {
    await updateJob(jobId, { status: 'error', error: message.slice(0, 2000) }).catch(() => {});
    await addEvent(jobId, message.slice(0, 2000), 'error', 'error').catch(() => {});
  }
  process.exitCode = 1;
});
