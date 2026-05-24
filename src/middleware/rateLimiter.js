const fixedWindow         = require("../algorithms/fixedWindow");
const tokenBucket         = require("../algorithms/tokenBucket");
const slidingWindowCounter = require("../algorithms/slidingWindowCounter");

const ALGORITHMS = {
  fixedWindow,
  tokenBucket,
  slidingWindowCounter,
};

/**
 * Rate Limiter Middleware Factory
 *
 * Usage:
 *   app.use(rateLimiter())                          // defaults
 *   app.use(rateLimiter({ algorithm: 'tokenBucket', maxRequests: 50 }))
 *
 * Options:
 *   algorithm    - 'fixedWindow' | 'tokenBucket' | 'slidingWindowCounter'
 *   maxRequests  - max requests allowed per window
 *   windowMs     - window size in milliseconds
 *   keyGenerator - fn(req) → string  (custom client ID)
 */
function rateLimiter(options = {}) {
  const {
    algorithm    = "slidingWindowCounter",
    maxRequests  = parseInt(process.env.DEFAULT_MAX_REQUESTS) || 100,
    windowMs     = parseInt(process.env.DEFAULT_WINDOW_MS)    || 60000,
    keyGenerator = (req) => req.ip,                          // default: by IP
  } = options;

  if (maxRequests < 1) {
    throw new Error(`maxRequests must be >= 1, got ${maxRequests}`);
  }
  if (windowMs < 1000) {
    throw new Error(`windowMs must be >= 1000ms, got ${windowMs}`);
  }
  if (typeof keyGenerator !== "function") {
    throw new Error("keyGenerator must be a function");
  }

  const limitFn = ALGORITHMS[algorithm];
  if (!limitFn) {
    throw new Error(`Unknown algorithm: "${algorithm}". Choose from: ${Object.keys(ALGORITHMS).join(", ")}`);
  }

  return async (req, res, next) => {
    const clientId = keyGenerator(req);

    try {
      const result = await limitFn(clientId, { maxRequests, windowMs });

      // Set standard rate limit headers
      res.set({
        "X-RateLimit-Limit":     maxRequests,
        "X-RateLimit-Remaining": result.remaining,
        "X-RateLimit-Reset":     result.resetAfter,
        "X-RateLimit-Algorithm": algorithm,
      });

      if (!result.allowed) {
        res.set("Retry-After", String(Math.ceil(result.resetAfter)));
        return res.status(429).json({
          error:      "Too Many Requests",
          retryAfter: result.resetAfter,
          message:    `Rate limit exceeded. Try again in ${result.resetAfter}s`,
        });
      }

      next();
    } catch (err) {
      console.error("Rate limiter error:", err);
      next(); // fail open — don't block request if limiter crashes
    }
  };
}

module.exports = rateLimiter;
