# Product Verification Platform API

A multi-tenant REST API for company management, product and batch tracking, item-code generation, public verification, and subscription administration. The backend uses Express, PostgreSQL/Prisma, Redis-backed sessions, Argon2id password hashing, and Joi request validation.

This guide describes the implemented HTTP contract for frontend and integration developers. Examples use `http://localhost:3000`; replace the origin with the deployed API origin as needed.

## Table of contents

- [Quick start](#quick-start)
- [API conventions](#api-conventions)
- [Authentication and browser requests](#authentication-and-browser-requests)
- [Validation and errors](#validation-and-errors)
- [Endpoint reference](#endpoint-reference)
  - [Health](#health)
  - [Authentication](#authentication)
  - [Companies, members, and invitations](#companies-members-and-invitations)
  - [Verification policies](#verification-policies)
  - [Products, batches, items, and print exports](#products-batches-items-and-print-exports)
  - [Billing](#billing)
  - [Public verification](#public-verification)
  - [Platform administration](#platform-administration)
  - [Payment webhook](#payment-webhook)
- [Roles and permissions](#roles-and-permissions)
- [Frontend workflows](#frontend-workflows)
- [Database, migrations, and tests](#database-migrations-and-tests)
- [Security and deployment](#security-and-deployment)
- [External integrations and limitations](#external-integrations-and-limitations)

## Quick start

### Requirements

- Node.js 20.19 or newer (or 22.12 or newer)
- PostgreSQL 15 or newer
- Redis 6.2 or newer

Create `.env` from `.env.example`, set database and Redis URLs, and replace every example secret with a distinct randomly generated value of at least 32 characters.

```powershell
Copy-Item .env.example .env
npm.cmd install
npm.cmd run prisma:generate
npm.cmd run db:migrate:dev
npm.cmd run dev
```

The local API listens on port `3000` by default. Configure `PORT` to change it. `DATABASE_URL`, `REDIS_URL`, `SESSION_HMAC_SECRET`, and `VERIFICATION_HMAC_SECRET` are required.

Generate secret material with Node.js:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

The development seed is guarded. Set `NODE_ENV=development`, unique email/password pairs for `SEED_SUPER_ADMIN`, `SEED_COMPANY_ADMIN`, `SEED_PRODUCT_MANAGER`, and `SEED_EDITOR`, and `SEED_SAMPLE_VERIFICATION_CODE` before running `npm.cmd run db:seed`. Seed accounts and sample data are for local development only.

## API conventions

- API prefix: `/api/v1` (except `GET /health`).
- Request and response format: JSON with `Content-Type: application/json`, except the payment webhook, which accepts a raw JSON request body for signature verification.
- Authentication: an HTTP-only session cookie named `pv_session` by default. The API also returns a `csrfToken` after login; do not treat it as the session credential.
- Tenant IDs: company, product, batch, and item path parameters accept either the internal ID or the public display ID when the route resolves that entity. Display ID prefixes include `US`, `CO`, `PI`, `BA`, and `IT`. Plan IDs are internal IDs.
- Dates: send date strings in ISO 8601 format (for example `2026-10-21T00:00:00.000Z`).
- JSON objects reject unrecognized fields unless specified otherwise. For partial updates, send at least one supported field.
- Successful empty responses use HTTP `204 No Content`.

## Authentication and browser requests

1. Register a company using `POST /api/v1/auth/register-company`. The account is created pending verification and becomes the company's first `ADMIN`.
2. Read the verification token from the email link's URL fragment and POST it to `/api/v1/auth/verify-email`. The link fragment is not sent to the backend automatically.
3. Sign in using `POST /api/v1/auth/login`. The response sets the session cookie and returns `csrfToken`.
4. For browser requests, send cookies with credentials enabled (for example `fetch(..., { credentials: 'include' })`). Include `X-CSRF-Token: <csrfToken>` on every authenticated state-changing request. Safe methods (`GET`, `HEAD`, `OPTIONS`) do not require the CSRF header.
5. Use `GET /api/v1/auth/me` to restore the current user, company memberships, platform membership, and CSRF token after a page reload.
6. Log out with `POST /api/v1/auth/logout`; use `POST /api/v1/auth/logout-all` to revoke all of the current user's sessions. Both require the CSRF header.

Authentication middleware validates a short-lived Redis session record and a per-user auth-state marker atomically; it does not query PostgreSQL for each authenticated request. PostgreSQL remains the durable account/session store. Redis failures fail authentication closed. Account deactivation records a PostgreSQL revocation outbox event, so Redis cleanup can be retried after temporary outages.

The cookie is HttpOnly, SameSite=Strict, and Secure in production (or when `COOKIE_SECURE=true`). Configure `CORS_ORIGINS` as a comma-separated exact-origin allowlist; credentialed requests are enabled. A client cannot sign itself up through `/auth/register`; that endpoint is not implemented. Company and platform accounts are created through the routes documented below.

## Validation and errors

Request validation failures return `400` with a structured error. Joi validates request bodies, path parameters, and query parameters before business logic. Details contain each invalid path, Joi validation type, and message.

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request",
    "details": [
      {
        "message": "\"password\" length must be at least 12 characters long",
        "path": ["password"],
        "type": "string.min"
      }
    ]
  }
}
```

Other errors use the same outer shape, without `details` unless present:

```json
{
  "error": {
    "code": "UNAUTHENTICATED",
    "message": "Authentication required"
  }
}
```

Common statuses:

| Status | Meaning |
|---|---|
| `201` | Resource created |
| `200` | Request succeeded |
| `202` | Request accepted; used for enumeration-resistant email flows |
| `204` | Request succeeded without a response body |
| `400` | Invalid body, parameter, or query; or an invalid one-time token |
| `401` | Missing/expired session, invalid credentials, or invalid webhook signature |
| `403` | Missing permission, invalid CSRF token, or operation not allowed by current plan |
| `404` | Resource not found (including resources outside the caller's company) |
| `409` | Duplicate/conflicting state, such as a duplicate resource or idempotency conflict |
| `429` | Rate limit exceeded |
| `500` / `503` | Unexpected failure or required service unavailable |

Unknown routes return `404` with `NOT_FOUND`. Do not rely on exact error messages for application control flow; use `error.code` and the HTTP status.

## Endpoint reference

All paths below are relative to the API origin. Unless an endpoint is marked **Public**, it requires the session cookie. Authenticated `POST` and `PATCH` requests require the CSRF header as well.

### Health

| Method and path | Access | Request | Success |
|---|---|---|---|
| `GET /health` | Public | No body | `200 { "status": "ok" }` |

### Authentication

Password requirements for account creation and reset: 12–128 characters. Email is trimmed, must be valid, and is limited to 254 characters. Required names are trimmed strings of 1–120 characters; `middleName` is optional and has the same length limits.

| Method and path | Access | Request body | Success |
|---|---|---|---|
| `POST /api/v1/auth/register-company` | Public; max 5 requests/hour | `email`, `password`, `firstName`, `lastName`, `companyName`; optional `middleName` | `201`; returns pending `user` and new `company` |
| `POST /api/v1/auth/login` | Public; login rate-limited | `email`, `password` (1–128 characters) | `200`; sets session cookie and returns user, memberships, `platformMembership`, `csrfToken` |
| `GET /api/v1/auth/me` | Session | None | `200`; returns current user, memberships, platform membership, and current CSRF token |
| `POST /api/v1/auth/logout` | Session + CSRF | None | `204`; revokes current session and clears cookie |
| `POST /api/v1/auth/logout-all` | Session + CSRF | None | `204`; revokes all current-user sessions and clears cookie |
| `POST /api/v1/auth/verify-email` | Public; max 5 requests/hour | `token` (32–256 characters) | `200 { "verified": true }` |
| `POST /api/v1/auth/resend-verification` | Public; max 5 requests/hour | `email` | `202 { "accepted": true }` |
| `POST /api/v1/auth/forgot-password` | Public; max 5 requests/hour | `email` | `202`; generic response to prevent account enumeration |
| `POST /api/v1/auth/reset-password` | Public; max 5 requests/hour | `token` (32–256 characters), `password` (12–128 characters) | `200 { "reset": true }`; revokes all existing sessions |

Company registration also requires `companyName` to be 1–160 trimmed characters and produce a valid company slug. The registration response includes `user.verificationRequired: true`. Email-verification links expire after 24 hours; password-reset links expire after one hour. Tokens are single-use.

Login request:

```json
{
  "email": "admin@example.com",
  "password": "replace-with-a-long-password"
}
```

Company registration request:

```json
{
  "email": "admin@example.com",
  "password": "replace-with-a-long-password",
  "firstName": "Avery",
  "middleName": "Morgan",
  "lastName": "Taylor",
  "companyName": "Example Goods"
}
```

### Companies, members, and invitations

Company path parameters accept an internal company ID or its `CO...` display ID. Member IDs refer to the membership record, not the user record. Company endpoints require active membership; permissions depend on the caller's company role.

| Method and path | Access | Request body | Success |
|---|---|---|---|
| `GET /api/v1/companies/:companyId` | Company member with `company:read` | None | `200 { "company": ... }` |
| `PATCH /api/v1/companies/:companyId` | Company member with `company:update` | `name`: trimmed string, 1–160 characters | `200 { "company": ... }` |
| `GET /api/v1/companies/:companyId/members` | Company member with `members:read` | None | `200 { "members": [...] }` |
| `POST /api/v1/companies/:companyId/members` | Company member with `members:manage` | Account fields from registration plus `role` | `201`; user verification email is sent |
| `PATCH /api/v1/companies/:companyId/members/:memberId` | Company member with `members:manage` | `role` | `200 { "member": ... }` |
| `POST /api/v1/companies/:companyId/members/:memberId/suspend` | Company member with `members:manage` | None | `204` |
| `DELETE /api/v1/companies/:companyId/members/:memberId` | Company member with `members:manage` + CSRF | None | `204`; removes only that company's membership |
| `POST /api/v1/companies/:companyId/members/:memberId/reactivate` | Company member with `members:manage` | None | `204` |
| `GET /api/v1/companies/:companyId/invitations` | Company member with `members:read` | None | `200 { "invitations": [...] }` |
| `POST /api/v1/companies/:companyId/invitations` | Company member with `members:manage` | `email`, `role` | `201 { "invitation": ... }` |
| `POST /api/v1/invitations/accept` | Any signed-in user + CSRF | `token` (32–256 characters) | `200 { "member": ... }` |

Valid company member roles are `ADMIN`, `PRODUCT_MANAGER`, and `EDITOR`. Invitation email has the same 254-character email validation as registration. A company needs an active subscription for member creation, invitations, and reactivation. Invitations expire after seven days and can only be accepted by a signed-in, email-verified user whose email matches the invitation. The last active `ADMIN` cannot be demoted, suspended, or deleted. Deleting a membership does not delete the user's account or memberships in other companies.

Create member:

```json
{
  "email": "editor@example.com",
  "password": "replace-with-a-long-password",
  "firstName": "Jordan",
  "lastName": "Lee",
  "role": "EDITOR"
}
```

Create invitation:

```json
{
  "email": "editor@example.com",
  "role": "EDITOR"
}
```

### Verification policies

Company policy fields are optional individually, but each update must include at least one field. `maxSuccessfulUses` is an integer from 1 to 1,000,000; `overuseAction` is `WARN` or `BLOCK`; `overuseMessage` is a trimmed string up to 500 characters or `null`.

| Method and path | Access | Request body | Success |
|---|---|---|---|
| `GET /api/v1/companies/:companyId/verification-policy` | Company member with `company:read` | None | `200 { "policy": ... }` |
| `PATCH /api/v1/companies/:companyId/verification-policy` | Company member with `verification-policy:manage` | At least one of the company policy fields | `200 { "policy": ... }` |
| `GET /api/v1/companies/:companyId/products/:productId/verification-policy` | Company member with `products:read` | None | `200 { "policy": ... }` |
| `PATCH /api/v1/companies/:companyId/products/:productId/verification-policy` | Company member with `verification-policy:manage` | At least one of the product policy fields | `200 { "policy": ... }` |

Product policy fields may be set to `null` to inherit the company's default. The effective product policy is returned alongside its overrides on `GET`. Policy edits apply to newly generated items; existing items retain their policy snapshot.

```json
{
  "maxSuccessfulUses": 5,
  "overuseAction": "WARN",
  "overuseMessage": "This code has been checked more times than expected."
}
```

### Products, batches, items, and print exports

Company, product, and batch path IDs accept an internal ID or a display ID. Product and batch list endpoints return the full list and do not accept paging parameters. Item listing is paginated.

| Method and path | Access | Request body / query / headers | Success |
|---|---|---|---|
| `GET /api/v1/companies/:companyId/products` | `products:read` | None | `200 { "products": [...] }` |
| `POST /api/v1/companies/:companyId/products` | `products:create` | `name` required; optional `slug`, `description` | `201 { "product": ... }` |
| `GET /api/v1/companies/:companyId/products/:productId` | `products:read` | None | `200 { "product": ... }` |
| `PATCH /api/v1/companies/:companyId/products/:productId` | `products:update` | At least one supported product field | `200 { "product": ... }` |
| `POST /api/v1/companies/:companyId/products/:productId/image` | `products:update` + CSRF | Multipart `image` file; JPEG/PNG/WebP, max 5 MB | `200 { "product": ... }` |
| `POST /api/v1/companies/:companyId/products/:productId/archive` | `products:archive` | None | `204` |
| `GET /api/v1/companies/:companyId/products/:productId/batches` | `batches:read` | None | `200 { "batches": [...] }` |
| `POST /api/v1/companies/:companyId/products/:productId/batches` | `batches:create` | `batchNumber` required; optional `productionDate`, `expiryDate` | `201 { "batch": ... }` |
| `GET /api/v1/companies/:companyId/batches/:batchId` | `batches:read` | None | `200 { "batch": ... }` |
| `PATCH /api/v1/companies/:companyId/batches/:batchId` | `batches:update` | At least one supported batch field | `200 { "batch": ... }` |
| `POST /api/v1/companies/:companyId/batches/:batchId/items/generate` | `items:generate` | Body `count`; header `Idempotency-Key` required | `201`; returns count and print-export job details, not the codes |
| `GET /api/v1/companies/:companyId/batches/:batchId/items` | `items:read` | Query `page` (default 1), `pageSize` (default 25, max 100) | `200 { "items": [...], "page": n, "pageSize": n }` |
| `GET /api/v1/companies/:companyId/print-exports` | `codes:export` | None | `200 { "exports": [...] }` |
| `POST /api/v1/companies/:companyId/print-exports/:exportJobId/download` | `codes:export` | None | `200`; one-time JSON attachment with `no-store` cache headers |
| `POST /api/v1/companies/:companyId/items/:itemId/revoke` | `items:revoke` | None | `200 { "item": ... }` |
| `POST /api/v1/companies/:companyId/items/:itemId/recall` | `items:revoke` | None | `200 { "item": ... }` |

Product fields: `name` and `slug` are trimmed strings, 1–160 characters; `description` is up to 10,000 characters and may be empty. Create requires `name`; update requires at least one field. If no slug is supplied, the name is used to generate it. Companies cannot choose a storage provider or submit image storage metadata.

Upload or replace a product image using `POST /api/v1/companies/:companyId/products/:productId/image` as `multipart/form-data` with a single `image` file and the normal CSRF header. JPEG, PNG, and WebP files up to 5 MB are accepted. The platform selects the destination with `PRODUCT_IMAGE_STORAGE_PROVIDER` (`S3` or `CLOUDINARY`) and supplies the corresponding credentials/configuration; the response exposes the resulting `imageUrl`, not the storage key or provider. For S3, configure a public read policy or `PRODUCT_IMAGE_PUBLIC_BASE_URL` for a CDN; object writes use server-side AES-256 encryption.

Batch fields: `batchNumber` is a trimmed string, 1–100 characters; `productionDate` and `expiryDate` are dates. Create requires `batchNumber`; update requires at least one field. Expiry cannot be earlier than production.

Item generation accepts an integer `count` from 1 to 100. `Idempotency-Key` is required and must be a non-empty trimmed string of at most 128 characters. Reusing the key with the same request returns the prior result; reusing it for a different request returns `409 IDEMPOTENCY_CONFLICT`. Generation requires an active, unexpired subscription and remaining item quota. Generated concealed codes are not included in the generation response.

```json
{ "name": "Example Product", "slug": "example-product", "description": "Optional product details" }
```

```json
{ "batchNumber": "BATCH-2026-001", "productionDate": "2026-10-21", "expiryDate": "2028-10-21" }
```

```json
{ "count": 10 }
```

After generation, an authorized user with `codes:export` can list print exports and download an export once. Exports contain concealed codes, are encrypted at rest, expire after 24 hours, are audited, and are scrubbed after successful download or expiry. Do not cache or persist export responses outside the approved print workflow.

### Billing

| Method and path | Access | Request body | Success |
|---|---|---|---|
| `GET /api/v1/companies/:companyId/billing` | `billing:read` | None | `200 { "subscription": ... }`; subscription may be `null` |
| `POST /api/v1/companies/:companyId/billing/cancel` | `billing:manage` | None | `200 { "subscription": ... }` |

Billing changes require an active company membership and CSRF header for cancellation. Cancellation preserves existing products, items, and history; operations requiring an active plan are then denied. Plan checkout and charge creation are not implemented.

### Public verification

`publicToken` is an opaque item token. Verification routes are public and rate-limited. Opening a page and submitting a code are tracked separately.

| Method and path | Access | Request body | Success |
|---|---|---|---|
| `GET /api/v1/verify/:publicToken` | Public | None | `200 { "status": "CODE_REQUIRED", "message": ... }` |
| `POST /api/v1/verify/:publicToken` | Public | `code` | `200` for a valid eligible/blocked result; `400` for an invalid code |

`code` must be either exactly 12 digits or a 20-character hexadecimal legacy code. Verification success responses can have result `GENUINE`, `WARNING`, `LIMIT_REACHED`, `REVOKED`, `RECALLED`, `EXPIRED`, or `UNAVAILABLE`. Invalid submissions return `400` with result `INVALID`. Raw codes are never written to logs or events. The first configured N successful uses are allowed; after that, `WARN` records and reports warnings while `BLOCK` denies additional successes.

```json
{ "code": "123456789012" }
```

### Platform administration

All platform routes require a signed-in user with an active platform membership and the permission indicated below. State-changing routes additionally require the CSRF header. `companyId` accepts a company internal ID or `CO...` display ID. `planId` is the plan's internal ID.

| Method and path | Permission | Request body / query | Success |
|---|---|---|---|
| `GET /api/v1/platform-admin/members` | `platform:members:read` | None | `200 { "members": [...] }` |
| `PATCH /api/v1/platform-admin/members/:userId/status` | `platform:members:manage` + CSRF | None | `200 { "user": { "id": "...", "status": "INACTIVE" } }`; revokes all sessions |
| `POST /api/v1/platform-admin/members` | `platform:members:manage` | Account fields plus platform `role` | `201`; verification email is sent |
| `GET /api/v1/platform-admin/companies` | `companies:read` | None | `200 { "companies": [...] }` |
| `PATCH /api/v1/platform-admin/companies/:companyId/status` | `companies:manage` | `isActive` boolean | `200 { "company": ... }` |
| `GET /api/v1/platform-admin/audit-logs` | `audit:read` | Query `page` (default 1, integer ≥ 1); 50 per page | `200 { "logs": [...], "page": n, "pageSize": 50 }` |
| `GET /api/v1/platform-admin/plans` | `plans:read` | None | `200 { "plans": [...] }` |
| `POST /api/v1/platform-admin/plans` | `plans:manage` | Plan fields below | `201 { "plan": ... }` |
| `PATCH /api/v1/platform-admin/plans/:planId` | `plans:manage` | At least one supported plan field | `200 { "plan": ... }` |
| `POST /api/v1/platform-admin/companies/:companyId/subscriptions` | `subscriptions:manage` | `planId` non-empty string | `201 { "subscription": ... }` |

Platform roles are `SUPER_ADMIN`, `PLATFORM_ADMIN`, `PLATFORM_SUPPORT`, and `PLATFORM_VIEWER`. Only a `SUPER_ADMIN` can assign `SUPER_ADMIN` or `PLATFORM_ADMIN`; the remaining roles may be created by an authorized platform-member manager.

Plan create fields:

| Field | Validation |
|---|---|
| `name` | Required trimmed string, 1–80 characters |
| `price` | Required number ≥ 0 |
| `currency` | Three uppercase letters; defaults to `USD` |
| `itemLimit` | Required positive integer |
| `memberLimit` | Required positive integer |
| `periodDays` | Integer 1–366; defaults to 30 |

Plan updates accept any non-empty subset of those fields plus `isActive` (boolean). A subscription assignment requires an active plan and no existing active/trialing/past-due subscription for the company; it begins in `TRIALING` for the plan's period.

Platform member request:

```json
{
  "email": "support@example.com",
  "password": "replace-with-a-long-password",
  "firstName": "Casey",
  "lastName": "Rivera",
  "role": "PLATFORM_SUPPORT"
}
```

Plan create request:

```json
{
  "name": "Standard",
  "price": 49.99,
  "currency": "USD",
  "itemLimit": 10000,
  "memberLimit": 10,
  "periodDays": 30
}
```

### Payment webhook

| Method and path | Access | Request | Success |
|---|---|---|---|
| `POST /api/v1/webhooks/payments/provider` | Provider-to-server; no user session | Raw JSON body plus `X-Payment-Signature` | `200 { "received": true, "duplicate": boolean }` |

Signature format: `X-Payment-Signature: t=<unix-seconds>,v1=<hex-hmac-sha256>`. The HMAC-SHA256 input is `<t>.<exact raw request body>` and the key is `PAYMENT_WEBHOOK_SECRET`. Timestamps older than five minutes are rejected. The request body is limited to 64 KiB.

Accepted event types are `payment.succeeded`, `payment.failed`, and `payment.refunded`. Event body:

```json
{
  "id": "evt_12345",
  "type": "payment.succeeded",
  "data": {
    "subscriptionId": "subscription-internal-id",
    "providerReference": "charge_12345",
    "amount": "49.99",
    "currency": "USD"
  }
}
```

`id` is required and 1–200 characters. `subscriptionId` and `providerReference` are required non-empty strings; the provider reference is limited to 255 characters. `amount` must be a decimal string with up to 8 whole digits and at most 2 decimal places. `currency` must be exactly three uppercase letters. Amount and currency must match the subscription plan. Event processing is idempotent. A real payment processor, checkout flow, and provider-specific adapter are not configured.

## Roles and permissions

Company and platform memberships are separate. A user's platform role does not grant company membership.

| Role | Summary |
|---|---|
| `ADMIN` | Company/member administration, products and batches, item generation/revocation, exports, policy, billing, and reports |
| `PRODUCT_MANAGER` | Products, batches, item generation, and reports; no membership, billing, exports, or revocation |
| `EDITOR` | Read company/product/batch/item data and update products/batches; no generation, revocation, membership, billing, or exports |
| `SUPER_ADMIN` | Full platform access; only this role can assign `SUPER_ADMIN` or `PLATFORM_ADMIN` |
| `PLATFORM_ADMIN` | Manage platform operations and create support/viewer accounts |
| `PLATFORM_SUPPORT` | Read companies and audit logs |
| `PLATFORM_VIEWER` | Read-only access to platform listings |

The permission checks listed alongside each route are authoritative; role summaries are intentionally high-level.

## Frontend workflows

### Sign up and sign in

- Register a company, then have the user follow the email link and submit the token from the URL fragment to `/auth/verify-email`.
- Do not attempt login until email verification has succeeded.
- Keep the login response's `csrfToken` in application memory and send it as `X-CSRF-Token` for authenticated `POST`/`PATCH` calls. Use the session cookie only through the browser's cookie mechanism; never place it in local storage or a URL.
- On a page reload, call `/auth/me` to restore membership context and the CSRF token.

### Verification item creation and printing

- Create a product, then a batch, and generate items with a unique idempotency key for each distinct generation operation.
- The generation response deliberately does not contain concealed codes. Use the returned print export ID to download the one-time export while authorized.
- Handle the export response as sensitive attachment data. It is not safe to retry a successful download; use the exports list to check whether it has already been consumed.

### Invitations and subscription gates

- The invitee must sign in with a verified account matching the invited email before accepting the invitation.
- Membership changes and item generation require an active, unexpired subscription with available quotas.
- Product and company policy edits affect newly generated items only.

## Database, migrations, and tests

Use `npm run db:migrate:dev` for development migrations and `npm run db:migrate` for deployment migrations. `npm run prisma:generate` regenerates the Prisma client. Database migrations require a reachable PostgreSQL instance.

```powershell
npm.cmd test
npm.cmd run test:integration:live
npm.cmd run lint
```

The default test run uses mocked PostgreSQL/Redis boundaries. Live PostgreSQL/Redis tests in `tests/integration/live.test.js` skip unless `RUN_LIVE_INTEGRATION=true`, `LIVE_DATABASE_URL` (a disposable migrated database), and `LIVE_REDIS_URL` are set. Never point live tests at production data.

## Security and deployment

- Terminate HTTPS at a trusted proxy and set `COOKIE_SECURE=true`. Configure `TRUST_PROXY_HOPS` to the exact trusted proxy count; forwarded headers are not trusted by default.
- Production startup requires SMTP (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`), a base64-encoded 32-byte `PRINT_EXPORT_ENCRYPTION_KEY`, and a `PAYMENT_WEBHOOK_SECRET` of at least 32 characters.
- Use distinct managed secrets, authenticated TLS connections to PostgreSQL/Redis, network restrictions, and PostgreSQL point-in-time backups. Redis is rebuildable; PostgreSQL is the authorization and audit source of truth.
- Configure retention for IP/device metadata under applicable privacy requirements.
- Redis and PostgreSQL are both checked for session validity; durable session, user, company, and membership status is rechecked on protected requests.
- `CORS_ORIGINS` is an exact-origin allowlist. Do not allow arbitrary origins while using credentialed cookies.

## External integrations and limitations

No specific payment processor, checkout flow, print vendor, production SMTP account, geolocation provider, or email-delivery queue/retry system is included. A frontend must provide email verification, password reset, and invitation acceptance screens, and submit emailed tokens to the API.
