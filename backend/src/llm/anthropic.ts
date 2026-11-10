import { LlmError, type LlmContentPart, type LlmProvider, type LlmRequest } from './provider.js';

/**
 * Anthropic Messages API via fetch (no SDK dependency). Verified against
 * platform.claude.com docs (Nov 2026):
 *  - JSON output is requested with `output_config.format = { type: 'json_schema', schema }` and
 *    returned in a `text` content block.
 *  - Forced tool use (`tool_choice: any|tool`) returns 400 on Opus 5.5 / Sonnet 5.5, so we do
 *    not use tools for structured output.
 *  - API version 2026-10-21 rejects `temperature`/`top_p`/`top_k`, so none are sent.
 *  - Prefilled assistant turns are incompatible with JSON outputs.
 */
export const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2026-10-21';

export function createAnthropicProvider(opts: {
  apiKey: string;
  textModel: string;
  visionModel: string;
  fetchImpl?: typeof fetch;
}): LlmProvider {
  const doFetch = opts.fetchImpl ?? fetch;

  const part = (p: LlmContentPart) => {
    switch (p.type) {
      case 'text':
        return { type: 'text', text: p.text };
      case 'image_url':
        return { type: 'image', source: { type: 'url', url: p.url } };
      case 'image_base64':
        return { type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.data } };
    }
  };

  return {
    name: 'anthropic',
    async complete(req: LlmRequest) {
      const model = req.purpose === 'vision' ? opts.visionModel : opts.textModel;
      const res = await doFetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': opts.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model,
          // Adaptive thinking is always on for current models and shares this budget.
          max_tokens: req.maxTokens ?? 8000,
          system: req.system,
          messages: req.messages.map((m) => ({
            role: m.role,
            content: typeof m.content === 'string' ? m.content : m.content.map(part),
          })),
          output_config: { format: { type: 'json_schema', schema: req.jsonSchema } },
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        content?: { type: string; text?: string }[];
        stop_reason?: string;
        model?: string;
        error?: { type?: string; message?: string };
      };
      if (!res.ok) {
        // Error messages from the API never contain the key; still, keep them short.
        throw new LlmError(
          'llm_http_error',
          `Anthropic API HTTP ${res.status}: ${body.error?.type ?? ''} ${String(body.error?.message ?? '').slice(0, 300)}`.trim(),
          res.status,
        );
      }
      const text = (body.content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('');
      return { text, stopReason: body.stop_reason ?? 'unknown', model: body.model ?? model };
    },
  };
}
