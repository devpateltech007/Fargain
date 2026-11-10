# Fargain: rules for AI agents and contributors

Fargain is an AI deal-hunting and negotiation agent for buyers, built for the "Build What's Next
with PayPal and AI" hackathon. Pitch: "Your agent haggles, PayPal settles."

Demo features:

1. **Instagram (Reel Mode):** a user DMs a reel/post to the Fargain account; the system identifies
   the product and adds it to the user's wishlist.
2. **Amazon:** the Chrome extension side panel shows Channel3 cross-retailer price comparison,
   discounts from the user's profile, and wishlist price-drop alerts.
3. **Facebook Marketplace:** the agent drafts negotiation messages, the user approves each one, and
   once a price is agreed the backend creates a PayPal sandbox payment capped at the item's max price.

## Hard rules (do not relax these)

- **Human in the loop.** The agent never sends a message or a payment by itself. The extension only
  inserts drafted text into the page's compose box; the user clicks send. Adapters must never click
  send buttons, submit forms, or synthesize Enter key presses.
- **Max price is enforced server-side.** Any payment request above the item's `max_price` is
  rejected and written to `audit_log`. Never rely on the prompt alone. Compare in integer cents.
- **The negotiation agent never reveals the user's max price** (not in drafts, reasoning shown to
  the seller, or anywhere on the seller side) and must flag off-platform payment requests and
  suspicious sellers via `risk_flags`.
- **PayPal sandbox only.** `PAYPAL_API_BASE` is hard-coded to `https://api-m.sandbox.paypal.com`;
  `PAYPAL_ENV` only accepts `sandbox`. No live switch.
- **No secrets in the repo.** Secrets live in `.env` (gitignored) or Render env vars. Keep
  `.env.example` current. Never print or log secret values (see `SECRET_KEYS` in
  `backend/src/config.ts`; Fastify redacts auth/signature headers).
- **Instagram content:** do not download or scrape video. Use only the shared link, caption, and
  thumbnail that the webhook or oEmbed legitimately provides, plus a user-supplied screenshot as a
  fallback.
- **No retailer logins, no email scanning.** Profile fields (student status, birthday, memberships)
  are entered manually by the user.
- **All site-specific DOM logic lives behind `SiteAdapter`** (`extension/src/adapters/types.ts`).
  One selectors file per adapter.

## External APIs: verify, don't invent

Verify every external API (PayPal Orders/Invoicing v2, Instagram messaging webhooks, Channel3,
Anthropic) against current official docs before coding against it. If behavior differs from what
the plan assumed, stop, show the evidence, and propose a fix. Do not silently replace a real call
with a mock.

Verified so far:

- Channel3: `POST https://api.trychannel3.com/v1/search`, header `x-api-key`, body accepts
  `query` / `image_url` / `base64_image` / `page_token`, `limit` (default 20, max 30); response
  `{ products[], next_page_token }`, each product has `offers[]` with `domain`, `price.amount`,
  `price.currency`, `availability`, `url`. `GET /v1/products/{id}` is free (use for price watch).
- Anthropic: model IDs are not hard-coded; `npm run check-env:live` lists them via `GET /v1/models`.
  Current API version header is `anthropic-version: 2026-10-21`, which REJECTS `temperature`,
  `top_p` and `top_k` (400). Structured JSON uses `output_config.format = {type:"json_schema",
schema}` and arrives in a `text` block. Forced tool use (`tool_choice` any/tool) returns 400 on
  Opus 5.5 / Sonnet 5.5, so we do not use tools for structured output. The schema subset rejects
  `minimum/maximum/minLength/maxLength/multipleOf`, `minItems > 1`, and requires
  `additionalProperties: false`; `toStructuredOutputSchema()` in `shared/src/llm.ts` converts
  zod JSON Schemas (zod still validates the full constraints). Assistant prefill is incompatible
  with JSON outputs, so the one retry is a new user turn. Fields asking for step-by-step reasoning
  can trigger a refusal, so `reasoning` is described as a short explanation.
- PayPal Orders v2 (sandbox, verified live with `npm run probe:paypal` and `npm run e2e:paypal`):
  creating an order with `payment_source.paypal.experience_context` returns status
  `PAYER_ACTION_REQUIRED` and a `payer-action` link (not `approve`); repeating a
  `PayPal-Request-Id` returns the same order; capture before approval is 422 `ORDER_NOT_APPROVED`;
  after buyer approval the order is `APPROVED` and capture returns `COMPLETED`. PayPal appends
  `?token=<orderId>&PayerID=...` to the return URL. Webhooks are delivered only to public HTTPS
  URLs, so local dev uses polling + the return URL; webhooks are verified via
  `POST /v1/notifications/verify-webhook-signature`.
- Meta: the provided `IG_ACCESS_TOKEN` is a Facebook Graph system-user token (graph.facebook.com),
  not an Instagram Login token, and currently sees 0 Pages. Phase 5 therefore uses the
  Facebook-Login (Page-linked) Instagram messaging flavor. `npm run probe:meta` re-checks this.

## Negotiation guardrails (backend/src/negotiations)

- `prompts.ts` builders never receive `max_price`; a test asserts no rendering of it reaches the LLM.
- `guardrails.ts` checks every draft AND every user-approved message (`POST .../buyer-message`)
  for amounts above max (in cents), budget-disclosure phrasing, and proposing off-platform
  payment. Over-limit drafts get one retry with non-revealing feedback, then are returned as
  `blocked` with `needs_user_input`; the side panel cannot insert blocked drafts.
- Seller messages are scanned deterministically for off-platform payment, scams, and budget
  probes; LLM flags are merged in, never substituted.
- Agreement detection is a suggestion only; the user must confirm the price (`confirm-price`).

## Facebook Marketplace adapter (extension/src/adapters/marketplace)

- Best-effort and UNVERIFIED against a live page (Facebook requires login). All hooks are in
  `selectors.ts`: URL patterns, ARIA roles/labels, `contenteditable[role=textbox]`. Fixtures are
  synthetic. The side panel "Page check" shows which selectors matched (no page text).
- Item page and chat thread both map to the canonical URL
  `https://www.facebook.com/marketplace/item/<id>/`, so they share one negotiation.
- The content script matches all of facebook.com (SPA navigation) but stays inert outside
  `/marketplace/item/*` and `/messages/t/*`; DOM observation only runs on those pages.
- Only fills the message box. Automating Facebook may violate its terms; the user always sends.

## Stack and layout

- `shared/`: zod schemas (domain enums, LLM contracts) + JSON Schemas for structured LLM output.
  Built to `shared/dist` on `npm install` (postinstall). Tests alias it to source.
- `backend/`: Node 20+, TypeScript, Fastify 5, better-sqlite3 (migrations in
  `backend/src/db/migrations.ts`, append-only). Serves the dashboard and mock-seller page.
- `dashboard/`: React + Vite.
- `extension/`: Chrome MV3, React side panel, Vite (two builds: panel+worker, content IIFE).
- `mock-seller/`: static page simulating a Marketplace chat (for repeatable demos).
- `scripts/`: env checks, seed, demo helpers (run with `tsx`).

LLM: Anthropic behind a provider-agnostic interface; structured JSON validated with zod; retry once
on invalid output, then fail closed.

## Node version and dependency pins

Node 20 reached end-of-life on 2026-04-30, and current majors of several tools now require
Node >= 20.19 or >= 22 (Vite 8, Vitest 5, ESLint 10, better-sqlite3 13). To keep working on the
local Node 20.18.0 the repo pins: TypeScript ~5.9, Vite 6, Vitest 3, ESLint 9, better-sqlite3 12.
On Node 20.18, `fastify.inject()` fails (its dependency `light-my-request` loads ESM-only `cookie`
via require), so backend tests use a real loopback socket (`backend/src/test-utils.ts`).

## Conventions

- TypeScript strict everywhere. ESM. Prettier (single quotes, width 100). ESLint flat config.
- Validate all input at trust boundaries with zod (HTTP bodies, webhooks, LLM output).
- Every agent suggestion, user approval, and payment attempt writes an `audit_log` row.
- Keep dependencies minimal and boring.
- Tests (Vitest) are required for payment enforcement, guardrails, schema validation, and link
  parsing. Smoke-test the rest.

## Commands

```
npm install              # also builds shared/
npm run check-env        # which env vars are set (never prints values)
npm run check-env:live   # + one harmless call per provider
npm run dev:backend      # http://localhost:3000
npm run dev:dashboard    # http://localhost:5173 (proxies /api)
npm run build            # shared, backend, dashboard, extension
npm test                 # vitest run
npm run lint && npm run typecheck
```
