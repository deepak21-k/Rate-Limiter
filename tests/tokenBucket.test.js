/**
 * Tests: Token Bucket
 *
 * Mock Redis to run without a real instance.
 */

jest.mock("../src/config/redis", () => {
  const store = {};
  return {
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

const tokenBucket = require("../src/algorithms/tokenBucket");
const redis = require("../src/config/redis");

beforeEach(() => {
  redis._reset();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("Token Bucket Algorithm", () => {
  test("allows requests up to max capacity", async () => {
    // 5 tokens max
    for (let i = 0; i < 5; i++) {
      const res = await tokenBucket("user-tb-1", { maxTokens: 5, refillRate: 1, windowMs: 60000 });
      expect(res.allowed).toBe(true);
    }
    // 6th request should fail immediately
    const res2 = await tokenBucket("user-tb-1", { maxTokens: 5, refillRate: 1, windowMs: 60000 });
    expect(res2.allowed).toBe(false);
  });

  test("refills tokens over time", async () => {
    const opts = { maxTokens: 3, refillRate: 1, windowMs: 60000 };
    
    // consume all 3
    await tokenBucket("user-tb-2", opts);
    await tokenBucket("user-tb-2", opts);
    const lastAllowed = await tokenBucket("user-tb-2", opts);
    expect(lastAllowed.allowed).toBe(true);
    
    const blocked = await tokenBucket("user-tb-2", opts);
    expect(blocked.allowed).toBe(false);

    // fast forward 2 seconds (refillRate is 1/sec, so we should get 2 tokens)
    jest.advanceTimersByTime(2000);

    const refilled1 = await tokenBucket("user-tb-2", opts);
    expect(refilled1.allowed).toBe(true);

    const refilled2 = await tokenBucket("user-tb-2", opts);
    expect(refilled2.allowed).toBe(true);

    // Should be out of tokens again
    const blockedAgain = await tokenBucket("user-tb-2", opts);
    expect(blockedAgain.allowed).toBe(false);
  });
});
