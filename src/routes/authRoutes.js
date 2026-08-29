const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const otpRateLimit = require("../middleware/otpRateLimit");

router.post("/send-otp", otpRateLimit, authController.sendOtp);
router.post("/verify-otp", otpRateLimit, authController.verifyOtp);

module.exports = router;
