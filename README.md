# Hago Integration Adapter

Backend-only Node.js/Express Hago integration adapter for a trusted website/backend, with MongoDB persistence. It is a controlled recovery project—not a live recharge system.

## Current safety state

**Mutations are disabled by default.** Diamond and Crystal have each been `LIVE-VERIFIED` once under their guarded one-shot paths. Nobility is independently disabled unless `HAGO_NOBILITY_ENABLED=true`; when enabled, it remains idempotent, fresh-preflighted, and one-shot. Its first live financial outcome is still pending.

| State | Meaning |
| --- | --- |
| IMPLEMENTED | Express routes, internal API protection, per-account session storage, parsers, request boundaries, and local transaction attempts. |
| LOCALLY VERIFIED | Mock-only tests cover protocol vectors, encrypted session handling, cookie isolation, error normalization, internal authentication, readiness, and disabled mutations. |
| CONFIRMED | UAAS `sendCode` signing, SMS `ts` TripleDES-CBC/PKCS7 generation, `00000` response handling, turnover `MD5("turnover" + JSON.stringify(data))`, wallet/history request shapes, cookie names, and VID-to-UID mapping. |
| CONTROLLED FINANCIAL MUTATION | Diamond and Crystal require explicit environment and request guards for every send, even though each has one authorized live verification. |
| HISTORICAL / PRE-FIX REJECTION | A pre-fix Diamond request used wallet-selected `1805`, received `-500`, and had no observed debit. Its meaning remains UNKNOWN. |
| UNKNOWN | Financial success acceptance, references, duplicate behavior, reconciliation, and retry semantics remain unverified. Nobility's first live financial outcome remains pending. |
| LIVE-VERIFIED | Authorized controlled runs completed authentication, read-only operations, one Diamond transfer, and one Crystal transfer. Each confirmed transfer returned `code === 1` and its wallet balance decreased by exactly the sent amount. No identifiers, credentials, cookies, or balances from those runs are retained here. |

## Architecture

```text
Browser frontend → our website/backend (deviceId only)
        ↓  x-internal-api-key (server-to-server only)
Internal Hago Adapter API (src/app.js)
        ↓
Controllers
        ↓
Hago integration boundary (src/integrations/hago)
        ↓
UAAS / yMicro / Turnover

MongoDB ← User session records and local transaction attempts
```

`npm start` waits for MongoDB before listening. The adapter is consumed directly by a trusted website/backend using the server-to-server key.

## Authentication layers

`x-internal-api-key` protects every `/api/auth/*` and `/api/bot/*` endpoint. It authenticates the trusted website/backend, not a Hago account. Never embed this key in browser JavaScript. A browser-provided FingerprintJS `visitorId` must first go to the website/backend, which forwards it server-to-server to this adapter.

Hago account authentication is separate. Where login succeeds through a future proven provider, the application stores one session per phone/account. The API never returns those cookie values.

## Hago login state

The adapter stores:

- `hagouid` as `hagoUid`, the authenticated internal Hago account UID used for yMicro and turnover requests
- `h_open_id` separately as `hOpenId`; it is a UAAS identity and is never substituted for a Hago UID
- encrypted `hagouid` cookie material
- encrypted `uaasCookie` cookie material

New cookie writes use AES-256-GCM with a random IV and a versioned envelope. Legacy plaintext session records remain read-compatible only until the account is re-authenticated; they are never written back unchanged. The web-login bundle confirms the fallback browser derivation: decrypt `s_session` with the OTP SHA-256 hex material, parse `uuid` and `sSessionKey`, TripleDES-encrypt `JSON.stringify({ uuid, timestamp })`, then construct the percent-encoded `uaasCookie` value from `<ciphertext>,<s_t>`. The adapter first uses complete authoritative `Set-Cookie` values and otherwise performs that exact derivation; malformed or incomplete data fails closed with `SESSION_ESTABLISHMENT_UNPROVEN`.

`VID`, `h_open_id`, and `hagouid` are distinct identifiers. A target VID is resolved through `Uinfo.GetUinfoByVidVer` to `infos[0].uid`. The authenticated account's `hagouid` is the internal UID for profile/turnover requests; a UAAS `h_open_id` is retained only as separate metadata. The controlled live run exposed the prior defect of treating `h_open_id` as an internal UID; the corrected adapter uses authenticated `hagouid` instead. No real identifiers are documented.

For compatibility, an existing record that previously stored `h_open_id` in `hagoUid` still uses its decrypted `hagouid` immediately for read-only calls. The next agent-profile lookup backfills `hagoUid` safely; re-login is only needed if the stored session itself is absent, undecryptable, or rejected.

## Current API

All `/api/*` routes use `POST` and require `Content-Type: application/json` plus `x-internal-api-key`. `/health` and `/ready` are unauthenticated `GET` endpoints and do not contact Hago.

`GET /docs` serves the local Swagger UI and `GET /openapi.json` serves its OpenAPI 3.0.3 contract. They never call Hago. They are enabled by default outside production; in production, set `SWAGGER_ENABLED=true` to expose both routes.

| Route | Purpose | Additional header | Current state |
| --- | --- | --- | --- |
| `/api/auth/send-otp` | Request Hago OTP | — | Requires `phone` and numeric `countryCode`; sends the confirmed signed request. LIVE-VERIFIED once. |
| `/api/auth/verify-otp` | Verify OTP and store a complete cookie session | — | Requires a pending OTP and trusted stable `deviceId`; sends the confirmed SMS-auth request. LIVE-VERIFIED once. |
| `/health` | Liveness | — | No authentication or Hago call; reports process health. |
| `/ready` | Local readiness | — | No authentication or Hago call; requires valid local config and Mongo connection. |
| `/api/bot/session/validate` | Probe a stored session through `getMobile` | — | Returns only `VALID`, `REJECTED`, or `UNKNOWN`; LIVE-VERIFIED once. |
| `/api/bot/transfer-readiness` | Read-only transfer diagnostic | — | Separately reports agency Diamond currency, effective transfer currency, and legacy/new wallet availability. It never sends a transfer. |
| `/api/bot/nobility-readiness` | Read-only Noble configuration/state diagnostic | — | Resolves the target VID, then uses authenticated yMicro `Noble.ListAllNobleConf` and `Noble.GetUserNoble`. Every RPC body includes its numeric yMicro `sequence`; `GetUserNoble` emits the resolved Uinfo UID as a validated JSON number. LIVE-VERIFIED once. It never calls `BuyNobleByAgency`. |
| `/api/bot/nobility-purchase-readiness` | Read-only Nobility purchase eligibility diagnostic | — | LIVE-VERIFIED read-only. Uses fresh session validation, VID resolution, Noble config/state, and legacy Diamond wallet data to derive a selected purchase/renew cost and technical eligibility. It creates no transaction intent, requires no mutation flag/header/idempotency key, and does not authorize or send a purchase. |
| `/api/bot/verify-id` | Authenticated VID-to-UID lookup | — | LIVE-VERIFIED once. |
| `/api/bot/agent-profile` | Authenticated profile lookup | — | LIVE-VERIFIED once after the identity-mapping correction. |
| `/api/bot/wallet-balance` | Signed read-only turnover wallet query | — | Returns only the three confirmed currency balances; LIVE-VERIFIED once. |
| `/api/bot/account-history` | Signed read-only account-history query | — | LIVE-VERIFIED once; empty history is valid for the tested default query. It remains non-authoritative. |
| `/api/bot/transactions` | List local transaction attempts | — | Implemented; not an authoritative Hago ledger. |
| `/api/bot/auto-recharge/diamond` | Controlled Diamond attempt | `Idempotency-Key`, `X-Controlled-Mutation: true` | LIVE-VERIFIED once: confirmed agency currency `1835`, amount ≥ `200`, `code === 1`, and wallet reduction equal to the sent amount. The historical pre-fix `1805`/`-500` request remains non-causal historical evidence. |
| `/api/bot/auto-recharge/crystal` | Controlled Crystal attempt | `Idempotency-Key`, `X-Controlled-Mutation: true` | LIVE-VERIFIED once: one authorized controlled Crystal request returned `code === 1` and the wallet balance decreased by exactly the sent amount. It uses fixed wire currency `1826`, not agency Diamond currency. Before every guarded send it checks the bundle-confirmed browser preflight: a positive whole-number amount of up to seven digits, normalized Crystal balance, and a positive agency `transferMax` when supplied. |
| `/api/bot/auto-recharge/nobility/preview` | Local Nobility structural preview | — | Reports only confirmed Noble RPC metadata and enum structure; no session, config, or Hago request. |
| `/api/bot/auto-recharge/nobility` | Nobility financial mutation | `Idempotency-Key` | Disabled by default; normal production access is enabled only with `HAGO_NOBILITY_ENABLED=true`. Every request freshly validates session, VID/UID, Noble config/state, and legacy Diamond balance, then derives buy type, dynamic price, and pack ID internally. First live financial outcome pending. |
| `/api/bot/transactions/reconcile` | Manual read-only reconciliation | — | Queries wallet/history for an attempted `UNKNOWN` transaction but never changes its outcome automatically. |

See [API.md](docs/API.md) for required JSON bodies and exact error behavior.

## Environment

Copy `.env.example` to `.env`; do not commit it.

| Variable | Purpose |
| --- | --- |
| `PORT` | API port; defaults to `3000`. |
| `HOST` | HTTP bind address; defaults to `127.0.0.1`. Keep the adapter on loopback behind Nginx unless a deliberate deployment design requires another validated hostname/IP. |
| `MONGO_URI` | Required MongoDB connection string. |
| `INTERNAL_API_KEY` | Required server-to-server API key. |
| `HAGO_SESSION_ENCRYPTION_KEY` | Required Base64-encoded 32-byte AES-256-GCM key for persisted cookie material. |
| `HAGO_REQUEST_TIMEOUT_MS` | Hago client timeout; defaults to the bundle-confirmed `15000`. |
| `HAGO_TURNOVER_BASE_URL` | Read-only turnover base URL; defaults to the captured host. |
| `HAGO_COUNTRY` / `HAGO_LANGUAGE` | Turnover-header fallback when no per-account locale is stored. |
| `HAGO_MUTATIONS_ENABLED` | Default `false`; required, together with controlled mode, before the Diamond/Crystal sender can be reached. |
| `HAGO_CONTROLLED_MUTATION_MODE` | Default `false`; when `true`, startup requires a valid controlled test ceiling. |
| `HAGO_CONTROLLED_MUTATION_MAX_AMOUNT` | Required only when controlled mode is `true`; positive authorized test ceiling. |
| `HAGO_NOBILITY_ENABLED` | Default `false`; independent operational switch for normal Nobility purchase/renew requests. It does not affect Diamond or Crystal and is not transaction authorization. |
| `SWAGGER_ENABLED` | Optional: unset enables `/docs` and `/openapi.json` outside production and disables both in production; `true` explicitly enables them. |

## Running

```bash
# Reproducible install from package-lock.json
npm ci
# Or use npm install when changing dependencies
# npm install
npm test
npm start
```

## Postman

Import [Hago_Automation_Recovery.postman_collection.json](postman/Hago_Automation_Recovery.postman_collection.json) into Postman. Set `internalApiKey` and the non-secret test variables for your local environment; `adapterBaseUrl` defaults to `http://localhost:3000` and `baseUrl` to `http://localhost:3000/api`.

The collection includes default fail-closed examples and separately labeled controlled Diamond/Crystal examples. `send-otp` requires numeric `countryCode`; verification requires a trusted stable `deviceId`. Wallet and account-history calls are read-only. Diamond/Crystal controlled mutations require Postman's `{{$guid}}` `Idempotency-Key`, `X-Controlled-Mutation: true`, both environment flags, and a configured ceiling. Nobility requires only a stable `Idempotency-Key` plus `HAGO_NOBILITY_ENABLED=true`; its first live financial outcome is pending. Do not run any financial request without explicit authorization.

## Protocol confidence matrix

| Feature | Status |
| --- | --- |
| Send OTP | LIVE-VERIFIED once |
| Verify OTP request/signing | LIVE-VERIFIED once |
| Session cookie construction | LIVE-VERIFIED once |
| Session validation | LIVE-VERIFIED once |
| VID lookup | LIVE-VERIFIED once |
| Agent profile | LIVE-VERIFIED once after the identity correction |
| Wallet request/signing | LIVE-VERIFIED once |
| Account-history request/signing | LIVE-VERIFIED once; default query may validly be empty |
| Diamond | LIVE-VERIFIED once: `code === 1` with wallet reduction equal to the sent amount; historical pre-fix `-500` remains UNKNOWN evidence only |
| Crystal | LIVE-VERIFIED once: fixed `1826`, `code === 1`, and wallet reduction equal to the sent amount |
| Nobility read-only | LIVE-VERIFIED once: VID resolution, ListAllNobleConf, GetUserNoble, configuration/current-state parsing, and purchase-readiness completed successfully under authorization |
| Nobility mutation | PRODUCTION ENABLED when `HAGO_NOBILITY_ENABLED=true`; purchase/renew construction is CONFIRMED / LOCALLY VERIFIED and the first live financial outcome is pending |
| UAAS sendCode sign | CONFIRMED |
| SMS `ts` generation | CONFIRMED |
| DeviceId browser source | CONFIRMED; backend accepts trusted-caller value or blocks |
| Turnover sign | LIVE-VERIFIED through wallet and history |

## Security and limitations

- Internal API-key comparison is timing-safe.
- Session-cookie fields are excluded from default Mongoose selection and never included in auth responses.
- Startup fails fast when `MONGO_URI`, `INTERNAL_API_KEY`, or `HAGO_SESSION_ENCRYPTION_KEY` is missing/invalid, timeouts are invalid, or controlled mutation mode lacks a valid ceiling.
- Each response includes a bounded `x-request-id`; error logs include only that ID and an error class.
- OTP routes are rate-limited in process memory; this is not a distributed limiter.
- Hago HTTP clients have bounded timeouts.
- AES-256-GCM cookie encryption at rest is implemented. Production operations still need an external secret manager, key rotation, and controlled key handling.
- No live Hago verification, OTP send, transfer, recharge, or purchase is part of the test suite.
- The transfer-readiness diagnostic is strictly read-only: it does not call `transfer_account`, password verification, or password setup endpoints.

## Next investigation

See [Integration Recovery](docs/INTEGRATION_RECOVERY.md) for the evidence matrix. Authentication, established read-only operations including Nobility purchase readiness, Diamond, and Crystal are each `LIVE-VERIFIED` once for the controlled account. Nobility financial mutation is production-enabled only when its independent operator switch is true, with its first live outcome pending. This does not establish financial behavior for other accounts, regions, or upstream variants.

Historical pre-recovery findings remain available in [Architecture](docs/ARCHITECTURE.md), [Audit](docs/AUDIT.md), [Database](docs/DATABASE.md), and [Flows](docs/FLOWS.md); those files are explicitly marked as historical.
