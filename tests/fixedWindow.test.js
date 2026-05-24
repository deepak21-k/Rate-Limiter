/**
 * Tests: Fixed Window Counter
 *
 * We mock Redis so tests run without a real Redis instance.
 */

jest.mock("../src/config/redis", () => {
  // Simple in-memory mock for Redis
  const store = {};
  return {
    incr: jest.fn(async (key) => {
      store[key] = (store[key] || 0) + 1;
      return store[key];
    }),
    expire: jest.fn(async () => "OK"),
    _reset: () => Object.keys(store).forEach((k) => delete store[k]),
  };
});

const fixedWindow = require("../src/algorithms/fixedWindow");
const redis       = require("../src/config/redis");

beforeEach(() => redis._reset());

describe("Fixed Window Counter", () => {
  test("allows requests under the limit", async () => {
    const result = await fixedWindow("user-1", { maxRequests: 5, windowMs: 60000 });
    expect(result.allowed).toBe(true);
    expect(result.count).toBe(1);
    expect(result.remaining).toBe(4);
  });

  test("blocks requests over the limit", async () => {
    // Simulate 6 requests (limit is 5)
    for (let i = 0; i < 5; i++) {
      await fixedWindow("user-2", { maxRequests: 5, windowMs: 60000 });
    }
    const result = await fixedWindow("user-2", { maxRequests: 5, windowMs: 60000 });
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  test("different clients have independent counters", async () => {
    await fixedWindow("user-A", { maxRequests: 2, windowMs: 60000 });
    await fixedWindow("user-A", { maxRequests: 2, windowMs: 60000 });

    // user-A is at limit, user-B should still be allowed
    const resultA = await fixedWindow("user-A", { maxRequests: 2, windowMs: 60000 });
    const resultB = await fixedWindow("user-B", { maxRequests: 2, windowMs: 60000 });

    expect(resultA.allowed).toBe(false);
    expect(resultB.allowed).toBe(true);
  });
});
