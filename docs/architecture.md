# Fargain architecture

## System overview

```mermaid
flowchart LR
  Buyer[Buyer]
  Dashboard[React dashboard]
  Extension[Chrome side panel]
  Seller[Marketplace page or mock seller]
  Meta[Instagram webhook and DMs]
  API[Fastify API]
  SQLite[(SQLite database)]
  LLM[Anthropic]
  C3[Channel3]
  PayPal[PayPal sandbox]

  Buyer --> Dashboard
  Buyer --> Extension
  Extension -->|read listing and fill draft only| Seller
  Dashboard -->|Bearer token| API
  Extension -->|Bearer token| API
  Meta -->|signature checked webhook| API
  API --> SQLite
  API -->|product search and price watch| C3
  API -->|structured identification and negotiation| LLM
  API -->|create and refresh sandbox orders| PayPal
  API -->|dashboard and API responses| Dashboard
```

## Trust boundaries

1. **Browser clients are untrusted.** Request bodies and query parameters are validated with shared or route-local Zod schemas. API authentication is bearer-token based. Price limits are loaded from SQLite and enforced on the server.
2. **Seller text and product content are untrusted.** The negotiation agent treats seller messages and product captions as data. Deterministic guardrails check drafts, buyer-approved messages, off-platform payment requests, budget probes, and scam language.
3. **LLM output is untrusted.** Structured output is parsed and validated. The agent does not receive `max_price`; its responses are checked again by server guardrails.
4. **Provider callbacks are untrusted.** Meta webhook requests are signature checked from raw bytes. PayPal webhooks are verified with PayPal before their events are acted on.
5. **Money leaves only through PayPal sandbox.** A user confirms the agreed price, the backend enforces the max, and PayPal still requires buyer approval before capture. No live endpoint is configured.

## Negotiation and payment sequence

```mermaid
sequenceDiagram
  actor Buyer
  participant Extension
  participant API as Fastify API
  participant LLM as Anthropic
  participant DB as SQLite
  participant PayPal as PayPal sandbox
  participant Seller

  Buyer->>Extension: Open listing
  Extension->>Seller: Read supported listing fields
  Buyer->>Extension: Request a draft
  Extension->>API: Listing and negotiation context
  API->>DB: Load item and max price
  API->>LLM: Negotiation context without max price
  LLM-->>API: Structured draft
  API->>API: Apply deterministic guardrails
  API-->>Extension: Draft, risk flags, short reasoning
  Extension-->>Buyer: Show draft for review
  Buyer->>Seller: Send message manually
  Buyer->>API: Confirm agreed price
  API->>DB: Compare cents to stored max and audit
  Buyer->>API: Request sandbox payment
  API->>PayPal: Create order after server checks
  PayPal-->>Buyer: Buyer approval link
  Buyer->>PayPal: Approve sandbox order
  API->>PayPal: Capture after approval
  PayPal-->>API: Completed status
  API->>DB: Save payment state and audit
```

## Data ownership

SQLite is the source of truth for wishlist items, user profile, price snapshots, alerts, negotiations, messages, payment state, Reel sessions, processed webhook message IDs, and audit events. Each dashboard query is scoped to the single default user. The Render blueprint mounts the database under `/var/data` so restarts do not erase the file.

The `shared/` package holds schemas and domain types used across the API and extension. Database migrations are append-only in `backend/src/db/migrations.ts`. Provider-specific transport code is isolated under `backend/src/pricing`, `backend/src/payments`, and `backend/src/reels`.

## Deployment shape

Render builds the shared package, backend, and dashboard. The Fastify process serves the dashboard build from `dashboard/dist` and serves the mock seller from `/mock-seller/`. Vite serves the dashboard on port 5173 during local development and proxies `/api` to the backend on port 3000. The extension is built separately because Chrome loads it as an unpacked extension or a packaged extension, not as part of the backend web app.
