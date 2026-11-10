import type { ZodType } from 'zod';

/** Provider-agnostic LLM interface. Only Anthropic is implemented; tests use a fake. */

export type LlmContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; url: string }
  | {
      type: 'image_base64';
      mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
      data: string;
    };

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string | LlmContentPart[];
}

export interface LlmRequest {
  /** 'vision' selects the vision-capable model. */
  purpose: 'text' | 'vision';
  system: string;
  messages: LlmMessage[];
  /** JSON Schema the provider must constrain output to (already in provider-compatible form). */
  jsonSchema: Record<string, unknown>;
  maxTokens?: number;
}

export interface LlmResponse {
  text: string;
  stopReason: string;
  model: string;
}

export interface LlmProvider {
  readonly name: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

export class LlmError extends Error {
  constructor(
    public readonly code: 'llm_invalid_output' | 'llm_refusal' | 'llm_http_error',
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

/**
 * Ask for JSON matching `schema`. Retries ONCE on unparseable JSON or schema mismatch (feeding
 * the validation error back), then fails closed with LlmError('llm_invalid_output').
 */
export async function generateStructured<T>(
  provider: LlmProvider,
  schema: ZodType<T>,
  req: LlmRequest,
): Promise<{ value: T; model: string; attempts: number }> {
  let messages = req.messages;
  let lastError = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await provider.complete({ ...req, messages });
    if (res.stopReason === 'refusal')
      throw new LlmError('llm_refusal', 'the model declined this request');
    let parsed: unknown;
    try {
      parsed = JSON.parse(res.text);
    } catch {
      lastError = `response was not valid JSON (stop_reason=${res.stopReason})`;
    }
    if (parsed !== undefined) {
      const result = schema.safeParse(parsed);
      if (result.success) return { value: result.data, model: res.model, attempts: attempt };
      lastError = result.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
    }
    // A trailing assistant message would be a prefill, which structured outputs reject,
    // so the correction is a new user turn.
    messages = [
      ...req.messages,
      { role: 'assistant', content: res.text || '(empty)' },
      {
        role: 'user',
        content: `Your previous output was invalid: ${lastError}. Return only corrected JSON that matches the schema.`,
      },
    ];
  }
  throw new LlmError('llm_invalid_output', `model output failed validation twice: ${lastError}`);
}
