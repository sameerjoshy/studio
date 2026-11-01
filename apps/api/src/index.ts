import type { Env } from './env';
import { json, readJson, serverError, unauthorized } from './lib/http';
import {
  clearCookie,
  issueSession,
  readCookie,
  safeEqual,
  sessionCookie,
  verifySession,
  COOKIE_NAME,
} from './lib/session';
import { handleApi, handleInternalLlm } from './router';

const attempts = new Map<string, { count: number; reset: number }>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.reset < now) {
    attempts.set(key, { count: 1, reset: now + 60_000 });
    return false;
  }
  entry.count += 1;
  return entry.count > 8;
}

async function handleAuth(env: Env, request: Request): Promise<Response> {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (rateLimited(ip)) return json({ error: 'Too many attempts. Wait a minute.' }, 429);

  const body = await readJson<{ passphrase?: string }>(request);
  const passphrase = typeof body?.passphrase === 'string' ? body.passphrase : '';

  if (!env.STUDIO_PASSPHRASE || !env.STUDIO_SESSION_SECRET) {
    return serverError('Studio is not configured (passphrase secret missing).');
  }

  if (!passphrase || !safeEqual(passphrase, env.STUDIO_PASSPHRASE)) {
    return json({ error: 'That passphrase is not right.' }, 401);
  }

  const token = await issueSession(env.STUDIO_SESSION_SECRET);
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(token) });
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({ ok: true, service: 'studio' });
    }

    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    if (url.pathname === '/api/internal/llm' && request.method === 'POST') {
      const provided = request.headers.get('x-runner-secret') ?? '';
      if (!env.RUNNER_SECRET || !safeEqual(provided, env.RUNNER_SECRET)) {
        return unauthorized('Bad runner secret');
      }
      return handleInternalLlm(env, request);
    }

    if (url.pathname === '/api/auth' && request.method === 'POST') {
      return handleAuth(env, request);
    }

    if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
      return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() });
    }

    if (url.pathname === '/api/session' && request.method === 'GET') {
      const token = readCookie(request, COOKIE_NAME);
      const ok = await verifySession(env.STUDIO_SESSION_SECRET, token);
      return ok ? json({ ok: true }) : unauthorized();
    }

    const token = readCookie(request, COOKIE_NAME);
    const ok = await verifySession(env.STUDIO_SESSION_SECRET, token);
    if (!ok) return unauthorized();

    try {
      return await handleApi(env, request, url);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error';
      return serverError(message);
    }
  },
};
