/**
 * Tests: Integration tests for Express App and Middleware
 */

jest.mock("../src/config/redis", () => {
  const store = {};
  return {
    incr: jest.fn(async (key) => {
      store[key] = (parseInt(store[key] || 0)) + 1;
      return store[key];
    }),
    get: jest.fn(async (key) => store[key] || null),
    hgetall: jest.fn(async (key) => store[key] || null),
    hset: jest.fn(async (key, ...args) => {
      if (args.length === 1 && typeof args[0] === "object") {
        store[key] = args[0];
      } else {
        const obj = store[key] || {};
        for (let i = 0; i < args.length; i += 2) {
          obj[args[i]] = args[i + 1];
        }
        store[key] = obj;
      }
    }),
    expire: jest.fn(async () => "OK"),
    watch: jest.fn(async () => "OK"),
    unwatch: jest.fn(async () => "OK"),
    multi: jest.fn(function() {
      const actions = [];
      return {
        hset: (key, ...args) => {
          actions.push(() => {
            const obj = store[key] || {};
            for (let i = 0; i < args.length; i += 2) {
              obj[args[i]] = args[i + 1];
            }
            store[key] = obj;
          });
          return this;
        },
        expire: () => {
          actions.push(() => {});
          return this;
        },
        exec: async () => {
          actions.forEach(a => a());
          return ["OK", "OK"];
        }
      };
    }),
    _reset: () => Object.keys(store).forEach((k) => delete store[k]),
  };
});

const request = require("supertest");
const app = require("../src/app");
const redis = require("../src/config/redis");

beforeEach(() => {
  redis._reset();
});

describe("API Integration & Rate Limiter Middleware", () => {
  test("GET /status is not rate limited", async () => {
    for (let i = 0; i < 20; i++) {
      const res = await request(app).get("/status");
      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Rate Limiter is running");
      expect(res.headers["x-ratelimit-limit"]).toBeUndefined();
    }
  });

  test("GET /public is limited by fixedWindow (max 10)", async () => {
    // 10 successful requests
    for (let i = 0; i < 10; i++) {
      const res = await request(app).get("/public");
      expect(res.status).toBe(200);
      expect(res.headers["x-ratelimit-limit"]).toBe("10");
      expect(res.headers["x-ratelimit-algorithm"]).toBe("fixedWindow");
    }

    // 11th request fails
    const blockedRes = await request(app).get("/public");
    expect(blockedRes.status).toBe(429);
    expect(blockedRes.body.error).toBe("Too Many Requests");
  });

  test("GET /api/data is limited by tokenBucket (max 50)", async () => {
    for (let i = 0; i < 50; i++) {
      const res = await request(app).get("/api/data");
      expect(res.status).toBe(200);
      expect(res.headers["x-ratelimit-algorithm"]).toBe("tokenBucket");
    }

    const blockedRes = await request(app).get("/api/data");
    expect(blockedRes.status).toBe(429);
  });

  test("POST /login is limited by slidingWindowCounter (max 5)", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post("/login");
      expect(res.status).toBe(200);
      expect(res.headers["x-ratelimit-algorithm"]).toBe("slidingWindowCounter");
    }

    const blockedRes = await request(app).post("/login");
    expect(blockedRes.status).toBe(429);
  });
});
