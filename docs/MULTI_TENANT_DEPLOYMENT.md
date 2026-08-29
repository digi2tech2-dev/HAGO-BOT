# Multi-tenant V2 production deployment runbook

This runbook is for an operator performing the separately approved production deployment. It is not a deployment script and must not be run against an unreviewed environment.

## Scope and safety gates

V1 remains available through `x-internal-api-key`. V2 uses only `x-client-api-key`; neither header authenticates the other route family. Do not enable V2 financial traffic until the index migration has been backed up, rehearsed, applied, and verified.

The index migration changes only indexes on `transactions`; it never assigns legacy records to a Client or Connection. Existing V1 `User` and `Transaction` records remain legacy/V1-only and are intentionally inaccessible to V2. Do not infer ownership from phone numbers, Hago identifiers, targets, or timestamps. Any future legacy ownership assignment requires an explicit operator-approved mapping project.

## Required production configuration

Set these through the production secret manager or protected service environment, never through source control:

| Variable | Requirement | Startup effect if absent/invalid |
| --- | --- | --- |
| `MONGO_URI` | MongoDB connection string; secret | Application cannot start. |
| `INTERNAL_API_KEY` | Existing non-empty V1 backend secret | Application cannot start; V1 remains dependent on it. |
| `HAGO_SESSION_ENCRYPTION_KEY` | Base64 for exactly 32 bytes; secret | Application cannot start. Preserve it during rollback because it decrypts existing sessions. |
| `MULTI_CLIENT_AUTH_ENABLED` | Set `true` only after the V2 secrets and index migration are ready | When not `true`, V2 routes return disabled/not available. |
| `CLIENT_API_KEY_PEPPER` | Independent Base64 for exactly 32 bytes; secret | Startup fails when V2 is enabled; also required by the operator CLI. Rotating it invalidates all existing Client API Keys unless a controlled dual-pepper migration is added. |
| `CLIENT_DATA_ENCRYPTION_KEY` | Independent Base64 for exactly 32 bytes; secret | Startup fails when V2 is enabled. Rotating it requires a planned re-encryption migration for V2 challenge/connection protected data. |
| `HOST` | Keep `127.0.0.1` behind Nginx | Defaults to loopback; never default to `0.0.0.0`. |
| `PORT` | Positive integer, normally the existing local port | Startup fails if invalid. |
| `HAGO_REQUEST_TIMEOUT_MS` | Positive integer; default `15000` | Startup fails if invalid. |
| `SWAGGER_ENABLED` | Set `false` for normal production posture unless public API documentation is explicitly required | Swagger is disabled by default in production when unset. |

Keep existing financial flags unchanged unless separately authorized:

- Diamond and Crystal require `HAGO_MUTATIONS_ENABLED=true`, `HAGO_CONTROLLED_MUTATION_MODE=true`, a positive `HAGO_CONTROLLED_MUTATION_MAX_AMOUNT`, the request header `X-Controlled-Mutation: true`, and `Idempotency-Key`.
- Nobility is independent and requires `HAGO_NOBILITY_ENABLED=true` plus `Idempotency-Key`.
- A Client API Key never bypasses these guards.

## Transaction index migration

Desired final `transactions` index state:

| Index | Purpose |
| --- | --- |
| `legacy_idempotency_key_unique` | Unique `{ clientId: 1, idempotencyKey: 1 }` only where `clientId: null`; this retains global V1 uniqueness for legacy/unassigned records. |
| `client_idempotency_key_unique` | Unique `{ clientId: 1, idempotencyKey: 1 }` only where `clientId` exists; Client A and Client B may each use the same idempotency value. |

The historical **unique** global `idempotencyKey_1` index prevents cross-client duplicate keys and must be replaced before V2 financial traffic is enabled. A past schema declaration could also create a distinct **non-unique sparse** `idempotencyKey_1`; it is redundant because the two compound indexes above provide the required constraints. The migration script is dry-run by default, detects duplicate legacy or tenant records before any index change, creates only the named target indexes, and drops only either exact recognized single-field index definition. It does not modify transaction documents or unrelated indexes.

Use a short maintenance window. Although modern MongoDB can build indexes with limited blocking, this migration has an unavoidable period after removing the global index and before both scoped unique indexes exist. Pause V2 financial requests and V1 transaction creation during the operation. Back up MongoDB first and verify the backup independently.

### Operator sequence

Run these from the deployed application directory with secrets already supplied by the protected service environment. Do not print or copy secret values.

```bash
# A. Record and verify a backup. Choose a protected backup destination.
mongodump --uri "$MONGO_URI" --archive="/secure-backups/hago-before-v2-indexes.archive.gz" --gzip

# B. Inspect current transaction indexes without revealing credentials.
mongosh "$MONGO_URI" --quiet --eval 'db.transactions.getIndexes().map(i => ({name:i.name,key:i.key,unique:!!i.unique,partialFilterExpression:i.partialFilterExpression || null}))'

# C. Dry run: this must report duplicates: { legacy: 0, tenant: 0 } and any
# recognized historicalGlobalIndex or redundantSparseIndex. It changes nothing.
npm run migrate:prompt3-indexes

# D. During the approved maintenance window only, apply once.
npm run migrate:prompt3-indexes -- --apply

# E. Verify the final index names and definitions.
mongosh "$MONGO_URI" --quiet --eval 'db.transactions.getIndexes().map(i => ({name:i.name,key:i.key,unique:!!i.unique,partialFilterExpression:i.partialFilterExpression || null}))'
```

If dry run reports duplicate records or an index-definition conflict, stop. Do not drop any index manually and do not enable V2 financial traffic. Investigate from the verified backup and prepare a separate remediation plan.

### Index rollback

Only roll back indexes before allowing V2 cross-client duplicate idempotency values. A historical global unique `idempotencyKey_1` index cannot be recreated while Client A and Client B have the same idempotency key. Do not delete transaction data to force a rollback.

If no such V2 duplicates exist and a rollback is approved, recreate the historical unique index only after dropping the two named scoped indexes in a maintenance window. Code rollback does not require deleting `Client`, `ClientApiKey`, `LoginChallenge`, `Connection`, or lock records; simply set `MULTI_CLIENT_AUTH_ENABLED=false` and restart the prior compatible release.

## Deployment order

1. Validate the release artifact locally (`npm ci`, tests, OpenAPI validation) and verify the deployed commit.
2. Back up MongoDB and schedule a short maintenance window for transaction writes.
3. Deploy code while leaving `MULTI_CLIENT_AUTH_ENABLED=false`; keep all existing financial flags unchanged.
4. Install the locked production dependency set using the existing deployment pattern, normally `npm ci --omit=dev`.
5. Place the two new V2 secrets in the secret manager: independently generated Base64 32-byte `CLIENT_API_KEY_PEPPER` and `CLIENT_DATA_ENCRYPTION_KEY`. Preserve existing secrets.
6. Run the index dry run, then the approved apply and verification commands above.
7. Set `MULTI_CLIENT_AUTH_ENABLED=true` only after the index verification succeeds.
8. Reload the existing PM2 process with its protected environment, for example `pm2 reload <app-name> --update-env`.
9. Verify localhost health/readiness, then HTTPS health/readiness. Do not expose another Node or MongoDB port; Nginx remains the public HTTPS boundary and Node remains loopback-bound.
10. Create the first Client and key, configure the consuming backend, and perform API-key-only validation before any approved Hago login or financial workflow.

## Client bootstrap and rotation

The operator CLI is local/server-side only and never calls Hago:

```bash
npm run client-admin -- create-client --name "Website A"
# The following command intentionally displays a newly generated Client API key once.
npm run client-admin -- create-key --client cli_<public-id> --label production
npm run client-admin -- rotate-key --client cli_<public-id> --label rotation
npm run client-admin -- revoke-key --key <old-key-id> --confirm
```

Deliver the newly generated key once through an approved secret channel to the website backend. Configure that backend with `HAGO_API_BASE_URL` and `HAGO_API_KEY`; never place the Client API key in browser code. Rotation overlap is supported: create a new active key, move the backend, validate it, then revoke the old key. Disable a client or key with the CLI if an integration must be stopped.

## V1 to V2 transition

1. Keep V1 and `INTERNAL_API_KEY` active.
2. Create the Client for the current trusted backend and issue its first Client API Key.
3. Move the backend to `/api/v2` and `x-client-api-key`.
4. For each authorized Hago account, perform V2 login to obtain a tenant-owned opaque `connectionId`.
5. Validate V2 API-key behavior and non-financial connection routes first.
6. Keep legacy V1 records quarantined/V1-only until a separately approved ownership mapping and V1 retirement plan exists.

## Post-deployment checks

```bash
pm2 status
curl --fail --silent --show-error http://127.0.0.1:<port>/health
curl --fail --silent --show-error http://127.0.0.1:<port>/ready
curl --fail --silent --show-error https://<public-host>/health
curl --fail --silent --show-error https://<public-host>/ready
curl --fail --silent --show-error http://127.0.0.1:<port>/openapi.json
pm2 logs <app-name> --lines 100
```

With credentials supplied only from the operator's protected environment, verify that an invalid V2 key returns a normalized authentication failure, a valid Client key can reach a non-financial V2 route, and a Client A request using a Client B opaque resource identifier returns the same safe not-found behavior as a guessed identifier. Do not print header values, connection IDs, OTPs, cookies, or sessions in logs or tickets.

## Live Hago verification policy

This deployment runbook performs no Hago action. After infrastructure checks, obtain a new explicit approval for each progression: API-key authentication only; client creation; V2 OTP for an authorized account; V2 read-only calls; then any financial operation only under the existing service-specific gates. `UNKNOWN` outcomes and `UNKNOWN_HOLD` are never retried automatically; only the local operator CLI can clear a hold after independent manual review.
