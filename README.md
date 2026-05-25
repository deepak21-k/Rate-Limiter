# 🚦 Rate Limiter

**Node.js 18+ | Express 4.x | Redis 7 | Docker | Jest | MIT**

A production-style API Rate Limiter built with Node.js, Express, and Redis.

Implements 3 classic rate limiting algorithms as plug-and-play Express middleware — with per-route configuration, standard HTTP headers, and Docker support.

---

## 📌 What is a Rate Limiter?

A rate limiter controls how many requests a client can make to an API within a given time window.

```text
Client sends request → Rate Limiter checks count → Allow ✅ or Block ❌ (429)
```

**Real-world uses:** Protecting login endpoints from brute force, preventing API abuse, enforcing fair usage in SaaS products (e.g. Stripe, GitHub, AWS all use rate limiting).

---

## ⚙️ Algorithms Implemented

### 1. Fixed Window Counter

Divides time into fixed windows (e.g. every 60s) and counts requests per window. Simple and fast, but has a boundary spike problem — a burst of 2x the limit is possible right around the window reset.

```text
|--- window 1 (0s–60s) ---|--- window 2 (60s–120s) ---|
         100 req                    100 req
                          ↑
              spike possible here (up to 200 req)
```

**Concurrency:** Uses Redis `INCR` which is atomic — even concurrent requests are counted correctly. The counter increments before the limit check, so rejected requests add to the counter, but remaining is capped at 0 in the response.

### 2. Token Bucket (Industry Standard)

Each client has a "bucket" with a max token capacity. Tokens refill at a fixed rate; each request consumes one token. If the bucket is empty, the request is rejected.

```text
Bucket capacity: 100 tokens
Refill rate:      10 tokens/sec

Request → consume 1 token → allowed ✅
No tokens left → rejected ❌
```

**Strength:** Naturally handles short bursts (uses saved-up tokens). Used by AWS, Stripe, and most production APIs.

**Concurrency:** Uses Redis `WATCH/MULTI/EXEC` optimistic locking. Under sequential or moderate per-IP traffic, this prevents double-spending correctly. Under extreme same-IP concurrency (hundreds of simultaneous requests from one client), the shared ioredis connection can cause WATCH collisions to go undetected. For guaranteed atomicity under heavy concurrency, Lua scripts are the production solution — but this implementation prioritizes readability and simplicity.

### 3. Sliding Window Counter (Most Balanced)

A hybrid of Fixed Window + approximation. Uses two adjacent window counters and a weighted formula to estimate the request rate — accurate without being memory-heavy.

```text
Estimated count = currentCount + (prevCount × overlap%)

Example (limit = 10 req/min):
  Request at t=75s → 25% into current window → 75% overlap with previous
  prevCount=8, currentCount=3

  estimate = 3 + (8 × 0.75) = 9 → ALLOW ✅
```

**Strength:** Smooths boundary spikes, uses only 2 counters per client.

**Concurrency:** The `GET→estimate→INCR` sequence is not atomic. Under concurrent requests from the same client, more requests may be allowed than the limit. This is acceptable for the typical use case (sequential per-IP traffic) but should be noted.

---

## 📁 Project Structure

```text
rate-limiter/
├── src/
│   ├── algorithms/
│   │   ├── fixedWindow.js            # Fixed Window Counter
│   │   ├── tokenBucket.js            # Token Bucket
│   │   └── slidingWindowCounter.js   # Sliding Window Counter
│   ├── middleware/
│   │   └── rateLimiter.js            # Plug-and-play Express middleware factory
│   ├── routes/
│   │   └── index.js                  # Demo API routes (per-route config)
│   ├── config/
│   │   └── redis.js                  # Redis connection with retry strategy
│   └── app.js                        # Express entry point
├── tests/
│   ├── fixedWindow.test.js           # Unit tests
│   ├── tokenBucket.test.js           # Unit tests
│   ├── slidingWindowCounter.test.js  # Unit tests
│   └── app.test.js                   # Integration tests
├── docker-compose.yml                # Redis + App
├── Dockerfile                        # Node 18-alpine
├── .env.example                      # Environment template
└── package.json
```

---

## 🚀 Quick Start

### Option 1 — Docker (Recommended)

Runs both the app and Redis with a single command. No setup needed.

```bash
git clone https://github.com/deepak21-k/Rate-Limiter.git
cd Rate-Limiter
docker-compose up
```

App runs at `http://localhost:3000`

**Useful commands:**
```bash
docker-compose up -d          # run in background
docker-compose logs -f app    # follow app logs
docker-compose logs -f redis  # follow redis logs
docker-compose down           # stop and remove containers
docker-compose down -v        # also remove Redis data volume
```

### Option 2 — Local Setup

Requires Redis installed locally (or accessible via network).

```bash
git clone https://github.com/deepak21-k/Rate-Limiter.git
cd Rate-Limiter

npm install

cp .env.example .env          # configure your env variables

npm run dev                    # starts with nodemon (hot reload)
npm start                      # production start
```

---

## 🌐 API Endpoints

| Method | Route | Limit | Algorithm | Purpose |
|---|---|---|---|---|
| GET | `/status` | None | — | Health check |
| GET | `/public` | 10/min | Fixed Window | Demo — strict limit |
| GET | `/api/data` | 50/min | Token Bucket | Demo — allows bursts |
| POST | `/login` | 5/min | Sliding Window Counter | Brute force protection |

---

## 📤 Response Headers

Every response includes standard rate limit headers:

```text
X-RateLimit-Limit:      100       → max requests allowed
X-RateLimit-Remaining:  94        → requests left in current window
X-RateLimit-Reset:      42        → seconds until window resets
X-RateLimit-Algorithm:  tokenBucket
```

---

## ❌ 429 — Rate Limit Exceeded

When a client hits the limit, they receive a standard HTTP `Retry-After` header (in seconds), alongside a detailed JSON response:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 45
Content-Type: application/json

{
  "error": "Too Many Requests",
  "retryAfter": 45,
  "message": "Rate limit exceeded. Try again in 45s"
}
```

**Note on resetAfter / retryAfter values:**
- **Fixed Window:** seconds until the current window expires
- **Token Bucket:** seconds until 1 token refills (not until full bucket)
- **Sliding Window:** seconds until the current window expires

---

## 🔌 Using the Middleware

The middleware is a factory function — configure per route:

```javascript
const rateLimiter = require('./src/middleware/rateLimiter');

// Apply globally with defaults (Sliding Window, 100/min)
app.use(rateLimiter());

// Per-route — different algorithm and limit
app.get('/api/data', rateLimiter({
  algorithm:   'tokenBucket',
  maxRequests: 50,
  windowMs:    60000,
}));

// Custom key — rate limit by API key instead of IP
app.get('/api/premium', rateLimiter({
  algorithm:    'slidingWindowCounter',
  maxRequests:  200,
  keyGenerator: (req) => req.headers['x-api-key'],
}));

// Separate namespace for login (brute force protection)
app.post('/login', rateLimiter({
  algorithm:    'slidingWindowCounter',
  maxRequests:  5,
  keyGenerator: (req) => `login:${req.ip}`,
}));
```

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `algorithm` | `string` | `slidingWindowCounter` | Which algorithm to use |
| `maxRequests` | `number` | `100` | Max requests per window |
| `windowMs` | `number` | `60000` | Window size in ms |
| `keyGenerator` | `function` | `(req) => req.ip` | Function to identify client |

Input validation: `maxRequests` must be >= 1, `windowMs` must be >= 1000ms, `keyGenerator` must be a function. Invalid values throw an Error at startup.

---

## 🔄 Middleware Flow

```text
Request arrives
     │
     ▼
keyGenerator(req) → clientId (e.g. IP address, API key)
     │
     ▼
algorithm(clientId, { maxRequests, windowMs })
     │
     ├── Check/Update Redis counters
     │
     ▼
Set X-RateLimit-* headers on response
     │
     ├── allowed? ── YES ──→ next() → route handler
     │
     └── allowed? ── NO ───→ 429 + Retry-After header + JSON body

If Redis is down or throws an error:
     │
     └── Fail open → next() → request passes through (no rate limiting)
```

This is intentional: a rate limiter outage should not take down the API. If you need fail-closed behavior, change the catch block to return `res.status(503).json({ error: "Rate limiter unavailable" })`

---

## 🧪 Running Tests

Tests use Jest with a mocked Redis — no real Redis needed.

```bash
npm test                    # run all tests
npm test -- --coverage      # with coverage report
```

**Tests cover:**
- Allowing requests under the limit
- Blocking requests over the limit
- Independent counters per client
- Integration: middleware returns correct headers and 429 status
- Input validation: rejects invalid maxRequests, windowMs, keyGenerator

---

## 📊 Performance

Typical overhead per request (measured with Redis on localhost, single client, sequential requests):

| Algorithm | p50 | p99 | Redis Round-Trips |
|---|---|---|---|
| Fixed Window | ~1ms | ~3ms | 1 (INCR + conditional EXPIRE) |
| Token Bucket | ~2ms | ~5ms | 3 (WATCH + HGETALL + MULTI/EXEC) |
| Sliding Window | ~2ms | ~4ms | 2 (GET×2 + conditional INCR+EXPIRE) |

Under concurrent same-IP traffic, Token Bucket retries may increase latency (up to 3 WATCH retries before fail-closed).

**Production note:** Redis round-trips are the dominant cost. Hosting Redis in the same datacenter/availability zone as the app is critical for keeping p99 under 10ms.

---

## ⚠️ Known Limitations

1. **Fixed Window — Boundary Spike**
   Up to 2x traffic at window edges. A client can send `maxRequests` at t=59s and another `maxRequests` at t=60s, effectively doubling the rate for that brief moment. If this is a problem, use Sliding Window or Token Bucket instead.

2. **Token Bucket — Concurrency Under Extreme Load**
   WATCH/MULTI/EXEC provides optimistic locking, but ioredis multiplexes commands over a single TCP connection. Under extreme same-IP concurrency (hundreds of simultaneous requests), WATCH calls from different requests can interfere, and double-spending may occur. Under very high same-IP concurrency, more requests than configured may occasionally pass. For sequential or moderate traffic, the implementation is correct. For guaranteed atomicity under heavy concurrency, Redis Lua scripts are the production solution.

3. **Sliding Window — Non-Atomic Read-Write**
   The `GET→estimate→INCR` sequence is not atomic. Under concurrent requests from the same client, multiple requests may read the same counter values and all be allowed, exceeding the limit. This is acceptable for the typical use case (sequential per-IP traffic).

4. **Fail-Open Design**
   If Redis is unreachable, all requests pass through without rate limiting. This is intentional but may not suit all use cases. If you need fail-closed behavior, modify the catch block in `rateLimiter.js` to return a 503 instead of calling `next()`.

5. **Single-Instance Redis**
   The current setup uses a single Redis instance. For production high-availability, consider Redis Sentinel or Redis Cluster. The ioredis client supports both out of the box — only the config in `src/config/redis.js` needs to change.

---

## 🔧 Environment Variables

Copy `.env.example` to `.env` and configure:

```env
REDIS_HOST=localhost        # Redis server hostname
REDIS_PORT=6379             # Redis server port

PORT=3000                   # Express server port

DEFAULT_MAX_REQUESTS=100    # requests per window
DEFAULT_WINDOW_MS=60000     # window size (1 min)
```

When running in Docker, these are set automatically via `docker-compose.yml`.

---

## 🧠 Design Decisions

- **Fail Open** — if Redis crashes, the middleware calls `next()` instead of blocking all traffic. A rate limiter outage should not take down the API. This mirrors how Stripe and GitHub handle rate limiter failures.
- **Algorithm as Middleware Option** — each route can use a different algorithm. A login endpoint benefits from Sliding Window's smooth boundaries; a data API benefits from Token Bucket's burst tolerance. The middleware also features input validation to prevent misconfigurations at startup rather than failing silently at runtime.
- **Standard HTTP Headers** — mirrors how real APIs (GitHub, Stripe) expose rate limit state (`X-RateLimit-*` and `Retry-After`), making it easy for clients to handle limits gracefully. The `Retry-After` header follows RFC 6585 / RFC 7231, returning an integer number of seconds.
- **No Lua Scripts** — the implementation uses pure JavaScript with Redis commands. This prioritizes readability and ease of understanding over maximum concurrency safety. Lua scripts would provide true atomicity for Token Bucket and Sliding Window, but would also make the code harder to debug, test, and modify. The trade-off is documented in Known Limitations.

---

## 🛠️ Tech Stack

- **Node.js 18+** — runtime
- **Express.js 4.x** — HTTP framework
- **Redis 7 (ioredis)** — distributed counter storage
- **Jest + Supertest** — unit and integration testing
- **Docker + Compose** — containerized deployment
