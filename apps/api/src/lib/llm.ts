import type { Env } from '../env';

export interface LlmResult {
  data: unknown;
  provider: 'groq' | 'gemini' | 'deepseek';
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

interface CallOptions {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}

function parseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.search(/[[{]/);
    const end = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'));
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error('Model did not return JSON');
  }
}

async function callGemini(env: Env, opts: CallOptions): Promise<LlmResult> {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
  const model = env.GEMINI_MODEL || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: opts.system }] },
      contents: [{ role: 'user', parts: [{ text: opts.user }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: opts.temperature ?? 0.2,
        maxOutputTokens: opts.maxTokens ?? 1600,
      },
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    throw new Error(`Gemini ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }

  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };

  const text = (payload.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? '')
    .join('');

  if (!text) throw new Error('Gemini returned no text');

  return {
    data: parseJson(text),
    provider: 'gemini',
    model,
    tokensIn: payload.usageMetadata?.promptTokenCount ?? 0,
    tokensOut: payload.usageMetadata?.candidatesTokenCount ?? 0,
    costUsd: 0,
  };
}

async function callGroq(env: Env, opts: CallOptions): Promise<LlmResult> {
  if (!env.GROQ_API_KEY) throw new Error('GROQ_API_KEY not set');
  const model = env.GROQ_MODEL || 'llama-3.3-70b-versatile';

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
      response_format: { type: 'json_object' },
      temperature: opts.temperature ?? 0.2,
      max_tokens: opts.maxTokens ?? 1600,
      ...(model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}),
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    throw new Error(`Groq ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const text = payload.choices?.[0]?.message?.content ?? '';
  if (!text) throw new Error('Groq returned no text');

  return {
    data: parseJson(text),
    provider: 'groq',
    model,
    tokensIn: payload.usage?.prompt_tokens ?? 0,
    tokensOut: payload.usage?.completion_tokens ?? 0,
    costUsd: 0,
  };
}

async function callDeepseek(env: Env, opts: CallOptions): Promise<LlmResult> {
  if (!env.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY not set');
  const model = env.DEEPSEEK_MODEL || 'deepseek-chat';

  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
      response_format: { type: 'json_object' },
      temperature: opts.temperature ?? 0.2,
      max_tokens: opts.maxTokens ?? 1600,
    }),
    signal: AbortSignal.timeout(90_000),
  });

  if (!response.ok) {
    throw new Error(`DeepSeek ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const text = payload.choices?.[0]?.message?.content ?? '';
  if (!text) throw new Error('DeepSeek returned no text');

  const tokensIn = payload.usage?.prompt_tokens ?? 0;
  const tokensOut = payload.usage?.completion_tokens ?? 0;

  return {
    data: parseJson(text),
    provider: 'deepseek',
    model,
    tokensIn,
    tokensOut,
    costUsd: (tokensIn * 0.27 + tokensOut * 1.1) / 1_000_000,
  };
}

export async function listGroqModels(env: Env): Promise<string[]> {
  if (!env.GROQ_API_KEY) return [];
  const response = await fetch('https://api.groq.com/openai/v1/models', {
    headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Groq models ${response.status}`);
  const payload = (await response.json()) as { data?: Array<{ id?: string }> };
  return (payload.data ?? []).map((model) => model.id ?? '').filter(Boolean).sort();
}

export interface ProviderDiagnostic {
  provider: 'groq' | 'deepseek' | 'gemini';
  configured: boolean;
  ok: boolean;
  model?: string;
  error?: string;
}

/**
 * Probe each provider independently so operations can see exactly why the
 * chain fell back. Session-gated; never exposed publicly.
 */
export async function diagnoseProviders(env: Env): Promise<ProviderDiagnostic[]> {
  const opts: CallOptions = {
    system: 'Return JSON only.',
    user: 'Return {"ok":true}',
    maxTokens: 200,
    temperature: 0,
  };

  const providers = [
    { name: 'groq' as const, configured: Boolean(env.GROQ_API_KEY), call: callGroq },
    { name: 'deepseek' as const, configured: Boolean(env.DEEPSEEK_API_KEY), call: callDeepseek },
    { name: 'gemini' as const, configured: Boolean(env.GEMINI_API_KEY), call: callGemini },
  ];

  const results: ProviderDiagnostic[] = [];

  for (const provider of providers) {
    if (!provider.configured) {
      results.push({ provider: provider.name, configured: false, ok: false, error: 'No key set' });
      continue;
    }
    try {
      const result = await provider.call(env, opts);
      results.push({ provider: provider.name, configured: true, ok: true, model: result.model });
    } catch (error) {
      results.push({
        provider: provider.name,
        configured: true,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

/**
 * Free-first provider chain: Groq free tier, then DeepSeek, then Gemini.
 * Every call is JSON-mode, so callers get a parsed object or a thrown error.
 * Providers without a key are skipped, so the chain degrades cleanly.
 */
export async function callJson(env: Env, opts: CallOptions): Promise<LlmResult> {
  const errors: string[] = [];

  if (env.GROQ_API_KEY) {
    try {
      return await callGroq(env, opts);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (env.DEEPSEEK_API_KEY) {
    try {
      return await callDeepseek(env, opts);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (env.GEMINI_API_KEY) {
    try {
      return await callGemini(env, opts);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(`No LLM provider succeeded. ${errors.join(' | ')}`);
}
