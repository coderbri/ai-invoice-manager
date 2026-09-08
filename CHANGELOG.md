# Invoicer — Changelog

## v0.3.0 — Authentication APIs (Register, Login, Get Me) + cookie/JWT middleware
**Release Date:** September 8, 2026

- Added `models/User.js` — user persistence layer: create, lookup by email/id (with and without password hash), name/password updates, and bcrypt hash/compare helpers; a `PUBLIC_COLS` constant keeps `password_hash` out of any response sent to the client
- Added `models/Settings.js` — company settings persistence: `ensure()` upserts a default settings row for a user, `update()` patches an allow-listed set of fields, and `nextInvoiceNumber()` atomically increments and returns a sequential, prefixed invoice number inside a transaction
- Added `middleware/auth.js` (`requireAuth`) — verifies the JWT from the session cookie, loads the corresponding user, and attaches it to `req.user`; rejects with 401 on a missing, invalid, or expired token, or a user that no longer exists
- Added `routes/auth.js` with the following endpoints:
  - `POST /register` — validates input, rejects duplicate emails, hashes the password, creates the user, initializes their company settings, and issues a session cookie
  - `POST /login` — verifies email/password against the stored hash and issues a session cookie
  - `POST /logout` — clears the session cookie
  - `GET /me` — returns the authenticated user from `req.user` (requires auth)
  - `PATCH /profile` — updates the authenticated user's name (requires auth)
  - `PATCH /password` — verifies the current password before updating to a new one (requires auth)
- Applied `authLimiter` to `/register`, `/login`, and `/password` to slow down brute-force attempts
- Wired `routes/auth.js` into `server.js` at `/api/auth`
- Manually verified the full auth flow in Postman: registered two users (`Alex Chen` / Chen Studio, `John Smith` / Smithy Studios), confirmed `/login` returns the expected user object, and confirmed the session cookie (persisted by Postman) authorizes a subsequent `GET /me` request returning the same authenticated user

---

## v0.2.0 — Core Utilities & Server Boot (Express, middleware, error handling)
**Release Date:** September 7, 2026

- Added `utils/ApiError.js` — custom error class carrying an HTTP status code, message, and optional details, with static factory methods (`badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`, `tooMany`, `internal`) for consistent error creation across every route
- Added `utils/asyncHandler.js` — wraps async route handlers so rejected promises forward to Express's error middleware automatically, instead of needing try/catch in every route
- Added `utils/jwt.js` — signs and verifies JWTs using the secret/expiry from env config, plus shared `cookieOptions` (HTTP-only, secure in production, 7-day expiry) for storing the auth token client-side without exposing it to JavaScript
- Added `middleware/errorHandler.js` — centralized error handler that all errors funnel through; translates raw Postgres error codes (unique violation, foreign key violation, invalid input) and Zod validation errors into clean, consistent JSON responses, logs 5xx errors server-side, and includes stack traces only outside production
- Added `middleware/validate.js` — generic middleware factory that validates `req.body` (or another source) against a Zod schema, replacing raw input with the parsed/cleaned data on success or throwing a structured 400 on failure
- Added `middleware/rateLimit.js` — two rate limiters: one capping AI (Gemini) requests per user to control cost/abuse, one capping auth attempts per IP to slow down brute-force login attempts
- Added `routes/health.js` — `/api/health` endpoint that pings the database and reports status, uptime, and DB connectivity
- Assembled `server.js` — Express app wired with CORS, JSON/urlencoded body parsing, cookie parsing, request logging (dev only), the health route, and the 404/error-handling middleware chain
- Verified end-to-end: `npm run dev` boots the server, and `GET /api/health` returns a live status/uptime/DB-connected response

---

## v0.1.0 — Backend Setup, Neon PostgreSQL & Database Schema
**Release Date:** September 5, 2026

- Initialized backend (`ai-invoice-manager-backend`) with core dependencies: Express, PostgreSQL (`pg`), JWT + bcrypt auth, Gemini AI client, Zod validation, Multer for uploads
- Scaffolded backend project structure:
  - `config/` — environment loading, DB connection, schema
  - `utils/` — error class, async wrapper, token helpers, invoice math
  - `middleware/` — auth, error handling, validation, rate limiting, uploads
  - `models/` — data layer for users and company settings
  - `services/` — Gemini client
  - `routes/` — API endpoints
- Configured environment variables (`.env`): server port, Neon Postgres connection string, JWT secret/expiry, cookie name, CORS origin, Gemini API key/model
- Enabled connection pooling on Neon and generated a Gemini API key via AI Studio
- Added `config/env.js` to centralize env loading — validates required vars (`DATABASE_URL`, `JWT_SECRET`) at startup and fails fast if missing, with sensible fallbacks and CORS origins split into an array
- Added `config/schema.js` — defines the full Postgres schema as a single SQL string: `users`, `company_settings`, `clients`, `invoices`, `invoice_items`, `catalog_items`, `expenses`, and `payments`, with foreign keys, indexes, and a unique constraint on invoice numbers per user
- Added `config/db.js` — sets up the `pg` connection pool (SSL enabled for Neon), exposes `query`/`queryOne` helpers for parameterized SQL, a `withTransaction` helper for atomic multi-step writes (e.g. saving an invoice with its line items, or reconciling a payment), and `connectDB()` to verify the connection and run the schema on startup
- Verified end-to-end: running `connectDB()` logs `Postgres connected: neondb (schema ready)`, and all eight tables now appear in the Neon dashboard — database foundation is live

---

## Initial Commit
**Release Date:** September 4, 2026

- Set up README for **Invoicer**, an AI-powered invoicing and billing app
- Cloned frontend UI boilerplate, installed packages, and verified it runs