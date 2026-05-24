# 🚦 Rate Limiter

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat&logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.x-000000?style=flat&logo=express&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-7-DC382D?style=flat&logo=redis&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?style=flat&logo=docker&logoColor=white)
![Jest](https://img.shields.io/badge/Tests-Jest-C21325?style=flat&logo=jest&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-yellow?style=flat)

A **production-style API Rate Limiter** built with Node.js, Express, and Redis.

Implements **3 classic rate limiting algorithms** as plug-and-play Express middleware — with per-route configuration, standard HTTP headers, and Docker support.

---

## 📌 What is a Rate Limiter?

A rate limiter controls how many requests a client can make to an API within a given time window.

```
Client sends request → Rate Limiter checks count → Allow ✅ or Block ❌ (429)
```

**Real-world uses:** Protecting login endpoints from brute force, preventing API abuse, enforcing fair usage in SaaS products (e.g. Stripe, GitHub, AWS all use rate limiting).

---

## ⚙️ Algorithms Implemented

### 1. Fixed Window Counter
Divides time into fixed windows (e.g. every 60s) and counts requests per window. Simple and fast, but has a **boundary spike problem** — a burst of 2× the limit is possible right around the window reset.

```
|--- window 1 (0s–60s) ---|--- window 2 (60s–120s) ---|
         100 req                    100 req
                          ↑
              spike possible here (up to 200 req)
```

---

### 2. Token Bucket ⭐ (Industry Standard)
Each client has a "bucket" with a max token capacity. Tokens refill at a fixed rate; each request consumes one token. If the bucket is empty, the request is rejected.

```
Bucket capacity: 100 tokens
Refill rate:      10 tokens/sec

Request → consume 1 token → allowed ✅
No tokens left → rejected ❌
```

**Strength:** Naturally handles short bursts (uses saved-up tokens). Used by AWS, Stripe, and most production APIs.

---

### 3. Sliding Window Counter ⭐ (Most Balanced)
A hybrid of Fixed Window + approximation. Uses two adjacent window counters and a **weighted formula** to estimate the request rate — accurate without being memory-heavy.

```
Estimated count = currentCount + (prevCount × overlap%)

Example (limit = 10 req/min):
  Request at t=75s → 25% into current window → 75% overlap with previous
  prevCount=8, currentCount=3

  estimate = 3 + (8 × 0.75) = 9 → ALLOW ✅
```

**Strength:** Smooths boundary spikes, uses only 2 counters per client.

---

## 📁 Project Structure

```
rate-limiter/
├── src/
│   ├── algorithms/
│   │   ├── fixedWindow.js            # Fixed Window Counter
│   │   ├── tokenBucket.js            # Token Bucket
│   │   └── slidingWindowCounter.js   # Sliding Window Counter ⭐
│   ├── middleware/
│   │   └── rateLimiter.js            # Plug-and-play Express middleware factory
│   ├── routes/
│   │   └── index.js                  # Demo API routes (per-route config)
│   ├── config/
│   │   └── redis.js                  # Redis connection
│   └── app.js                        # Express entry point
├── tests/
│   ├── fixedWindow.test.js
│   ├── tokenBucket.test.js
│   ├── slidingWindowCounter.test.js
│   └── app.test.js                   # Integration tests
├── docker-compose.yml
├── Dockerfile
├── .env.example
└── package.json
```

---

## 🚀 Quick Start

### Option 1 — Docker (Recommended)

> Runs both the app and Redis with a single command. No setup needed.

```bash
git clone https://github.com/deepak21-k/Rate-Limiter.git
cd Rate-Limiter
docker-compose up
```

App runs at `http://localhost:3000`

---

### Option 2 — Local Setup

> Requires Redis installed locally.

```bash
git clone https://github.com/deepak21-k/Rate-Limiter.git
cd Rate-Limiter

npm install

cp .env.example .env   # configure your env variables

npm run dev            # starts with nodemon (hot reload)
```

---

## 🌐 API Endpoints

| Method | Route       | Limit   | Algorithm              | Purpose                     |
|--------|-------------|---------|------------------------|-----------------------------|
| GET    | `/status`   | None    | —                      | Health check                |
| GET    | `/public`   | 10/min  | Fixed Window           | Demo — strict limit         |
| GET    | `/api/data` | 50/min  | Token Bucket           | Demo — allows short bursts  |
| POST   | `/login`    | 5/min   | Sliding Window Counter | Brute force protection      |

---

## 📤 Response Headers

Every response includes standard rate limit headers:

```
X-RateLimit-Limit:      100       → max requests allowed
X-RateLimit-Remaining:  94        → requests left in current window
X-RateLimit-Reset:      42        → seconds until window resets
X-RateLimit-Algorithm:  tokenBucket
```

---

## ❌ 429 — Rate Limit Exceeded

When a client hits the limit, they receive:

```json
{
  "error": "Too Many Requests",
  "retryAfter": 45,
  "message": "Rate limit exceeded. Try again in 45s"
}
```

---

## 🔌 Using the Middleware

The middleware is a **factory function** — configure per route:

```js
const rateLimiter = require('./src/middleware/rateLimiter');

// Apply globally with defaults
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

| Option         | Type       | Default                   | Description                        |
|----------------|------------|---------------------------|------------------------------------|
| `algorithm`    | `string`   | `slidingWindowCounter`    | Which algorithm to use             |
| `maxRequests`  | `number`   | `100`                     | Max requests per window            |
| `windowMs`     | `number`   | `60000`                   | Window size in milliseconds        |
| `keyGenerator` | `function` | `(req) => req.ip`         | Function to identify the client    |

---

## 🧪 Running Tests

Tests use **Jest** with a **mocked Redis** — no real Redis needed.

```bash
npm test              # run all tests
npm test -- --coverage  # with coverage report
```

Tests cover:
- Allowing requests under the limit
- Blocking requests over the limit
- Independent counters per client
- Integration: middleware returns correct headers and 429 status

---

## 🔧 Environment Variables

Copy `.env.example` to `.env` and configure:

```env
REDIS_HOST=localhost
REDIS_PORT=6379

PORT=3000

DEFAULT_MAX_REQUESTS=100    # requests per window
DEFAULT_WINDOW_MS=60000     # window size (1 min)
```

---

## 🧠 Design Decisions

**Fail open** — if Redis crashes, the middleware calls `next()` instead of blocking all traffic. This is intentional: a rate limiter outage should not take down the API.

**Algorithm as middleware option** — each route can use a different algorithm. A login endpoint benefits from Sliding Window; a data API benefits from Token Bucket bursts.

**Standard HTTP headers** — mirrors how real APIs (GitHub, Stripe) expose rate limit state, making it easy for clients to handle limits gracefully.

---

## 🛠️ Tech Stack

- **Node.js** — runtime
- **Express.js** — HTTP framework
- **Redis (ioredis)** — distributed counter storage
- **Jest + Supertest** — unit and integration testing
- **Docker + Docker Compose** — containerized deployment

---
