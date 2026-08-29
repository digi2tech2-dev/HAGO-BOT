# Codebase Audit Observations (historical pre-recovery findings)

> Some findings below describe code that has since been changed. The implementation status and remaining protocol gaps are maintained in [Integration Recovery](INTEGRATION_RECOVERY.md).

This is a documentation-only, static audit of the tracked executable source. Findings do not alter behavior. Severity represents likely confidentiality, integrity, availability, or operational impact if the observed code is used as-is; it is not a claim that exploitation or external API success was demonstrated.

## Summary

| Severity | Count |
| --- | ---: |
| Critical | 1 |
| High | 3 |
| Medium | 7 |
| Low | 4 |
| Informational | 4 |

## Critical

### Source-embedded credential-like external session/signing material

**Evidence:** `src/services/hagoService.js:8-12`, `34-38`, `99-112`, `157-178`, `226-254`, `340-366`, `396-426` include literal external request templates, signing material, cookie headers, and agent/account-like identifiers.

**Observation:** sensitive external authentication/session/signing data is present in tracked source rather than configuration/secrets management. It is reused across multiple outbound requests and some service parameters carrying a stored user session are ignored. Values are deliberately not reproduced in this document.

**Impact:** a source reader may obtain material usable for external requests; rotation/revocation and auditability are impaired. The repository itself cannot confirm the current validity of the material.

## High

### API operations have no authentication or authorization

**Evidence:** `server.js:12-16` registers only JSON parsing and routes; every endpoint in `src/routes/*.js` is directly mounted. Controllers accept `agentPhone` from the request and look up the matching stored `User` without identifying the caller.

**Observation:** any network client that can reach the API can request OTPs, view locally stored transactions by phone, query agent data, and attempt transfer/purchase flows. There is no bearer token, API key, session, admin check, Telegram identity binding, or rate limiter.

### Telegram and Postman auto-recharge route is unmounted

**Evidence:** `src/bot.js:129` and `postman.json` use `/api/bot/auto-recharge`; `src/routes/botRoutes.js:7-9` only mounts the three suffixed routes.

**Observation:** the Telegram recharge UI invokes a route that does not exist, so it cannot reach diamond recharge through current routing. The same stale route is present in Postman.

### `npm start` does not start Telegram bot

**Evidence:** `package.json` has only `start: node server.js`; `server.js` does not import `src/bot.js`.

**Observation:** a deployment using only the documented package start command runs Express but not Telegram polling. The bot must be separately executed and assumes local API port 3000.

## Medium

### Crystal/nobility success checks inspect a missing property

**Evidence:** crystal/nobility services return external payload in `result` (`src/services/hagoService.js:368-372`, `428-432`); controllers inspect `result.data?.code` (`src/controllers/botController.js:157-160`, `225-228`).

**Observation:** because `result.data` is absent on the returned service object, `!result.data?.code` is true for an Axios-level success. A payload-level external error may therefore be recorded/reported as local success. External payload behavior was not tested.

### Stored agent session is not used by outbound request construction

**Evidence:** controllers pass `agent.userToken` to wallet/recharge/profile service calls (`src/controllers/botController.js:54-57`, `88-93`, `151-155`, `219-223`, `279-282`); the corresponding service functions do not reference their `agentSession` parameter when assembling headers/URLs.

**Observation:** user-specific login data is used as a presence gate but outbound Hago requests use literal source headers/session material instead. This makes per-agent session behavior unclear and couples requests to static data.

### No timeout or retry policy for external requests

**Evidence:** all Axios calls in `src/services/hagoService.js` omit `timeout`; no retry/interceptor/client configuration exists.

**Observation:** a slow/unresponsive external host can keep request handlers pending according to Axios/Node defaults. No bounded retry or cancellation behavior is implemented.

### Inconsistent or incomplete async error handling

**Evidence:** only `sendOtp` and `getAgentTransactions` have controller `try/catch` (`authController.js:12-40`, `botController.js:306-323`); other async controller functions await database/service calls without local catch. `server.js` has no error middleware.

**Observation:** error status/body format is inconsistent. Unexpected failures can flow to Express's default handler rather than the JSON convention used by explicit code paths.

### Pending OTP state has no expiration, rate limit, or persistence

**Evidence:** module-global `pendingOtps` map in `src/controllers/authController.js:4`, written at 19 and checked at 49; timestamp is never read or cleaned up.

**Observation:** pending entries survive until verification or process exit, not an OTP TTL. State is lost on restart and unavailable across multiple server instances.

### Sensitive/PII-like upstream output is logged

**Evidence:** `authController.js:16` logs the send-OTP result; `hagoService.js:180` logs complete Hago user-info response; `botController.js:14` logs phone and operation detail.

**Observation:** logs may include phone numbers, Hago data, and upstream response content. The exact contents depend on external responses and were not retrieved during audit.

### Bot/API response contracts disagree for balance

**Evidence:** API returns `walletData` (`botController.js:59-64`); bot reads `response.data.balance` (`bot.js:193`).

**Observation:** on a successful API request the bot may render an undefined balance instead of the normalized wallet data.

## Low

### Declared Puppeteer dependency is unused

**Evidence:** `package.json` declares `puppeteer`; repository source has no import/reference except dependency metadata. Installed package metadata has an install script and Node engine requirement.

**Observation:** it adds install/runtime surface without an active code path. No browser automation exists to justify it in current source.

### Unused imports and fields

**Evidence:** `authController.js:3` imports `message` from `telegraf/filters` but never uses it; `botController.js:6` imports `getTargetUidByVid` but never calls it directly; `User.cookies` and `Transaction.errorMessage` are declared but have no current read/write path.

### No database indexes for transaction lookup pattern

**Evidence:** `getAgentTransactions` runs `find({ agentPhone }).sort({ createdAt: -1 })` (`botController.js:308-310`); `TransactionSchema` declares no indexes.

**Observation:** the most visible list query has no supporting declared compound index. Actual data size and production index state are not confirmed.

### Origin/Referer values are malformed in several requests

**Evidence:** service request headers at `hagoService.js:110-111`, `176-177`, `252-253`, `364-365`, and `424-425` use Markdown-formatted strings rather than normal URL header values.

**Observation:** those request headers likely differ from intended browser headers. External acceptance is not confirmed.

## Informational

### No scheduled jobs or browser automation

**Evidence:** source search finds no `setInterval`, `setTimeout`, cron library, Puppeteer import, or browser lifecycle calls.

### Console notification is not a delivery integration

**Evidence:** `sendAgentNotification` in `botController.js:13-15` only calls `console.log`.

**Observation:** its name/comments may imply agent notification, but no Telegram/HTTP/email delivery occurs from this helper.

### Transaction model has states that current writers do not use

**Evidence:** schema permits `PENDING`, `SUCCESS`, `FAILED` and `errorMessage`; current three creation paths only save `SUCCESS` and none update records after creation.

### Postman coverage is partial

**Evidence:** five requests exist in `postman.json`; nine routes are mounted. Details are in [API.md](API.md#postman-collection-verification).

## Searches and reachability checks

- Searched all tracked JavaScript source for `TODO`, `FIXME`, `HACK`, `XXX`: no matches.
- Searched for `setInterval`, `setTimeout`, cron use: no matches.
- Searched for Puppeteer usage: no source imports/references; it is package-only.
- All route exports in `authRoutes.js` and `botRoutes.js` are mounted by `server.js`.
- `src/bot.js` is a tracked executable-like script but is not reachable from `npm start` or the Express import graph.
- Both declared Mongoose models are referenced by controllers. There are no unused model files.

## Security posture as implemented

Implemented controls are limited to JSON parsing, simple truthiness checks, Mongoose schema constraints/enums, an in-memory pending-OTP prerequisite, and bot state checks. There is no implemented HTTP identity/authentication, authorization, input format validation, rate limiting, CORS policy, request sanitization, session encryption, secret manager, webhook verification, CSRF mechanism, or audit log. These are factual absences from the repository, not recommendations implemented by this audit.
