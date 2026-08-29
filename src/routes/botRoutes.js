const express = require("express");
const router = express.Router();
const botController = require("../controllers/botController");

router.post("/verify-id", botController.verifyUser);
router.post("/wallet-balance", botController.getBalance);
router.post("/account-history", botController.getAccountHistory);
router.post("/session/validate", botController.validateSession);
router.post("/transfer-readiness", botController.getTransferReadiness);
router.post("/nobility-readiness", botController.getNobilityReadiness);
router.post("/nobility-purchase-readiness", botController.getNobilityPurchaseReadiness);
router.post("/auto-recharge/diamond/preview", botController.previewDiamondMutation);
router.post("/auto-recharge/crystal/preview", botController.previewCrystalMutation);
router.post("/auto-recharge/nobility/preview", botController.previewNobilityMutation);
router.post("/auto-recharge/diamond", botController.rechargeDiamond);
router.post("/auto-recharge/crystal", botController.rechargeCrystal);
router.post("/auto-recharge/nobility", botController.buyNobility);
router.post("/agent-profile", botController.getAgentProfile);
router.post("/transactions", botController.getAgentTransactions);
router.post("/transactions/reconcile", botController.reconcileMutation);

module.exports = router;
