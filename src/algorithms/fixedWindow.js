const redis = require("../config/redis");

/**
 * Fixed Window Counter Algorithm
 *
 * How it works:
 * - Divides time into fixed windows (e.g. every 60s)
 * - Counts requests in current window
 * - Resets counter when window expires
 *
 * Weakness: Boundary spike — a user can fire 2x requests
 * right around the window reset edge.
 */
async function fixedWindowCounter(clientId, options = {}) {
  const { maxRequests = 100, windowMs = 60000 } = options;

  const windowSeconds = Math.floor(windowMs / 1000);

  // Key is tied to the current time window
  const windowKey = Math.floor(Date.now() / windowMs);
  const key = `fw:${clientId}:${windowKey}`;

  // Increment count, set TTL on first request
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }

  const resetAfter = Math.ceil((windowMs - (Date.now() % windowMs)) / 1000);

  if (count > maxRequests) {
    // Already over limit - return actual count but cap remaining at 0
    return {
      allowed: false,
      count,
      remaining: 0,
      resetAfter,
    };
  }

  return {
    allowed: true,
    count,
    remaining: maxRequests - count,
    resetAfter,
  };
}

module.exports = fixedWindowCounter;
