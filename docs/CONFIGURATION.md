# Configuration Reference

Copy `.env.example` to `.env` and replace placeholders outside source control. Never add Hago cookies, OTPs, captured signatures, or external account/session values to either file.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `PORT` | No | `3000` | HTTP listening port. |
| `MONGO_URI` | Yes for API | None | MongoDB connection string. Startup waits for a connection. |
| `INTERNAL_API_KEY` | Yes for trusted backend | None | Server-to-server key sent as `x-internal-api-key`; never expose it to browser code. |
| `HAGO_SESSION_ENCRYPTION_KEY` | Yes for API | None | Base64-encoded, exactly 32-byte AES-256-GCM key for `hagouid` and `uaasCookie` at rest. |
| `HAGO_REQUEST_TIMEOUT_MS` | No | `15000` | Hago integration HTTP timeout. The default matches the confirmed recharge-agent bundle timeout; an explicit positive deployment override remains supported. |
| `HAGO_TURNOVER_BASE_URL` | No | `https://db-turnover.ihago.net` | Read-only turnover service base URL from captured traffic. |
| `HAGO_COUNTRY` | Recommended | None | Two-letter fallback country header for turnover when an account has no stored locale. |
| `HAGO_LANGUAGE` | No | `en` | Fallback language header for turnover calls. |
| `HAGO_MUTATIONS_ENABLED` | No | `false` | First of two explicit guards for controlled Diamond/Crystal verification. |
| `HAGO_CONTROLLED_MUTATION_MODE` | No | `false` | Second explicit guard. When `true`, startup requires a positive controlled test ceiling. |
| `HAGO_CONTROLLED_MUTATION_MAX_AMOUNT` | When controlled mode is `true` | None | Positive authorized ceiling for one controlled Diamond/Crystal amount. |
| `HAGO_NOBILITY_ENABLED` | No | `false` | Independent operational switch for normal Nobility purchase/renew requests. It is not authorization and does not enable Diamond or Crystal. |
| `SWAGGER_ENABLED` | No | Unset | When unset, enables `/docs` and `/openapi.json` outside production and disables them in production. Set `true` to explicitly expose the local API contract in production; set `false` to disable it. |

The API fails startup when `MONGO_URI`, `INTERNAL_API_KEY`, or `HAGO_SESSION_ENCRYPTION_KEY` is missing, when the encryption key is not valid Base64 32-byte material, or when numeric timeouts are invalid. Keep the encryption key in a secret manager. `INTERNAL_API_KEY` authenticates only the trusted website/backend caller. A browser must send its FingerprintJS device ID to that backend, not directly to this adapter. `HAGO_COUNTRY` is a locale header, not the numeric phone `countryCode` used by UAAS.

There is no configuration override for Hago session derivation. After successful SMS auth, the adapter prefers complete authoritative `Set-Cookie` values; otherwise it applies the fixed, bundle-confirmed browser derivation and fails closed if the response is incomplete or invalid.

There is also no identifier-mapping override: `hagouid` is the internal Hago account UID used by authenticated yMicro/turnover calls, while `h_open_id` is retained separately as UAAS metadata. A browser/device ID is not an account identifier.

History bounds remain fixed application safety controls. Mutation defaults are fail-closed: `HAGO_MUTATIONS_ENABLED=true` alone cannot create an upstream Diamond/Crystal financial request. A Diamond/Crystal sender additionally requires `HAGO_CONTROLLED_MUTATION_MODE=true`, a valid `HAGO_CONTROLLED_MUTATION_MAX_AMOUNT`, `X-Controlled-Mutation: true`, and a valid `Idempotency-Key`. Nobility is independent: `HAGO_NOBILITY_ENABLED=true` plus a valid `Idempotency-Key` permits its normal production route; it does not use a controlled-test header or ceiling and does not enable Diamond or Crystal.

The controlled ceiling is not an authorization token and must not be hard-coded in source control. It is an operational safety limit for one explicitly authorized test. Do not set either mutation flag for ordinary runtime operation.

One authorized controlled account has completed authentication, read-only operations, and separate guarded Diamond and Crystal transfers successfully with environment-provided configuration. Each controlled request returned code `1` and its wallet balance decreased by exactly the sent amount. Do not place account data, cookies, OTPs, device IDs, balances, transaction identifiers, or API keys from those runs in configuration or source control. These verifications do not authorize additional transfers or enable Nobility.

`/docs` serves a local Swagger UI and `/openapi.json` serves the same OpenAPI 3.0.3 contract. They do not call Hago. Their exposure follows `SWAGGER_ENABLED`; the raw contract and UI are both unavailable when Swagger is disabled.

`POST /api/bot/transfer-readiness`, `POST /api/bot/nobility-readiness`, and `POST /api/bot/nobility-purchase-readiness` are read-only and require no additional configuration. Nobility readiness and purchase readiness are LIVE-VERIFIED once; purchase readiness refreshes configuration, current state, and the legacy Diamond wallet balance to report current technical eligibility, creates no transaction intent, and never calls `BuyNobleByAgency`.

Nobility financial mutation is disabled by default and becomes production-enabled only when `HAGO_NOBILITY_ENABLED=true`. It uses fresh configuration, target state, and the legacy Diamond wallet balance; the website/backend may submit only the target and requested numeric Noble type. Price, Diamond cost, turnover pack ID, buy type, and buyer UID are derived internally and never accepted from caller input. The operator switch is not authorization and no Nobility financial mutation has been live-verified; the first live financial outcome is pending.
