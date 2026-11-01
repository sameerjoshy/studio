import type { Env } from '../env';

export interface Job {
  id: string;
  created_at: string;
  updated_at: string;
  capability: string;
  spec: Record<string, unknown>;
  status: 'queued' | 'dispatched' | 'running' | 'complete' | 'error' | 'killed';
  stage: string | null;
  progress: number;
  output_path: string | null;
  output_name: string | null;
  error: string | null;
  run_id: string | null;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  meta: Record<string, unknown> | null;
}

export interface JobEvent {
  id: number;
  job_id: string;
  created_at: string;
  level: 'info' | 'warn' | 'error';
  stage: string | null;
  message: string;
  data: Record<string, unknown> | null;
}

function serviceHeaders(env: Env): Record<string, string> {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
}

export async function sb<T = unknown>(
  env: Env,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    ...init,
    headers: {
      ...serviceHeaders(env),
      Prefer: 'return=representation',
      ...(init.headers as Record<string, string> | undefined),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase ${response.status}: ${body.slice(0, 300)}`);
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function insertJob(
  env: Env,
  capability: string,
  spec: Record<string, unknown>,
  meta: Record<string, unknown> = {},
): Promise<Job> {
  const rows = await sb<Job[]>(env, '/st_jobs', {
    method: 'POST',
    body: JSON.stringify({ capability, spec, status: 'queued', meta }),
  });
  if (!rows || !rows[0]) throw new Error('Job insert returned no row');
  return rows[0];
}

export async function updateJob(
  env: Env,
  id: string,
  patch: Partial<Job>,
): Promise<Job | undefined> {
  const rows = await sb<Job[]>(env, `/st_jobs?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
  return rows?.[0];
}

export async function getJob(env: Env, id: string): Promise<Job | undefined> {
  const rows = await sb<Job[]>(env, `/st_jobs?id=eq.${id}&select=*&limit=1`);
  return rows?.[0];
}

export async function listJobs(env: Env, limit = 30): Promise<Job[]> {
  return sb<Job[]>(env, `/st_jobs?select=*&order=created_at.desc&limit=${limit}`);
}

export async function listEvents(env: Env, id: string, limit = 200): Promise<JobEvent[]> {
  return sb<JobEvent[]>(
    env,
    `/st_events?job_id=eq.${id}&select=*&order=id.asc&limit=${limit}`,
  );
}

export async function addEvent(
  env: Env,
  id: string,
  message: string,
  stage?: string,
  level: 'info' | 'warn' | 'error' = 'info',
): Promise<void> {
  await sb(env, '/st_events', {
    method: 'POST',
    body: JSON.stringify({ job_id: id, message, stage: stage ?? null, level }),
  });
}

export async function ensureBucket(env: Env): Promise<void> {
  const response = await fetch(`${env.SUPABASE_URL}/storage/v1/bucket`, {
    method: 'POST',
    headers: serviceHeaders(env),
    body: JSON.stringify({ id: 'studio', name: 'studio', public: false }),
  });
  if (!response.ok && response.status !== 400 && response.status !== 409) {
    const body = await response.text();
    if (!body.toLowerCase().includes('already')) {
      throw new Error(`Bucket check failed ${response.status}: ${body.slice(0, 200)}`);
    }
  }
}

export async function signedUrl(env: Env, path: string, expiresIn = 60 * 60 * 24 * 7): Promise<string | null> {
  const response = await fetch(`${env.SUPABASE_URL}/storage/v1/object/sign/studio/${path}`, {
    method: 'POST',
    headers: serviceHeaders(env),
    body: JSON.stringify({ expiresIn }),
  });
  if (!response.ok) return null;
  const data = (await response.json()) as { signedURL?: string };
  if (!data.signedURL) return null;
  return `${env.SUPABASE_URL}/storage/v1${data.signedURL}`;
}
