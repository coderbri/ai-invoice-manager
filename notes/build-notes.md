# Invoicer — Build Notes

### Table of Contents

- [Stage 1: Backend Scaffold & Environment Setup](#stage-1-backend-scaffold--environment-setup)
- [Stage 2: Database Layer (Neon Postgres, Schema, Connection Pool)](#stage-2-database-layer-neon-postgres-schema-connection-pool)
- [Stage 3: Core Utilities & Error Handling](#stage-3-core-utilities--error-handling)


## Stage 1: Backend Scaffold & Environment Setup

**Key Commands**
```bash
# Create backend folder structure
mkdir -p src/config src/utils src/middleware src/models src/services src/routes scripts

# Generate a strong random JWT secret
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

**Takeaways**
- Double-check native/third-party package names in `package.json` before installing — `brcrypt` (typo for `bcrypt`) fails or installs the wrong thing, and it's an easy typo to miss since npm won't always warn clearly.
- `bcrypt` 6.0.0 is a native module; since it requires build tools on some systems, `bcryptjs` (pure JS) is a solid fallback if install issues come up across different environments.
- Enable "Connection pooling" on Neon before grabbing the connection string — needed for the backend to behave correctly under concurrent requests.
- Centralize `.env` loading in one file (`config/env.js`): validate required vars (`DATABASE_URL`, `JWT_SECRET`) at startup and `process.exit(1)` if missing, rather than letting a missing var fail mysteriously deep in the app later.
- Split comma-separated `CLIENT_ORIGIN` values into an array up front, so CORS can check against multiple allowed origins cleanly.

---

## Stage 2: Database Layer (Neon Postgres, Schema, Connection Pool)

**Key Commands**
```bash
# Test the DB connection and schema setup in one shot, without booting the full server
node -e "require('./src/config/db').connectDB().then(()=>process.exit(0)).catch((e)=>{console.error(e.message);process.exit(1)})"
```

**Takeaways**
- A multi-statement SQL string parses (and fails) as one block — Postgres stops at the *first* syntax error it hits, so one typo can mask several others further down. Fix one, re-run, repeat until it's clean.
- Common typos to watch for in hand-written schema strings: missing commas between columns, unclosed string literals (`'USD` vs `'USD'`), and doubled `PRIMARY KEY` declarations on a table that already has one (e.g. accidentally marking a foreign key column as primary too).
- Neon requires SSL — `ssl: { rejectUnauthorized: false }` on the `pg` Pool config gets local dev working, though production setups typically want proper certificate verification instead of disabling that check.
- Double-check `pg` Pool option names against the docs — an unrecognized key (e.g. a typo like `connectionTimeoutMills` instead of `connectionTimeoutMillis`) is silently ignored rather than throwing, so the setting just quietly does nothing.
- `withTransaction()` (BEGIN/COMMIT/ROLLBACK wrapped around a callback) is the pattern to reach for anytime multiple writes need to succeed or fail together — e.g. an invoice plus its line items, or a payment that flips an invoice to "paid."
- Running `connectDB()` via a one-off `node -e` command is a fast way to sanity-check the DB layer in isolation before wiring it into the full Express app.

---

## Stage 3: Core Utilities & Error Handling

**Key Commands**
```bash
# Start the dev server with auto-reload
npm run dev

# Quick manual health check (or use Postman)
curl http://localhost:8000/api/health
```

**Takeaways**

Why so much error-handling infrastructure this early, before a single "real" feature route exists? Because it's the layer everything else gets built on top of — retrofitting it later means touching every route again.

- **`ApiError` gives errors a shape.** Without it, a route either throws a raw JS error (which becomes an ugly, inconsistent 500) or has to manually build a `{status, message}` object every time. A single class with factory methods (`ApiError.notFound()`, `ApiError.badRequest()`, etc.) means every part of the app — auth, invoices, payments — speaks the same error "language," and the response shape sent to the frontend never varies.
- **`asyncHandler` solves a real Express gotcha.** Express doesn't automatically catch rejected promises from `async` route handlers — an unhandled rejection in an `async` function just hangs or crashes, it doesn't call `next(err)` on its own. Wrapping every async handler once means never writing repetitive `try/catch` blocks in the routes themselves.
- **`errorHandler` is the one place that translates *infrastructure* errors into *user-facing* ones.** This is the part worth understanding well: Postgres doesn't throw `ApiError`s — it throws its own errors with SQL state codes (`23505` for a unique violation, `23503` for a foreign key violation, `22P02` for bad input syntax). Without translating those codes, a duplicate email on signup would surface as a raw, cryptic Postgres error message instead of a clean "That value is already in use." Same idea for Zod: a failed validation naturally throws a `ZodError` with its own shape, and the handler normalizes that into the same `{ error: { message, details } }` format as everything else.
- **Centralizing *where* errors get logged matters too.** Only 5xx (server-fault) errors get logged to the console — a 400 from bad user input isn't a bug, so it doesn't need to spam logs. And stack traces only leak in development (`env.isProd` check) — shipping a stack trace to a production client is an information disclosure risk (reveals file paths, internal structure).
- **`validate` middleware turns "trust but verify" into "verify, then trust."** By reassigning `req[source] = result.data` after a successful Zod parse, every downstream handler works with data that's *already* been type-checked and shaped — no defensive checks needed inside the route logic itself.
- **Rate limiting has two distinct purposes here, not one.** The AI limiter is about *cost control* — Gemini calls aren't free, so an unbounded loop (buggy frontend code, or a malicious user) could run up a real bill. The auth limiter is about *security* — slowing down brute-force password guessing. Same tool (`express-rate-limit`), two different threat models, which is why they have different windows/limits and key strategies (per-user vs. per-IP).
- **The health check earns its place by testing the thing that actually breaks in production: the DB connection**, not just "is the process alive." A server that's running but can't reach Postgres is still down in every way that matters to users.