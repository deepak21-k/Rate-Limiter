const redis = require("../config/redis");

/**
 * Sliding Window Counter Algorithm
 *
 * How it works:
 * - Hybrid of Fixed Window + approximation
 * - Uses TWO windows: previous + current
 * - Estimates request count using weighted formula:
 *
 *   count = currentCount + (prevCount × overlap%)
 *
 * Example:
 *   Window = 60s, limit = 10
 *   Request at t=75s (25s into current window → 75% overlap with prev)
 *   prevCount=8, currentCount=3
 *   → estimate = 3 + (8 × 0.75) = 9 → ALLOW ✅
 *
 * Strength: Accurate + memory efficient (just 2 counters)
 */
async function slidingWindowCounter(clientId, options = {}) {
  const { maxRequests = 100, windowMs = 60000 } = options;

  const windowSeconds = Math.floor(windowMs / 1000);
  const now = Date.now();

  const currentWindow = Math.floor(now / windowMs);
  const prevWindow = currentWindow - 1;

  const currentKey = `sw:${clientId}:${currentWindow}`;
  const prevKey    = `sw:${clientId}:${prevWindow}`;

  // Fetch both window counts in parallel
  const [currentCount, prevCount] = await Promise.all([
    redis.get(currentKey),
    redis.get(prevKey),
  ]);

  const current = parseInt(currentCount) || 0;
  const prev    = parseInt(prevCount)    || 0;

  // How far into the current window are we? (0.0 → 1.0)
  const elapsedInWindow = (now % windowMs) / windowMs;

  // Weighted estimate
  const estimate = current + prev * (1 - elapsedInWindow);

  const allowed = estimate < maxRequests;

  if (allowed) {
    await redis.incr(currentKey);
    await redis.expire(currentKey, windowSeconds * 2); // keep for 2 windows
  }

  return {
    allowed,
    estimate: Math.ceil(estimate),
    remaining: Math.max(0, maxRequests - Math.ceil(estimate) - (allowed ? 1 : 0)),
    resetAfter: Math.ceil((windowMs - (now % windowMs)) / 1000),
  };
}

module.exports = slidingWindowCounter;
