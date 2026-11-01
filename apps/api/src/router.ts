import type { Env } from './env';
import { ACTIVE_CAPABILITIES, CAPABILITIES, getCapability, type Capability } from './capabilities';
import { callJson, diagnoseProviders, listGroqModels } from './lib/llm';
import { dispatchRender } from './lib/github';
import { validateSpec } from './lib/spec';
import {
  addEvent,
  getJob,
  insertJob,
  listEvents,
  listJobs,
  signedUrl,
  updateJob,
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
  const manifest = ACTIVE_CAPABILITIES.map((capability) => ({
    id: capability.id,
    studio: capability.studio,
    name: capability.name,
    outcome: capability.outcome,
    inputs: capability.inputs,
    example: capability.examples[0],
    spec:
      capability.id === 'deck-native'
        ? '{ "title": string, "subtitle": string, "slides": [{ "title": string, "bullets": string[], "notes": string }] }'
        : capability.id === 'film-brand'
          ? '{ "title": string, "subtitle": string, "bullets": [string, string, string], "accent": "#RRGGBB" }'
          : capability.id === 'voice-kokoro'
            ? '{ "text": string, "voice": string, "speed": number }'
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
    'Deck content must be substantive: 5-8 slides for a normal deck, 3-5 bullets per slide, written for the stated audience.',
    'Film content must fit 12 seconds: one title, one subtitle, exactly three short lines.',
    'Narration text is read aloud: no markdown, no stage directions, no emoji.',
    '',
    'Be decisive. Infer anything you reasonably can and run. Specifically:',
    '- Film: if supporting lines are missing, write three. Never ask for the accent; default to #34D399.',
    '- Film: if the subtitle is missing, write one.',
    '- Deck: if the slide count is missing, use 6. If the audience is missing, assume a business audience.',
    '- Narration: if the voice is missing, use a warm neutral voice.',
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
    const job = await startJob(env, capability, validation.spec, usageMeta);
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
    const job = await startJob(env, capability, validation.spec, { source: 'direct' });
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

  const jobMatch = path.match(/^\/api\/jobs\/([0-9a-f-]{36})$/i);
  if (jobMatch && method === 'GET') {
    return handleGetJob(env, jobMatch[1]!);
  }

  return json({ error: 'Not found' }, 404);
}
