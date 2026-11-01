const enc = new TextEncoder();
const dec = new TextDecoder();

export const COOKIE_NAME = 'studio_session';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

function b64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return b64url(new Uint8Array(signature));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function issueSession(secret: string): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify({ exp: Date.now() + TTL_MS })));
  const signature = await hmac(secret, payload);
  return `${payload}.${signature}`;
}

export async function verifySession(secret: string, value: string | undefined): Promise<boolean> {
  if (!value) return false;
  const [payload, signature] = value.split('.');
  if (!payload || !signature) return false;

  const expected = await hmac(secret, payload);
  if (!timingSafeEqual(expected, signature)) return false;

  try {
    const parsed = JSON.parse(dec.decode(fromB64url(payload))) as { exp?: number };
    return typeof parsed.exp === 'number' && parsed.exp > Date.now();
  } catch {
    return false;
  }
}

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('Cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}

export function sessionCookie(value: string, maxAgeSeconds = TTL_MS / 1000): string {
  return `${COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${Math.floor(maxAgeSeconds)}`;
}

export function clearCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(a, b);
}
