export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

export function badRequest(message: string): Response {
  return json({ error: message }, 400);
}

export function unauthorized(message = 'Not signed in'): Response {
  return json({ error: message }, 401);
}

export function serverError(message = 'Something went wrong'): Response {
  return json({ error: message }, 500);
}

export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
