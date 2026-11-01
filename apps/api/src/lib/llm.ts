import type { Env } from '../env';

export interface LlmResult {
  data: unknown;
  provider: 'gemini' | 'deepseek';
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

/**
 * Free-first provider chain: Gemini Flash free tier, then DeepSeek.
 * Both calls are JSON-mode, so callers get a parsed object or a thrown error.
 */
export async function callJson(env: Env, opts: CallOptions): Promise<LlmResult> {
  const errors: string[] = [];

  if (env.GEMINI_API_KEY) {
    try {
      return await callGemini(env, opts);
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

  throw new Error(`No LLM provider succeeded. ${errors.join(' | ')}`);
}
