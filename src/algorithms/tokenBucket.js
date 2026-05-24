const redis = require("../config/redis");

/**
 * Token Bucket Algorithm
 *
 * How it works:
 * - Each client has a "bucket" with a max token capacity
 * - Tokens refill at a fixed rate (e.g. 10 tokens/sec)
 * - Each request consumes 1 token
 * - If bucket is empty → request denied
 *
 * Strength: Naturally handles bursts (uses saved-up tokens)
 * Used by: AWS, Stripe
 */
async function tokenBucket(clientId, options = {}) {
  // Map generic middleware options to token bucket specific ones
  const maxTokens = options.maxTokens || options.maxRequests || 100;
  const windowMs = options.windowMs || 60000;
  
  // Calculate refillRate (tokens per second) to completely refill bucket over windowMs
  const refillRate = options.refillRate || (maxTokens / (windowMs / 1000));

  const key = `tb:${clientId}`;
  const MAX_RETRIES = 3;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const now = Date.now();

    // Watch the key for optimistic locking
    await redis.watch(key);

    // Fetch stored state
    const data = await redis.hgetall(key);

    let tokens = maxTokens;
    let lastRefill = now;

    if (data && data.tokens !== undefined) {
      tokens = parseFloat(data.tokens);
      lastRefill = parseInt(data.lastRefill);

      // Refill tokens based on time elapsed
      const elapsed = (now - lastRefill) / 1000; // seconds
      tokens = Math.min(maxTokens, tokens + elapsed * refillRate);
    }

    const allowed = tokens >= 1;
    if (allowed) tokens -= 1;

    // Start transaction
    const multi = redis.multi();
    
    // Persist updated state explicitly to ensure persistence across all ioredis versions
    multi.hset(key, "tokens", tokens.toFixed(4), "lastRefill", now);
    multi.expire(key, Math.ceil(windowMs / 1000));

    // Execute transaction
    const result = await multi.exec();

    // If result is null, the key was modified by another process. Retry.
    if (result === null) {
      if (attempt === MAX_RETRIES - 1) {
        // If we exhaust retries, unwatch and fail closed
        await redis.unwatch();
        return {
          allowed: false,
          tokens: Math.floor(tokens),
          remaining: 0,
          resetAfter: 1, // Fallback wait time
        };
      }
      continue; // Try again
    }

    // Calculate dynamic resetAfter based on token deficit
    const tokensNeeded = Math.max(1 - tokens, 1 / refillRate);
    const resetAfter = Math.ceil(tokensNeeded / refillRate) || 1;

    return {
      allowed,
      tokens: Math.floor(tokens),
      remaining: Math.floor(tokens),
      resetAfter,
    };
  }
}

module.exports = tokenBucket;
