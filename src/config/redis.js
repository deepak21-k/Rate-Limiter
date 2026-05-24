const Redis = require("ioredis");

const redis = new Redis({
  host: process.env.REDIS_HOST || "localhost",
  port: process.env.REDIS_PORT || 6379,
  retryStrategy: (times) => {
    if (times >= 5) {
      console.error("❌ Redis connection failed after 5 attempts. Please start Redis or Docker.");
      return null; // Stop retrying
    }
    return Math.min(times * 1000, 3000); // Wait up to 3s before next retry
  },
  maxRetriesPerRequest: 1, // Fail fast on commands when Redis is down
});

redis.on("connect", () => console.log("✅ Redis connected"));
redis.on("error", (err) => {
  if (err.code === "ECONNREFUSED") {
    console.error(`❌ Redis connection refused at ${err.address}:${err.port}`);
  } else {
    console.error("❌ Redis error:", err.message);
  }
});

module.exports = redis;
