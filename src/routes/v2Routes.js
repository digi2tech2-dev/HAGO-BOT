const express = require("express");
const controller = require("../controllers/v2Controller");
const { requireOwnedConnection } = require("../middleware/tenantAuthorization");

const router = express.Router();

router.post("/login-challenges", controller.sendOtp);
router.post("/login-challenges/:challengeId/verify", controller.verifyOtp);

const connection = requireOwnedConnection({ includeSession: true });
router.post("/connections/:connectionId/session/validate", connection, controller.validateSession);
router.post("/connections/:connectionId/verify-id", connection, controller.verifyId);
router.post("/connections/:connectionId/agent-profile", connection, controller.agentProfile);
router.post("/connections/:connectionId/wallet-balance", connection, controller.wallet);
router.post("/connections/:connectionId/account-history", connection, controller.history);
router.post("/connections/:connectionId/transfer-readiness", connection, controller.transferReadiness);
router.post("/connections/:connectionId/nobility-readiness", connection, controller.nobilityReadiness);
router.post("/connections/:connectionId/nobility-purchase-readiness", connection, controller.nobilityPurchaseReadiness);
router.post("/connections/:connectionId/previews/diamond", connection, controller.previewDiamond);
router.post("/connections/:connectionId/previews/crystal", connection, controller.previewCrystal);
router.post("/connections/:connectionId/previews/nobility", connection, controller.previewNobility);
router.post("/connections/:connectionId/auto-recharge/diamond", connection, controller.rechargeDiamond);
router.post("/connections/:connectionId/auto-recharge/crystal", connection, controller.rechargeCrystal);
router.post("/connections/:connectionId/auto-recharge/nobility", connection, controller.buyNobility);
router.post("/connections/:connectionId/transactions", connection, controller.transactions);
router.post("/connections/:connectionId/transactions/reconcile", connection, controller.reconcile);

module.exports = router;
