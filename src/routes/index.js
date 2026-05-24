const express    = require("express");
const rateLimiter = require("../middleware/rateLimiter");

const router = express.Router();

// ─── Public Route — strict limit ────────────────────────────────────────────
router.get(
  "/public",
  rateLimiter({ algorithm: "fixedWindow", maxRequests: 10, windowMs: 60000 }),
  (req, res) => {
    res.json({ message: "Public endpoint — 10 req/min limit", ip: req.ip });
  }
);

// ─── API Route — token bucket (allows short bursts) ─────────────────────────
router.get(
  "/api/data",
  rateLimiter({ algorithm: "tokenBucket", maxRequests: 50, windowMs: 60000 }),
  (req, res) => {
    res.json({ message: "API data endpoint — token bucket", data: { value: 42 } });
  }
);

// ─── Login Route — tightest limit (brute force protection) ──────────────────
router.post(
  "/login",
  rateLimiter({
    algorithm:   "slidingWindowCounter",
    maxRequests: 5,
    windowMs:    60000,
    keyGenerator: (req) => `login:${req.ip}`,   // separate namespace
  }),
  (req, res) => {
    res.json({ message: "Login route — 5 attempts/min" });
  }
);

// ─── Status — see your current limits (no rate limiting) ────────────────────
router.get("/status", (req, res) => {
  res.json({
    message: "Rate Limiter is running",
    algorithms: ["fixedWindow", "tokenBucket", "slidingWindowCounter"],
    ip: req.ip,
  });
});

module.exports = router;
