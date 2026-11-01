const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}

function headers(extra = {}) {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function rest(path, init = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...init,
    headers: headers({ Prefer: 'return=representation', ...(init.headers ?? {}) }),
  });

  if (!response.ok) {
    throw new Error(`Supabase ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }

  if (response.status === 204) return undefined;
  const text = await response.text();
  return text ? JSON.parse(text) : undefined;
}

export async function getJob(id) {
  const rows = await rest(`/st_jobs?id=eq.${id}&select=*&limit=1`);
  return rows?.[0];
}

export async function updateJob(id, patch) {
  return rest(`/st_jobs?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
}

export async function addEvent(id, message, stage = null, level = 'info') {
  await rest('/st_events', {
    method: 'POST',
    body: JSON.stringify({ job_id: id, message, stage, level }),
  });
}

export async function ensureBucket() {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ id: 'studio', name: 'studio', public: false }),
  });

  if (response.ok) return;

  const body = await response.text();
  const benign = response.status === 409 || /already|exists/i.test(body);
  if (!benign) throw new Error(`Bucket error ${response.status}: ${body.slice(0, 200)}`);
}

export async function uploadObject(path, bytes, contentType) {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/studio/${path}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': contentType,
      'x-upsert': 'true',
      'Cache-Control': 'max-age=3600',
    },
    body: bytes,
  });

  if (!response.ok) {
    throw new Error(`Upload ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
}
