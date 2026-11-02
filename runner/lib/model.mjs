/**
 * Runner-side model call. Goes through the Worker's runner-only gateway so the
 * provider keys never leave Cloudflare.
 */
export async function callModel({
  system,
  user,
  maxTokens = 2000,
  prefer = process.env.HARNESS_PREFER || 'deepseek',
}) {
  const base = process.env.STUDIO_BASE_URL;
  const secret = process.env.RUNNER_SECRET;
  if (!base || !secret) throw new Error('STUDIO_BASE_URL and RUNNER_SECRET are required');

  const response = await fetch(`${base}/api/internal/llm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-runner-secret': secret },
    body: JSON.stringify({ system, user, maxTokens, prefer }),
    signal: AbortSignal.timeout(180_000),
  });

  if (!response.ok) {
    throw new Error(`Model gateway ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }

  const payload = await response.json();
  return {
    data: payload.data ?? {},
    provider: payload.provider ?? 'unknown',
    usage: payload.usage ?? { tokens_in: 0, tokens_out: 0, cost_usd: 0 },
  };
}
