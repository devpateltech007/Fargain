import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { MissingConfigError } from '../config.js';
import { LlmError } from '../llm/provider.js';
import { PayPalError } from '../payments/paypal-client.js';
import { Channel3Error } from '../pricing/channel3.js';

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const notFound = (what: string) => new ApiError(404, 'not_found', `${what} not found`);

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      return reply
        .status(err.statusCode)
        .send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: 'invalid_request',
          message: 'request validation failed',
          details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
    }
    if (err instanceof MissingConfigError) {
      req.log.warn({ feature: err.feature, missing: err.missing }, 'feature not configured');
      return reply.status(503).send({ error: { code: 'not_configured', message: err.message } });
    }
    if (err instanceof LlmError) {
      req.log.error({ code: err.code, status: err.status, msg: err.message }, 'llm error');
      return reply.status(502).send({ error: { code: err.code, message: err.message } });
    }
    if (err instanceof Channel3Error) {
      req.log.error({ status: err.status }, 'channel3 error');
      return reply.status(502).send({ error: { code: 'channel3_error', message: err.message } });
    }
    if (err instanceof PayPalError) {
      req.log.error(
        { status: err.status, name: err.paypalName, issue: err.issue, debugId: err.debugId },
        'paypal error',
      );
      return reply.status(502).send({
        error: {
          code: 'paypal_error',
          message: err.message,
          details: { issue: err.issue, debug_id: err.debugId },
        },
      });
    }
    const { statusCode: status, message } = err as { statusCode?: number; message?: string };
    if (status && status >= 400 && status < 500) {
      // Fastify's own client errors (bad JSON, body too large, unsupported media type).
      return reply
        .status(status)
        .send({ error: { code: 'bad_request', message: message ?? 'bad request' } });
    }
    req.log.error({ err }, 'unhandled error');
    return reply
      .status(500)
      .send({ error: { code: 'internal_error', message: 'internal server error' } });
  });
}
