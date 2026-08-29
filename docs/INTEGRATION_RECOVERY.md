# Hago Integration Recovery

## Current source audit

The executable adapter now has isolated integration components for UAAS, yMicro, turnover, sessions, device IDs, and mutation request construction. It uses bounded HTTP timeouts, internal API authentication, a 32 KB request limit, OTP rate limiting, Mongoose-hidden cookie fields, and idempotency-backed local mutation records.

Before this recovery, UAAS signing and turnover were placeholders that returned `BLOCKED`. The recharge-agent bundle and captured HTTP request shape now support the read-only turnover implementation. Complete web-login evidence now also confirms the SMS TripleDES rule and a synthetic compatibility vector. One authorized controlled account has completed authentication, read-only operations, and one controlled Diamond transfer; no captured identifiers, credentials, cookies, device IDs, or balances are retained here.

## Platform tenant isolation (Prompt 3)

Client authentication is a separate platform concern: `Client` and `ClientApiKey` records support independently generated, versioned `hago_live_v1_<keyId>_<secret>` credentials. Only the HMAC-SHA-256 digest of the 256-bit generated secret is persisted; a server-side `CLIENT_API_KEY_PEPPER` stays outside MongoDB. Disabled, revoked, expired, and disabled-parent-client keys fail authentication. V2 middleware attaches only safe client/key identifiers.

`LoginChallenge` is durable and tenant-owned, with TTL expiry, encrypted phone material, keyed lookup/device-binding digests, and no stored OTP or raw device ID. V2 creates a `REQUESTING` challenge before the Hago OTP boundary, transitions it to `OTP_SENT` only on success, and atomically claims it as `VERIFYING` before verification. A successful full session becomes an encrypted tenant-owned `Connection`, returned only as opaque `connectionId`.

Existing `/api` routes remain legacy V1 compatibility behavior behind `x-internal-api-key`. V2 remains strictly separate behind `x-client-api-key`: connections, V2 transaction lookups, idempotency, and reconciliation use `req.auth.clientId` plus opaque `connectionId`. Financial V2 sends acquire a Mongo-backed lock keyed by a keyed digest of the authenticated Hago account. Ambiguous results retain `UNKNOWN_HOLD` and are never retried automatically. Legacy V1 records remain outside V2 until an explicit data migration; no Hago protocol behavior changed.

## Protocol confidence

| Component | Status | Implemented behavior |
| --- | --- | --- |
| UAAS `sendCode` canonical input | CONFIRMED | `URLSearchParams` order: `nonstr`, `timestamp`, `mobile`, `operType`, `countryCode`; SHA-256 hex signature. |
| UAAS send-code request | LIVE-VERIFIED | Sends all observed fields including `validType=1`, `app=hago`, and `appId=ikxd`; success is exactly `result_code === "00000"`. |
| UAAS SMS request fields | LIVE-VERIFIED | Sends the observed field names and constants; accepted once in the controlled flow. |
| SMS `ts` generation | CONFIRMED | SHA-256 lowercase hex of the SMS code, first 24 ASCII bytes as the 3DES key, CBC/PKCS7, IV `01234567`, raw-ciphertext Base64. Synthetic vector passes exactly. |
| Device ID browser source | CONFIRMED | Browser source is FingerprintJS `visitorId`, stored as `web-login:did`. Backend accepts a trusted-caller supplied stable value or blocks before HTTP; it never invents one. |
| SMS session persistence | LIVE-VERIFIED | The complete web-login bundle proves the fallback: decrypt `s_session` with OTP SHA-256 hex material using TripleDES-CBC/PKCS7 and IV `01234567`; parse `uuid`/`sSessionKey`; encrypt ordered `{ uuid, timestamp }` JSON with the same helper; then produce the percent-encoded `<ciphertext>,<s_t>` cookie value. A complete session was persisted and accepted once. `hagouid` is persisted as the internal Hago UID and `h_open_id` separately as UAAS metadata. |
| Turnover signing | LIVE-VERIFIED | Dedicated signer produces `MD5("turnover" + JSON.stringify(data))` and succeeded through wallet and history once. |
| Wallet request | LIVE-VERIFIED | Builds `GET /query/1802/1005`, signs JSON data, sends authenticated turnover headers, parses nested `jsonMsg`, and returns only the three confirmed currency balances. |
| History request | LIVE-VERIFIED | Builds signed multipart `POST /agencypay/queryAccountHistory`; pagination/filter input is bounded and nested `jsonMsg` is parsed. The tested default query returned valid empty history. It is not a settlement ledger. |
| VID lookup | LIVE-VERIFIED | Uses `Uinfo.GetUinfoByVidVer` and maps `infos[0].uid`; VID is never treated as UID. The authenticated account's `hagouid` is likewise distinct from `h_open_id` and is used for account profile/turnover requests. |
| Agent profile lookup | LIVE-VERIFIED | Authenticated yMicro profile lookup succeeded once after the identity-mapping correction. |
| Diamond/Crystal transfer request | CONFIRMED | Builds `appId`, empty bundle-observed `sign`, and ordered JSON data for `transfer_account`. Diamond wire currency is `agencyInfo.currencyType` when confirmed as `1805`/`1835`, otherwise default `1805`; it is not selected from wallet account entries. |
| Diamond sender | LIVE-VERIFIED | One corrected controlled request used agency currency `1835`, returned `code === 1`, and the wallet decreased by exactly the sent amount. The historical pre-fix wallet-selected `1805` request returned `-500` with no debit; its meaning remains UNKNOWN and it does not downgrade Diamond's live-verified status. |
| Crystal sender | LIVE-VERIFIED | One authorized controlled Crystal request used the fixed `1826` currency, returned `code === 1`, and the wallet balance decreased by exactly the sent amount. The isolated preflight mirrors the confirmed browser-submit checks: normalized Crystal balance, positive agency `transferMax` when supplied, and the bundle's inverted `transfer_currency_to_other` predicate (it blocks only a present `status === 1`). Every additional send remains independently guarded by both environment flags, `X-Controlled-Mutation: true`, a valid idempotency key, and an authorized amount ceiling. |
| Nobility read-only transport | LIVE-VERIFIED | Authorized read-only verification completed VID resolution, `ListAllNobleConf`, `GetUserNoble`, config parsing, and current-state parsing once. The yMicro simple-RPC POST uses `/ymicro/sapi`, metadata query fields, `text/plain` JSON body, authenticated session cookies, numeric body sequence, and numeric GetUserNoble UID. |
| Nobility purchase readiness diagnostic | LIVE-VERIFIED | Strictly read-only composition of the live-verified session, VID, Noble config/state, and legacy Diamond wallet boundaries. It derives current cost and technical eligibility without a transaction intent or mutation call. |
| Nobility config/state/payload | CONFIRMED | `ListAllNobleConf({ os_type: "android" })`, `GetUserNoble({ uid })`, purchase/renew selection, config-derived `total_rebate_diamond` and `turnover_pack_id`, and ordered `BuyNobleByAgency` logical payload are isolated in local-only code. |
| Nobility sender | PRODUCTION ENABLED WHEN `HAGO_NOBILITY_ENABLED=true` / FIRST LIVE FINANCIAL OUTCOME PENDING | Fresh preflight, one-shot persistence, idempotency, and a source-confirmed builder are implemented. `BuyNobleByAgency` has no live financial verification. |
| Diamond success | LIVE-VERIFIED | One controlled Diamond request returned `code === 1` and the wallet decreased by exactly the sent amount. No authoritative reference or duplicate/retry semantics are proven. |
| Crystal duplicates/reconciliation and Nobility success | UNKNOWN | Crystal is LIVE-VERIFIED once, but duplicate/retry/reconciliation semantics are still not live-proven. Nobility has no live financial mutation verification. The local reconciliation helper is read-only and never auto-confirms an unknown outcome. Account history remains non-authoritative. |
| Transfer readiness diagnostic | CONFIRMED structure | Read-only session, agency, permissions, `has_psw`, and wallet boundary. It separates agency currency, effective transfer currency, and legacy/new wallet availability. Permission statuses remain raw numeric values; no password or transfer endpoint is used. |

## Session architecture

```text
trusted caller supplies phone countryCode -> signed sendCode
trusted caller supplies the same account's stable deviceId -> SMS boundary
successful upstream smsAuth (LIVE-VERIFIED once)
  -> use complete response Set-Cookie values for hagouid + uaasCookie when present
  -> otherwise derive browser-equivalent hagouid + uaasCookie from s_session / s_t
  -> store hagouid as hagoUid, store h_open_id separately as hOpenId, and encrypt cookie material on that User only
  -> select those secret fields only for that account's read-only call
```

`uaasCookie` is never logged or returned from an API response. New persisted cookie material uses `enc:v1:<iv-base64>:<tag-base64>:<ciphertext-base64>` AES-256-GCM envelopes. Legacy plaintext records are transitional read-only compatibility and are replaced by encrypted values when authentication succeeds again. `s_session`, `s_t`, OTP material, OTP digest, and `sSessionKey` remain ephemeral and are never persisted. Session encryption at rest is implemented; production still needs an external secret manager, key rotation strategy, and controlled operational key handling. Country/language for turnover are stored as non-secret locale metadata only when supplied by the trusted caller; environment values are fallbacks.

Identity compatibility is also non-destructive: legacy records that stored `h_open_id` as `hagoUid` derive the active internal UID from decrypted `hagouid` for every read-only call. Agent-profile lookup then backfills `hagoUid` with that authenticated UID. A re-login is required only when session cookie material is unavailable, cannot decrypt, or is rejected.

The controlled run exposed the previous `h_open_id`-as-UID defect: it is UAAS identity metadata, not the authenticated internal account UID. The correction retains it separately as `hOpenId` and uses authenticated `hagouid` for yMicro and turnover. A user-visible VID is a third identifier and must resolve to `infos[0].uid`. No real identifiers are documented.

## Controlled mutation readiness and reconciliation

Diamond and Crystal default to `UNKNOWN` / `NOT_SENT` / `503` unless all one-shot guards are supplied. Diamond is LIVE-VERIFIED once: the corrected request used agency currency `1835`, returned `code === 1`, and the wallet decreased by exactly the sent amount. Crystal is LIVE-VERIFIED once: one authorized controlled request used fixed currency `1826`, returned `code === 1`, and the wallet decreased by exactly the sent amount. All of `HAGO_MUTATIONS_ENABLED=true`, `HAGO_CONTROLLED_MUTATION_MODE=true`, a valid `HAGO_CONTROLLED_MUTATION_MAX_AMOUNT`, `X-Controlled-Mutation: true`, and a valid `Idempotency-Key` remain required before any subsequent Diamond or Crystal sender can be reached. The adapter resolves VID to target UID, decrypts the per-account session, then selects Diamond wire currency from confirmed `query_agency_info.currencyType` (`1805` or `1835`) or defaults to `1805`; wallet availability does not choose the Diamond wire currency. For `1835`, the bundle-confirmed minimum is `200` and lower values fail locally with `DIAMOND_MIN_AMOUNT` before `transfer_account`. Crystal uses fixed currency `1826`; it does not use `agencyInfo.currencyType` or the Diamond-New minimum. Its dedicated AmountField accepts only a positive whole-number amount of up to seven digits. Its separate preflight mirrors the bundle's inverted transfer predicate: it blocks only if `transfer_currency_to_other` is present with `status === 1`, then checks normalized Crystal balance and positive `agencyInfo.transferMax` when supplied. The broader permission semantics are UNKNOWN. The `recharge_crystal` whitelist controls bundle UI support/visibility and is not used by the transfer-submit predicate. No Crystal minimum is inferred. It persists `PENDING` / `SEND_PENDING` only for a prepared send, then makes at most one bounded request. Neither target UID nor `seqId` is persisted or logged.

Historical evidence: a pre-fix Diamond attempt used wallet-selected `1805`, returned numeric code `-500`, and had no observed debit. Subsequent capture evidence identified the agency-currency parity defect. A corrected controlled Diamond request then used `1835`, returned `code === 1`, and reduced the wallet by exactly the sent amount. The exact semantic meaning of historical `-500` remains UNKNOWN. Account history may remain empty and is not an authoritative settlement ledger.

Nobility read-only and purchase readiness are LIVE-VERIFIED once. `POST /api/bot/nobility-readiness` completed VID resolution, config retrieval/parsing, and current-state retrieval/parsing without a financial action. `POST /api/bot/nobility-purchase-readiness` is a separate strictly read-only final gate: it validates the stored session, refreshes target/config/state/legacy-Diamond data, derives the browser-confirmed purchase-or-renew selection and current cost, and reports only sanitized technical eligibility. It creates no transaction intent and is not an authorization to purchase. The Nobility production boundary revalidates session and refetches configuration, current state, and legacy Diamond balance immediately before every potential sender call. It derives purchase versus renew, price, turnover pack ID, and numeric buyer UID internally; none are accepted from the caller. Lower-level selection and browser warning-required changes block locally because this API has no implicit confirmation path. `HAGO_NOBILITY_ENABLED=true` and an idempotency key are required; no controlled-test header or Diamond ceiling applies. The builder uses ordered `noble_type`, `buy_type`, `buyer_uid`, `diamond`, `turnover_pack_id`, `app_name`. `BuyNobleByAgency` is PRODUCTION ENABLED when the operator switch is true, but its first live financial outcome is pending.

Current local state semantics are: `NOT_SENT` means this adapter has not issued an upstream mutation request, and `SEND_PENDING` records the durable one-shot boundary immediately before a send. `SUCCESS`, `FAILED`, and `UNKNOWN` are assigned only by the confirmed protocol normalizer for the relevant service. No reference is fabricated: `referenceId` remains `null` unless future evidence supplies an authoritative value. A timeout or network ambiguity becomes `UNKNOWN` / `MUTATION_OUTCOME_UNKNOWN` and is never retried.

Diamond and Crystal use the shared `transfer_account` protocol: `code === 1` is `SUCCESS`; bundle-confirmed numeric rejection classes (`-401`, `-76`, and other numeric rejection codes) are `FAILED`; missing, non-numeric, malformed, timeout, or network-ambiguous results are `UNKNOWN` and are never retried.

Nobility uses the distinct `BuyNobleByAgency` protocol: `is_ok === true` is `SUCCESS`; only confirmed codes `30201` and `30500` are `FAILED`; unconfirmed numeric or business codes, malformed responses, and timeout or network ambiguity are `UNKNOWN` and are never retried.

`POST /api/bot/transfer-readiness` is strictly read-only. It first normalizes session status, then—only for `VALID` sessions—queries `query_agency_info`, `permissions`, `has_psw`, and the existing wallet boundary. It reports `agencyDiamondCurrency`, `effectiveTransferCurrency`, and independent legacy/new wallet availability instead of collapsing those concepts. `isAgency`, direct numeric `transferMax`, and `has_psw` code `1` are reported where supplied. Permission entries are reported only as presence plus raw numeric `status`; their allow/deny semantics are not inferred. `has_psw` code `0` and an absent transfer permission do not establish why `-500` occurred. It never calls `verify_psw`, `set_pay_psw`, or `transfer_account`.

`POST /api/bot/transactions/reconcile` is a manual read-only helper for attempted unknown records. It can return normalized wallet/history observations but never changes the transaction state because exact transaction-reference correlation is still unknown. Account history is not an authoritative settlement ledger.

## Local and controlled verification

`npm test` runs without live Hago access. Tests cover canonical signatures, UUID shape, exact SMS `ts` compatibility, binary-key rejection, UAAS response rules, device-ID fail-closed behavior, session validation status normalization, encrypted-session decode failure, cookie extraction/isolation, turnover vectors, normalized wallet parsing, currency constants, VID-to-UID mapping, profile parsing, bounded history multipart signing, mutation builder shape, mutation deduplication/conflict handling, mutation blocking, API-key authentication, timeout normalization, and response-secret checks. Separately, the authorized controlled run LIVE-VERIFIED authentication, session validation, VID lookup, agent profile, wallet, and history once.

## Next phase

Authentication, read-only operations, Diamond, and Crystal are LIVE-VERIFIED once. Nobility financial mutation is production-enabled only when `HAGO_NOBILITY_ENABLED=true`, with one-shot recording and no automatic retry; its first live financial outcome remains pending.

## API contract exposure

`docs/openapi.json` is the route-derived OpenAPI 3.0.3 contract for all current endpoints. `GET /docs` serves its local Swagger UI and `GET /openapi.json` serves the raw contract; neither route calls Hago. They are enabled by default outside production and are disabled in production unless `SWAGGER_ENABLED=true`. Legacy `/api` operations declare `ApiKeyAuth` (`x-internal-api-key`); V2 operations declare `ClientApiKeyAuth` (`x-client-api-key`); `/health` and `/ready` explicitly declare no security.
