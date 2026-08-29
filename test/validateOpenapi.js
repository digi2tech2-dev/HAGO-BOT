const assert = require("node:assert/strict");
const fs = require("node:fs");

const spec = JSON.parse(fs.readFileSync("docs/openapi.json", "utf8"));
const expectedPaths = new Set([
  "/health", "/ready", "/api/auth/send-otp", "/api/auth/verify-otp",
  "/api/bot/session/validate", "/api/bot/verify-id", "/api/bot/agent-profile",
  "/api/bot/transfer-readiness", "/api/bot/nobility-readiness", "/api/bot/nobility-purchase-readiness",
  "/api/bot/wallet-balance", "/api/bot/account-history", "/api/bot/transactions", "/api/bot/transactions/reconcile",
  "/api/bot/auto-recharge/diamond/preview", "/api/bot/auto-recharge/crystal/preview", "/api/bot/auto-recharge/nobility/preview",
  "/api/bot/auto-recharge/diamond", "/api/bot/auto-recharge/crystal", "/api/bot/auto-recharge/nobility",
]);

assert.equal(spec.openapi, "3.0.3");
assert.deepEqual(new Set(Object.keys(spec.paths)), expectedPaths);
assert.deepEqual(spec.components?.securitySchemes?.ApiKeyAuth, { type: "apiKey", in: "header", name: "x-internal-api-key" });
for (const [path, item] of Object.entries(spec.paths)) {
  const operation = item.get || item.post;
  assert.ok(operation, `${path} needs an operation`);
  if (path === "/health" || path === "/ready") assert.deepEqual(operation.security, []);
  else assert.deepEqual(operation.security, [{ ApiKeyAuth: [] }], `${path} must use ApiKeyAuth`);
}
const diamond = spec.paths["/api/bot/auto-recharge/diamond"].post;
const crystal = spec.paths["/api/bot/auto-recharge/crystal"].post;
for (const operation of [diamond, crystal]) {
  assert.equal(operation.parameters.some((item) => item.$ref === "#/components/parameters/IdempotencyKey"), true);
  assert.equal(operation.parameters.some((item) => item.$ref === "#/components/parameters/ControlledMutation"), true);
}
const nobility = spec.paths["/api/bot/auto-recharge/nobility"].post;
assert.equal(nobility.parameters.some((item) => item.$ref === "#/components/parameters/IdempotencyKey"), true);
assert.equal(nobility.parameters.some((item) => item.$ref === "#/components/parameters/ControlledMutation"), false);
const nobilitySchema = spec.components.schemas.NobilityRechargeRequest;
assert.deepEqual(nobilitySchema.required, ["agentPhone", "targetId", "nobilityType"]);
assert.equal(nobilitySchema.additionalProperties, false);
for (const forbidden of ["diamond", "price", "turnover_pack_id", "buy_type", "buyer_uid"]) assert.equal(Object.hasOwn(nobilitySchema.properties, forbidden), false);
assert.match(JSON.stringify(spec), /ApiKeyAuth/);
assert.doesNotMatch(JSON.stringify(spec), /(?:uaasCookie|hagouid=|BEGIN PRIVATE|mongodb:\/\/[^<])/i);

console.log("OpenAPI contract valid");
