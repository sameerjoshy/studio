import type { Env } from './env';
import { ACTIVE_CAPABILITIES, CAPABILITIES, getCapability, type Capability } from './capabilities';
import { callJson, diagnoseProviders, listGroqModels } from './lib/llm';
import { dispatchRender } from './lib/github';
import { validateSpec } from './lib/spec';
import { applyCopy, collectCopy, scoreCopy, summarise, type CopyLine, type SlopIssue } from './lib/slop';
import {
  addEvent,
  getJob,
  insertJob,
  listEvents,
  listJobs,
  signedUrl,
  updateJob,
  createSignedUpload,
  type Job,
} from './lib/supabase';
import { badRequest, json, readJson, serverError } from './lib/http';

const MAX_MESSAGES = 10;
const MAX_MESSAGE_CHARS = 4000;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface RouterResult {
  action?: 'run' | 'ask' | 'chat';
  capability?: string;
  reply?: string;
  spec?: unknown;
  missing?: string[];
}

const ROUTER_SCHEMA = `Return ONLY a JSON object with this shape:
{
  "action": "run" | "ask" | "chat",
  "capability": "<one of the capability ids>",
  "reply": "<one or two sentences to the user>",
  "spec": { ... },
  "missing": ["<field>"]
}

Rules:
- "run": you have everything needed. Fill "spec" completely with real content, never placeholders.
- "ask": one essential detail is missing and cannot be inferred. Put a single question in "reply" and list the fields in "missing".
- "chat": the user is asking what Studio can do, or just talking. Answer briefly and concretely; do not invent capabilities.
- Never invent capability ids. Never claim a file already exists.
- Keep "reply" under 40 words unless the user asked for an explanation.`;

function buildSystemPrompt(): string {
  const manifest = ACTIVE_CAPABILITIES.filter((capability) => !capability.requiresSource).map((capability) => ({
    id: capability.id,
    studio: capability.studio,
    name: capability.name,
    outcome: capability.outcome,
    inputs: capability.inputs,
    example: capability.examples[0],
    spec:
      capability.id === 'deck-native'
        ? '{ "title": string, "subtitle": string, "slides": [{ "title": string, "bullets": string[], "notes": string }] }'
        : capability.id === 'deck-pptmaster'
          ? '{ "brief": string, "audience": string, "slides"?: number }'
          : capability.id === 'film-documentary'
            ? '{ "brief": string, "seconds": number, "tone": string }'
            : capability.id === 'film-explainer'
              ? '{ "brief": string, "seconds": number, "audience": string, "aspect"?: "16:9"|"9:16"|"1:1" }'
              : capability.id === 'film-motion-graphics'
                ? '{ "brief": string, "seconds": number, "audience": string, "aspect"?: "16:9"|"9:16"|"1:1" }'
            : capability.id === 'film-brand'
          ? '{ "title": string, "subtitle": string, "bullets": [string, string, string], "accent": "#RRGGBB", "aspect"?: "16:9"|"9:16"|"1:1" }'
          : capability.id === 'voice-kokoro'
            ? '{ "text": string, "voice": string, "speed": number, "engine"?: "kokoro"|"edge" }'
            : capability.id === 'voice-xtts'
              ? '{ "text": string, "reference_url": string, "language": string }'
              : '{}',
  }));

  return [
    'You are Studio, the control room for GTM-360 creative output.',
    'You route a request to exactly one capability and produce its spec.',
    '',
    'Capabilities:',
    JSON.stringify(manifest, null, 2),
    '',
    'Deck content must be substantive: choose the number of slides the brief actually needs (a quick update may be 3-4, a broad topic 8-12), 3-5 bullets per slide, written for the stated audience.',
    'Never invent statistics, percentages, or customer names. If the brief has no numbers, write without them.',
    'Film content must fit 12 seconds: one title, one subtitle, exactly three short lines.',
    'Narration text is read aloud: no markdown, no stage directions, no emoji.',
    '',
    'Be decisive. Infer anything you reasonably can and run. Specifically:',
    '- Film: if supporting lines are missing, write three. Never ask for the accent; default to #34D399.',
    '- Film: if the subtitle is missing, write one.',
    '- Documentary: infer duration when the user does not state it (default 30 seconds, max 90). Never ask. Keep queries literal and filmable.',
    '- Explainer: infer duration when the user does not state it (default 30 seconds, max 90). Never ask.',
    '- Aspect: if the user says vertical, Reels, TikTok, or Short, set "aspect": "9:16". For square or LinkedIn, "1:1". Otherwise "16:9".',
    '- Deck: never invent a slide count. If the user gave one, pass it as "slides"; otherwise omit it and let the deck planner infer the length from the brief.',
    '- Deck: if the audience is missing, infer it, otherwise assume a business audience.',
    '- Narration: if the voice is missing, use a warm neutral voice. Use engine "edge" only when the user asks for it; otherwise "kokoro".',
    'Only choose "ask" when the subject itself is unknown (for example, an empty or meaningless brief).',
    '',
    ROUTER_SCHEMA,
  ].join('\n');
}

function resolveCapability(value: unknown): Capability | undefined {
  if (typeof value !== 'string') return undefined;
  const needle = value.trim().toLowerCase();
  return (
    CAPABILITIES.find((capability) => capability.id.toLowerCase() === needle) ??
    CAPABILITIES.find((capability) => capability.name.toLowerCase() === needle) ??
    CAPABILITIES.find((capability) => capability.outcome.toLowerCase().includes(needle))
  );
}

function transcript(messages: ChatMessage[]): string {
  return messages
    .slice(-MAX_MESSAGES)
    .map((message) => `${message.role === 'user' ? 'USER' : 'ASSISTANT'}: ${message.content.slice(0, MAX_MESSAGE_CHARS)}`)
    .join('\n');
}

export interface SlopMeta {
  score: number;
  issues: SlopIssue[];
  before?: number;
  revised: boolean;
}

async function reviseLines(
  env: Env,
  values: string[],
  issues: SlopIssue[],
): Promise<string[] | null> {
  try {
    const result = await callJson(env, {
      system: [
        'You are a copy editor. Rewrite each line to be direct, specific, and human.',
        'Keep the meaning, facts, length, and order. Do not add or remove lines.',
        'Never use these exact tokens or their variants: unlock, unleash, elevate, supercharge,',
        'seamless, game-changer, cutting-edge, revolutionize, transformative, delve, ever-evolving,',
        'tapestry, testament to, not just a, more than just, next-level, best-in-class, world-class,',
        'synergy, leverage, empower, paradigm, disrupt, "in today\'s fast-paced".',
        'Also remove: "in order to", "the fact that", "it is important to note", "at the end of the day".',
        'No em dashes. No -ly adverbs. No "very", "really", "just", or "actually".',
        'Return JSON only: {"lines": ["..."]}',
      ].join('\n'),
      user: `PROBLEMS: ${summarise(issues)}\n\nLINES:\n${JSON.stringify(values, null, 2)}`,
      maxTokens: 1800,
    });

    const payload = (result.data ?? {}) as { lines?: unknown[] };
    const revised = Array.isArray(payload.lines)
      ? payload.lines.map((line) => String(line))
      : [];

    return revised.length === values.length ? revised : null;
  } catch {
    return null;
  }
}

/**
 * Score the model-written copy and, if it is below the bar, ask for one
 * revision pass. Facts and structure stay put; only the wording changes.
 */
async function gateCopy(
  env: Env,
  capability: Capability,
  spec: Record<string, unknown>,
): Promise<{ spec: Record<string, unknown>; slop: SlopMeta | null }> {
  const lines = collectCopy(spec, capability.id);
  if (!lines.length) return { spec, slop: null };

  const before = scoreCopy(lines.map((line) => line.value).join('\n'));
  const banned = before.issues.filter((issue) => issue.kind === 'banned').length;

  if (before.score >= 40 && banned < 2) {
    return { spec, slop: { score: before.score, issues: before.issues, revised: false } };
  }

  const revised = await reviseLines(
    env,
    lines.map((line) => line.value),
    before.issues,
  );

  if (revised) {
    const after = scoreCopy(revised.join('\n'));
    if (after.score > before.score) {
      const next = lines.map((line, index) => ({ ...line, value: revised[index] })) as CopyLine[];
      return {
        spec: applyCopy(spec, next),
        slop: { score: after.score, issues: after.issues, before: before.score, revised: true },
      };
    }
  }

  return { spec, slop: { score: before.score, issues: before.issues, revised: false } };
}

async function startJob(
  env: Env,
  capability: Capability,
  spec: Record<string, unknown>,
  meta: Record<string, unknown> = {},
): Promise<Job> {
  const job = await insertJob(env, capability.id, spec, meta);
  await addEvent(env, job.id, 'Job queued', 'queued');

  try {
    await dispatchRender(env, job.id);
    await addEvent(env, job.id, 'Runner requested', 'dispatched');
    return (await updateJob(env, job.id, { status: 'dispatched' })) ?? job;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateJob(env, job.id, { status: 'error', error: message });
    await addEvent(env, job.id, `Dispatch failed: ${message}`, 'error', 'error');
    throw error;
  }
}

/**
 * Runner-only model gateway. Keeps every provider key inside the Worker; the
 * harness authenticates with RUNNER_SECRET instead of holding LLM keys.
 */
export async function handleInternalSlop(env: Env, request: Request): Promise<Response> {
  const body = await readJson<{ lines?: unknown[]; revise?: boolean }>(request);
  const lines = (body?.lines ?? []).filter(
    (line): line is string => typeof line === 'string' && line.trim().length > 0,
  );

  if (!lines.length) return badRequest('lines are required');
  if (lines.length > 80) return badRequest('too many lines');

  const before = scoreCopy(lines.join('\n'));
  const banned = before.issues.filter((issue) => issue.kind === 'banned').length;
  let revised: string[] | null = null;

  if (body?.revise && (before.score < 40 || banned >= 2)) {
    revised = await reviseLines(env, lines, before.issues);
  }

  return json({
    score: revised ? scoreCopy(revised.join('\n')).score : before.score,
    before: before.score,
    issues: before.issues,
    lines: revised,
  });
}

export async function handleInternalLlm(env: Env, request: Request): Promise<Response> {
  const body = await readJson<{
    system?: string;
    user?: string;
    maxTokens?: number;
    json?: boolean;
    prefer?: 'groq' | 'deepseek' | 'gemini';
  }>(request);
  const system = typeof body?.system === 'string' ? body.system : '';
  const user = typeof body?.user === 'string' ? body.user : '';

  if (!system || !user) return badRequest('system and user are required');
  if (system.length > 20_000 || user.length > 40_000) return badRequest('Prompt too large');

  const requested = Number(body?.maxTokens);
  const maxTokens = Number.isFinite(requested) ? Math.min(4000, Math.max(200, requested)) : 2200;

  try {
    const result = await callJson(env, {
      system,
      user,
      maxTokens,
      temperature: 0.2,
      jsonMode: body?.json !== false,
      prefer: body?.prefer,
    });
    return json({
      data: result.data,
      provider: result.provider,
      model: result.model,
      usage: { tokens_in: result.tokensIn, tokens_out: result.tokensOut, cost_usd: result.costUsd },
    });
  } catch (error) {
    return serverError(error instanceof Error ? error.message : 'Model call failed');
  }
}

async function handleChat(env: Env, request: Request): Promise<Response> {
  const body = await readJson<{ messages?: ChatMessage[] }>(request);
  const messages = (body?.messages ?? []).filter(
    (message): message is ChatMessage =>
      !!message &&
      (message.role === 'user' || message.role === 'assistant') &&
      typeof message.content === 'string' &&
      message.content.trim().length > 0,
  );

  if (!messages.length) return badRequest('Send a message first.');

  let result;
  try {
    result = await callJson(env, {
      system: buildSystemPrompt(),
      user: transcript(messages),
      maxTokens: 1800,
      temperature: 0.3,
    });
  } catch (error) {
    return serverError(error instanceof Error ? error.message : 'The model call failed.');
  }

  const routed = (result.data ?? {}) as RouterResult;
  const action = routed.action ?? 'chat';
  const reply = typeof routed.reply === 'string' ? routed.reply.trim() : '';
  const usageMeta = {
    provider: result.provider,
    model: result.model,
    tokens_in: result.tokensIn,
    tokens_out: result.tokensOut,
    cost_usd: result.costUsd,
  };

  if (action !== 'run') {
    return json({
      action,
      reply: reply || 'Tell me what outcome you want and I will pick the right studio.',
      missing: routed.missing ?? [],
      usage: usageMeta,
    });
  }

  const capability = resolveCapability(routed.capability);
  if (!capability) {
    return json({
      action: 'chat',
      reply:
        'I could not match that to a studio yet. I can make decks, brand films, and narration today.',
      usage: usageMeta,
    });
  }

  if (capability.status === 'planned') {
    return json({
      action: 'chat',
      reply:
        capability.disabledReason ??
        `${capability.name} is planned but not live yet. I can use another studio in the meantime.`,
      usage: usageMeta,
    });
  }

  const validation = validateSpec(capability, routed.spec);
  if (!validation.ok) {
    return json({
      action: 'ask',
      reply: validation.problem ?? 'I need one more detail before I can run that.',
      missing: [capability.id],
      usage: usageMeta,
    });
  }

  try {
    const gated = await gateCopy(env, capability, validation.spec);
    const job = await startJob(env, capability, gated.spec, { ...usageMeta, slop: gated.slop });
    return json({
      action: 'run',
      reply: reply || `Starting ${capability.name}.`,
      capability: capability.id,
      job,
      usage: usageMeta,
    });
  } catch (error) {
    return serverError(error instanceof Error ? error.message : 'Could not start the job.');
  }
}

async function handleRun(env: Env, request: Request): Promise<Response> {
  const body = await readJson<{ capability?: string; spec?: unknown }>(request);
  if (!body?.capability) return badRequest('capability is required');

  const capability = getCapability(body.capability);
  if (!capability) return badRequest('Unknown capability');
  if (capability.status === 'planned') return badRequest(capability.disabledReason ?? 'Not live yet');

  const validation = validateSpec(capability, body.spec);
  if (!validation.ok) return badRequest(validation.problem ?? 'Invalid spec');

  try {
    const gated = await gateCopy(env, capability, validation.spec);
    const job = await startJob(env, capability, gated.spec, {
      source: 'direct',
      slop: gated.slop,
    });
    return json({ job }, 201);
  } catch (error) {
    return serverError(error instanceof Error ? error.message : 'Could not start the job.');
  }
}

async function handleGetJob(env: Env, id: string): Promise<Response> {
  const [job, events] = await Promise.all([getJob(env, id), listEvents(env, id)]);
  if (!job) return json({ error: 'Job not found' }, 404);

  const url = job.output_path && job.status === 'complete' ? await signedUrl(env, job.output_path) : null;
  return json({ job, events, url });
}

const RERENDERABLE = new Set(['deck-native', 'film-brand']);

async function handleRerender(env: Env, id: string, request: Request): Promise<Response> {
  const job = await getJob(env, id);
  if (!job) return json({ error: 'Job not found' }, 404);
  if (!RERENDERABLE.has(job.capability)) {
    return badRequest('This job does not support edit and re-render yet');
  }

  const capability = getCapability(job.capability);
  if (!capability) return badRequest('Capability no longer exists');

  const body = await readJson<{ overrides?: Record<string, unknown> }>(request);
  const overrides = body?.overrides && typeof body.overrides === 'object' ? body.overrides : {};
  const merged = { ...(job.spec as Record<string, unknown>), ...overrides };

  const validation = validateSpec(capability, merged);
  if (!validation.ok) return badRequest(validation.problem ?? 'Invalid edit');

  try {
    const gated = await gateCopy(env, capability, validation.spec);
    const next = await startJob(env, capability, gated.spec, {
      source: 'rerender',
      parent_job_id: id,
      slop: gated.slop,
    });
    return json({ job: next }, 201);
  } catch (error) {
    return serverError(error instanceof Error ? error.message : 'Could not re-render');
  }
}

async function handleRetry(env: Env, id: string): Promise<Response> {
  const job = await getJob(env, id);
  if (!job) return json({ error: 'Job not found' }, 404);

  const capability = getCapability(job.capability);
  if (!capability) return badRequest('Capability no longer exists');

  await updateJob(env, id, {
    status: 'queued',
    stage: null,
    progress: 0,
    error: null,
    output_path: null,
    output_name: null,
  });
  await addEvent(env, id, 'Retry requested', 'queued');

  try {
    await dispatchRender(env, id);
    await addEvent(env, id, 'Runner requested', 'dispatched');
    await updateJob(env, id, { status: 'dispatched' });
    return json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateJob(env, id, { status: 'error', error: message });
    return serverError(message);
  }
}

export async function handleApi(env: Env, request: Request, url: URL): Promise<Response> {
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (path === '/api/capabilities' && method === 'GET') {
    return json({ capabilities: CAPABILITIES });
  }

  if (path === '/api/diag' && method === 'GET') {
    return json({ providers: await diagnoseProviders(env) });
  }

  if (path === '/api/diag/models' && method === 'GET') {
    return json({ models: await listGroqModels(env) });
  }

  if (path === '/api/uploads/presign' && method === 'POST') {
    const body = await readJson<{ filename?: string; size?: number }>(request);
    const filename = String(body?.filename ?? '').toLowerCase();
    const size = Number(body?.size ?? 0);
    const MAX_BYTES = 250 * 1024 * 1024;

    const extension = filename.split('.').pop() ?? '';
    const allowed = new Set(['mp4', 'mov', 'webm', 'mkv', 'mp3', 'wav', 'm4a', 'ogg']);
    if (!allowed.has(extension)) return badRequest('Unsupported file type');
    if (!Number.isFinite(size) || size <= 0) return badRequest('Missing file size');
    if (size > MAX_BYTES) return badRequest('That file is over the 250 MB limit');

    const safe = filename.replace(/[^a-z0-9.-]/g, '-').slice(-60);
    const path = `sources/${crypto.randomUUID()}-${safe}`;

    try {
      const signed = await createSignedUpload(env, path);
      return json({ ...signed, maxBytes: MAX_BYTES });
    } catch (error) {
      return serverError(error instanceof Error ? error.message : 'Could not prepare the upload');
    }
  }

  if (path === '/api/chat' && method === 'POST') {
    return handleChat(env, request);
  }

  if (path === '/api/run' && method === 'POST') {
    return handleRun(env, request);
  }

  if (path === '/api/jobs' && method === 'GET') {
    const jobs = await listJobs(env, 30);
    return json({ jobs });
  }

  const retryMatch = path.match(/^\/api\/jobs\/([0-9a-f-]{36})\/retry$/i);
  if (retryMatch && method === 'POST') {
    return handleRetry(env, retryMatch[1]!);
  }

  const rerenderMatch = path.match(/^\/api\/jobs\/([0-9a-f-]{36})\/rerender$/i);
  if (rerenderMatch && method === 'POST') {
    return handleRerender(env, rerenderMatch[1]!, request);
  }

  const jobMatch = path.match(/^\/api\/jobs\/([0-9a-f-]{36})$/i);
  if (jobMatch && method === 'GET') {
    return handleGetJob(env, jobMatch[1]!);
  }

  return json({ error: 'Not found' }, 404);
}
