import type { Env } from './env';
import { json, serverError, unauthorized } from './lib/http';
import { safeEqual } from './lib/session';
import { deleteStaleOutputs, deleteStaleSources } from './lib/supabase';
import { handleApi, handleInternalLlm, handleInternalSlop } from './router';

const GENERATION_PATHS = new Set(['/api/chat', '/api/run']);
const GENERATION_LIMIT = 60;
const GENERATION_WINDOW_MS = 10 * 60 * 1000;

const hits = new Map<string, { count: number; reset: number }>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const entry = hits.get(key);

  if (!entry || entry.reset < now) {
    hits.set(key, { count: 1, reset: now + GENERATION_WINDOW_MS });
    return false;
  }

  entry.count += 1;
  return entry.count > GENERATION_LIMIT;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    let url = new URL(request.url);

    // The app is also mounted at apps.gtm-360.com/studio, where the hub already
    // strips the prefix. Accept the prefix directly too so /studio works on the
    // Worker origin and absolute asset URLs resolve on both surfaces.
    if (url.pathname === '/studio') {
      return Response.redirect(`${url.origin}/studio/`, 302);
    }
    if (url.pathname.startsWith('/studio/')) {
      const stripped = new URL(url.toString());
      stripped.pathname = url.pathname.replace(/^\/studio/, '') || '/';
      url = stripped;
      request = new Request(stripped.toString(), request);
    }

    if (url.pathname === '/health') {
      return json({ ok: true, service: 'studio' });
    }

    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    if (url.pathname.startsWith('/api/internal/') && request.method === 'POST') {
      const provided = request.headers.get('x-runner-secret') ?? '';
      if (!env.RUNNER_SECRET || !safeEqual(provided, env.RUNNER_SECRET)) {
        return unauthorized('Bad runner secret');
      }
      if (url.pathname === '/api/internal/llm') return handleInternalLlm(env, request);
      if (url.pathname === '/api/internal/slop') return handleInternalSlop(env, request);
      return json({ error: 'Not found' }, 404);
    }

    if (url.pathname === '/api/session') {
      return json({ ok: true, auth: 'open' });
    }

    // Studio is open by design. This is a best-effort spend guard, not auth:
    // it stops a single client from draining Actions minutes or model credits.
    if (GENERATION_PATHS.has(url.pathname) && request.method === 'POST') {
      const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
      if (rateLimited(ip)) {
        return json({ error: 'Slow down for a few minutes.' }, 429);
      }
    }

    try {
      return await handleApi(env, request, url);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error';
      return serverError(message);
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      Promise.all([deleteStaleOutputs(env, 30), deleteStaleSources(env, 24)]).catch(() => {}),
    );
  },
};
