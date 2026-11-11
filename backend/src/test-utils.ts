import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { parseEnv, type Env } from './config.js';
import { openDatabase, type Db } from './db/index.js';
import type { LlmProvider, LlmRequest, LlmResponse } from './llm/provider.js';
import type { PayPalApi } from './payments/paypal-client.js';
import type { Channel3Api } from './pricing/channel3.js';
import type { Messenger } from './reels/messenger.js';

/**
 * Scripted fake LLM for tests. Each call pops the next response for the schema it is asked
 * for (matched by a key in the JSON Schema's properties) and records the full request.
 */
export function fakeLlm(script: {
  assess?: unknown[];
  draft?: unknown[];
  agree?: unknown[];
  identify?: unknown[];
  raw?: string[];
}) {
  const calls: LlmRequest[] = [];
  const queues = {
    assess: [...(script.assess ?? [])],
    draft: [...(script.draft ?? [])],
    agree: [...(script.agree ?? [])],
    identify: [...(script.identify ?? [])],
  };
  const provider: LlmProvider = {
    name: 'fake',
    async complete(req): Promise<LlmResponse> {
      calls.push(req);
      const props = Object.keys((req.jsonSchema.properties as Record<string, unknown>) ?? {});
      const kind = props.includes('draft_message')
        ? 'draft'
        : props.includes('fair_price_estimate')
          ? 'assess'
          : props.includes('candidates')
            ? 'identify'
            : 'agree';
      if (script.raw?.length)
        return { text: script.raw.shift()!, stopReason: 'end_turn', model: 'fake' };
      const next = queues[kind].shift();
      if (next === undefined) throw new Error(`fakeLlm: no scripted ${kind} response left`);
      return {
        text: typeof next === 'string' ? next : JSON.stringify(next),
        stopReason: 'end_turn',
        model: 'fake',
      };
    },
  };
  return { provider, calls, promptText: () => JSON.stringify(calls) };
}

export const TEST_TOKEN = 'test-token-0123456789';

/**
 * Starts a real app on an ephemeral loopback port and returns a fetch helper that sends the
 * API token. We use a real socket instead of `app.inject()` because inject's dependency
 * (light-my-request) needs require(esm), which Node < 20.19 does not support.
 */
export async function startTestApp(
  opts: {
    env?: Record<string, string>;
    paypal?: PayPalApi;
    llm?: LlmProvider;
    channel3?: Channel3Api;
    messenger?: Messenger;
  } = {},
): Promise<{
  app: FastifyInstance;
  db: Db;
  env: Env;
  request: (path: string, init?: RequestInit) => Promise<Response>;
  json: (
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ) => Promise<{ status: number; body: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any
  close: () => Promise<void>;
}> {
  const env = parseEnv({ LOG_LEVEL: 'silent', FARGAIN_API_TOKEN: TEST_TOKEN, ...opts.env });
  const db = openDatabase(':memory:');
  const app = await buildApp({
    env,
    db,
    paypal: opts.paypal,
    llm: opts.llm,
    channel3: opts.channel3,
    messenger: opts.messenger,
  });
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  const request = (path: string, init?: RequestInit) => fetch(`${address}${path}`, init);
  return {
    app,
    db,
    env,
    request,
    json: async (method, path, body, headers = {}) => {
      const res = await request(path, {
        method,
        headers: {
          Authorization: `Bearer ${TEST_TOKEN}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    },
    close: async () => {
      await app.close();
      db.close();
    },
  };
}
