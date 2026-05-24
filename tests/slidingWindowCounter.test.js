/**
 * Tests: Sliding Window Counter
 *
 * Mock Redis to run without a real instance.
 */

jest.mock("../src/config/redis", () => {
  const store = {};
  return {
    get: jest.fn(async (key) => store[key] || null),
    incr: jest.fn(async (key) => {
      store[key] = (parseInt(store[key] || 0)) + 1;
      return store[key];
    }),
    expire: jest.fn(async () => "OK"),
    _reset: () => Object.keys(store).forEach((k) => delete store[k]),
  };
});

const slidingWindowCounter = require("../src/algorithms/slidingWindowCounter");
const redis = require("../src/config/redis");

beforeEach(() => {
  redis._reset();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("Sliding Window Counter Algorithm", () => {
  test("allows requests up to limit in the current window", async () => {
    jest.setSystemTime(new Date("2024-01-01T00:00:00.000Z")); // Time is exactly at window boundary

    for (let i = 0; i < 5; i++) {
      const res = await slidingWindowCounter("user-sw-1", { maxRequests: 5, windowMs: 60000 });
      expect(res.allowed).toBe(true);
    }
    
    const resBlock = await slidingWindowCounter("user-sw-1", { maxRequests: 5, windowMs: 60000 });
    expect(resBlock.allowed).toBe(false);
  });

  test("weights previous window properly", async () => {
    const opts = { maxRequests: 10, windowMs: 60000 };
    
    // Set time to start of a minute
    jest.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
    
    // Use 8 requests in the first window
    for (let i = 0; i < 8; i++) {
      await slidingWindowCounter("user-sw-2", opts);
    }

    // Move time forward 15 seconds into the next window (25% elapsed, 75% overlap)
    jest.setSystemTime(new Date("2024-01-01T00:01:15.000Z"));
    
    // Previous window weight = 8 * 0.75 = 6
    // Capacity remaining in current window approximately 10 - 6 = 4 requests
    
    let res;
    for (let i = 0; i < 3; i++) {
      res = await slidingWindowCounter("user-sw-2", opts);
      expect(res.allowed).toBe(true);
    }

    // This 4th request in the current window brings total estimate:
    // prev (8 * 0.75 = 6) + current (3) = 9. So 4th is allowed (estimate becomes 10)
    res = await slidingWindowCounter("user-sw-2", opts);
    expect(res.allowed).toBe(true);

    // 5th request should be blocked
    res = await slidingWindowCounter("user-sw-2", opts);
    expect(res.allowed).toBe(false);
  });
});
