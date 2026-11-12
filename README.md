# Product Verification Platform

Multi-tenant REST API foundation for product authentication, company access control, and anti-counterfeit verification. It uses Express, PostgreSQL/Prisma, Redis-backed sessions, Argon2id, and Zod.

Verification labels use random 12-digit numeric codes for easier entry. Only a keyed HMAC of each code is stored. Existing 20-character hexadecimal codes remain accepted for a transition period. Public-facing records also include readable references such as `PI123456789012` for products and `US123456789012` for users; internal CUID primary keys remain unchanged for database relations.
Company, product, batch, and item endpoints accept these display references in URL parameters as well as legacy internal IDs. API responses include `displayId`; use it for labels and user-facing screens.

## Requirements and local setup

- Node.js 20.19 or newer (or 22.12 or newer)
- PostgreSQL 15 or newer
- Redis 6.2 or newer

Copy `.env.example` to `.env`, replace all placeholder secrets with separate random values of at least 32 characters, and configure PostgreSQL and Redis. Do not use the example secret values outside tests.

```powershell
Copy-Item .env.example .env
npm.cmd install
npm.cmd run prisma:generate
npm.cmd run db:migrate:dev
npm.cmd run dev
```

`DATABASE_URL`, `REDIS_URL`, `SESSION_HMAC_SECRET`, and `VERIFICATION_HMAC_SECRET` are required. Set `COOKIE_SECURE=true` behind HTTPS in production. `CORS_ORIGINS` is a comma-separated exact-origin allowlist. `TRUST_PROXY_HOPS` defaults to zero; set it to the exact trusted proxy hop count when deployment uses a reverse proxy, rather than trusting forwarded headers from arbitrary clients. Configure SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`) for account and invitation email. Production startup requires SMTP, a base64-encoded 32-byte `PRINT_EXPORT_ENCRYPTION_KEY`, and a 32-character `PAYMENT_WEBHOOK_SECRET`.

Generate distinct secrets rather than reusing the examples:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

The development seed is intentionally guarded. Set `NODE_ENV=development`, unique email/password pairs for `SEED_SUPER_ADMIN`, `SEED_COMPANY_ADMIN`, `SEED_PRODUCT_MANAGER`, and `SEED_EDITOR`, plus `SEED_SAMPLE_VERIFICATION_CODE`, before `npm.cmd run db:seed`. Those credentials create local-only bootstrap/sample data; there are no shipped production accounts. It provisions a development free plan and trial subscription for the sample company.

## Architecture

- `src/app.js` configures Helmet, CORS, bounded JSON parsing, routes, and centralized errors.
- `src/modules/` is split by feature. Each module has a `routes.js` file for URL/middleware wiring, a `controller.js` file for validating requests with Joi and translating HTTP requests/responses, a `validation.js` file for Joi schemas, and a `service.js` file for business rules and database operations.
- `src/middleware/` performs Redis+PostgreSQL session checks, CSRF checks, current membership checks, and centralized permission enforcement.
- `prisma/schema.prisma` defines durable users, sessions, expiring verification/reset tokens, tenant entities, verification/security events, audit history, subscriptions, plans, payments, invitations, encrypted print export jobs, and idempotency keys.

Module layout:

```text
src/modules/<module>/
  routes.js       # endpoints and middleware only
  controller.js   # HTTP request/response handling
  service.js      # business logic and persistence
```

## Session and authorization model

Login issues an opaque random cookie token. Only its keyed HMAC is persisted in PostgreSQL and used to key a shared Redis session entry. Protected requests fail closed if Redis or PostgreSQL cannot validate the session and recheck the durable session and active user on every request. Revoking a session updates the database and removes Redis keys. Membership and company status are read from PostgreSQL on each tenant request, so membership suspension takes effect immediately even if a login session remains active.

The cookie is HttpOnly, SameSite=Strict, Secure in production, and never exposed in URLs or browser storage. Login returns a CSRF token; include it in `X-CSRF-Token` for authenticated state-changing requests. Logout and logout-all require that header too.

Company access remains independent from platform access:

| Role | Main permissions |
|---|---|
| `ADMIN` | Company/member administration, products, batches, item generation/revocation, code export permission, policy, billing, reports |
| `PRODUCT_MANAGER` | Products, batches, item generation, reports; no membership, billing, exports, or revocation |
| `EDITOR` | Read company/products/batches/items, update products/batches; no generation, revocation, membership, billing, or exports |
| `SUPER_ADMIN` | Full platform access; only a Super Admin can assign this or the Platform Admin role |

Users have separate required `firstName` and `lastName` fields plus an optional `middleName`. Platform roles are stored in a separate `PlatformMember` record, not on `User`. `PLATFORM_ADMIN` can manage platform operations and create support/viewer accounts; `PLATFORM_SUPPORT` can read companies and audit logs; `PLATFORM_VIEWER` has read-only access to platform listings. Company and platform memberships are independent. Public `/auth/register` is disabled: a company admin creates a company member, and an authorized platform member creates a platform member. `/auth/register-company` is platform-authorized and creates a company together with its first company admin.

Tenant routes resolve resources through the Company → Product → Batch → Item relations and return 404 for unowned IDs. The API never trusts request-body tenant IDs or roles.

## Implemented routes

- `POST /api/v1/auth/register-company`, `/login`, `/logout`, `/logout-all`, `/verify-email`, `/resend-verification`, `/forgot-password`, `/reset-password`; `GET /api/v1/auth/me`
- `GET/PATCH /api/v1/companies/:companyId`
- `GET/POST /api/v1/companies/:companyId/members`; `PATCH /api/v1/companies/:companyId/members/:memberId`
- `POST /api/v1/companies/:companyId/members/:memberId/suspend|reactivate`
- `GET/POST /api/v1/companies/:companyId/invitations`; `POST /api/v1/invitations/accept`
- `GET/PATCH /api/v1/companies/:companyId/verification-policy`
- `GET/PATCH /api/v1/companies/:companyId/products/:productId/verification-policy`
- `GET/POST /api/v1/companies/:companyId/billing` and `/billing/cancel`
- Product list/create/read/update at `/api/v1/companies/:companyId/products`
- Batch list/create/update/read at `/api/v1/companies/:companyId/products/:productId/batches` and `/api/v1/companies/:companyId/batches/:batchId`
- `POST /api/v1/companies/:companyId/batches/:batchId/items/generate` (1–100, required Idempotency-Key; returns a print export job, not the concealed codes)
- `GET /api/v1/companies/:companyId/print-exports`; `POST /api/v1/companies/:companyId/print-exports/:exportJobId/download` (Admin-only, audited, encrypted-at-rest, one-time download, 24-hour expiry)
- `GET /api/v1/companies/:companyId/batches/:batchId/items`; `POST /api/v1/companies/:companyId/items/:itemId/revoke|recall`
- `POST /api/v1/companies/:companyId/products/:productId/archive`
- `GET/POST /api/v1/verify/:publicToken`
- `POST /api/v1/webhooks/payments/provider` for signed, idempotent payment lifecycle events
- Platform member listing/creation, company listing/status, audit listing, plan management, and subscription assignment at `/api/v1/platform-admin`; route permissions are enforced by platform role
- `GET /health`

Public verification page opens and code submissions are tracked separately. A correct code increments use count atomically. The threshold allows the first N successful uses; in `WARN` mode later successes are marked and shown as warnings, while `BLOCK` mode blocks attempts beyond N. Invalid codes do not consume allowance, raw codes are not written to logs or events, and inactive/revoked/recalled/expired records are not positively verified.

## Database, migrations, and tests

Use `npm run db:migrate:dev` for local development migrations and `npm run db:migrate` for deployment migrations. `npm run prisma:generate` generates the client. Schema and migration deployment both require a reachable PostgreSQL instance.

```powershell
npm.cmd test
npm.cmd run test:integration:live
npm.cmd run lint
npm.cmd run format
```

The default test run includes unit tests and HTTP integration tests with mocked PostgreSQL/Redis boundaries. Live PostgreSQL/Redis tests are in `tests/integration/live.test.js` and intentionally skip unless all of these are set: `RUN_LIVE_INTEGRATION=true`, `LIVE_DATABASE_URL` (a disposable database with migrations deployed), and `LIVE_REDIS_URL`. The live suite covers Redis atomic rate counters, concurrent item-quota enforcement, concurrent member-seat reservation, and simultaneous `BLOCK` verification. Do not point it at production data. Tests skipped for absent services are not passing live-service tests.

Email verification activates a pending account only after a hashed, expiring, single-use token is posted to `/api/v1/auth/verify-email`. Email links place the capability in the URL fragment so browsers do not send it in HTTP requests or referrers; the frontend should read the fragment and POST the token. Password reset responses are enumeration-resistant, reset tokens are hashed/expiring/single-use, and resetting a password revokes all durable sessions.

Invitations reserve a company seat, expire after seven days, and can be accepted only by a signed-in, email-verified user whose email matches the invitation. Company and product verification policy edits affect newly generated items; existing items retain their policy snapshot.

Concealed codes are encrypted with AES-256-GCM under `PRINT_EXPORT_ENCRYPTION_KEY` in the restricted export-job table, then cleared after one authorized Admin download or expiry. The export response uses `Cache-Control: no-store`; do not proxy/cache it or persist it outside the approved print workflow. Keep the key stable until all outstanding jobs expire. Expired payloads are scrubbed hourly. The endpoint delivers JSON to an authorized browser/client; no print-provider integration is configured.

The generic payment webhook requires `X-Payment-Signature: t=<unix-seconds>,v1=<hex-hmac-sha256>` over `<t>.<raw-request-body>`. It rejects signatures older than five minutes, validates event IDs and payment amount/currency against the subscription's plan, and records each provider event idempotently. Accepted event types are `payment.succeeded`, `payment.failed`, and `payment.refunded`. A real processor must translate and sign this contract in a provider-specific adapter; checkout/charge creation and a particular provider are not configured here.

Item generation requires an active, unexpired subscription and is serialized with quota checks. Invitations and membership reactivation enforce the plan's seat limit with serializable transactions/retries. Downgrades/cancellation preserve existing products, items, and history while denying operations that exceed an active plan.

## Security and deployment notes

- Terminate HTTPS at a trusted proxy and set the secure cookie flag. Configure `TRUST_PROXY_HOPS` for the actual proxy topology; proxy forwarding is disabled by default.
- Use distinct secrets from a secret manager, rotate them deliberately, and back up PostgreSQL with point-in-time recovery. Redis data is rebuildable; PostgreSQL is the authorization and audit source of truth.
- Use TLS/authentication for PostgreSQL and Redis in production, restrict network access, monitor rate-limit and authentication errors, and configure retention for IP/device data under applicable privacy law.
- Email delivery is real SMTP when configured; without SMTP, account and invite email cannot be delivered. Payment handling implements a signed provider-neutral webhook contract, not a live payment processor.
- Live database/Redis and concurrency tests require explicit disposable service URLs; the default test run uses mocks.
- Sessions use shared Redis but durable authorization reads from PostgreSQL on every protected request. This favors immediate revocation over maximum read throughput.

## Remaining external integrations

No specific payment processor, checkout flow, print vendor, or production SMTP account is configured. A frontend must implement the verification/reset/invitation pages and submit the emailed tokens; deployment must provide SMTP and print-encryption/webhook secrets. Geolocation and email-delivery queue/retry infrastructure are also not included.
