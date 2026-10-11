# Invoicer — Changelog

## v0.10.0 — Seeding Demo Data & Connecting the Frontend
**Release Date:** October 11, 2026

- Added `scripts/migrate.js` (`npm run migrate`) to apply the database schema without starting the server
- Added `scripts/seed.js` (`npm run seed`) to populate a demo account with realistic data:
	- 28 clients, 14 catalog items, 84 invoices spread over about 11 months, and 49 expenses across software, hosting, meals, travel, office, equipment, and marketing
	- Invoices get a realistic mix of statuses (roughly 60% paid, 25% sent, 15% draft), randomized line items, tax, and discounts, with totals computed by the same `computeTotals` used for real invoices
	- Every paid invoice gets a matching payment record, so the ledger agrees with invoice status
	- The invoice counter (`next_seq`) is moved past the seeded numbers so new invoices don't collide
	- Safe to rerun: it resets only the demo account's data and password, leaving other users untouched
- Ran both scripts against Neon: the schema applied cleanly, and the seed created 28 clients, 14 catalog items, 84 invoices (50 paid, each with a payment), and 49 expenses
- Connected the frontend to the real backend by switching every `frontend/src/api/*.js` file from its mock block to its real axios block:
	- `client.js`: enabled the axios client with `baseURL: "/api"` and `withCredentials: true`, so the HTTP-only session cookie travels with every request, plus a response interceptor that turns backend errors into a consistent `{ status, message, details }` shape
	- `auth.js`, `clients.js`, `invoices.js`, `dashboard.js`, `settings.js`, `ai.js`, and `features.js` (items, expenses, payments, reports) now call the live endpoints
	- `receiptParse` uploads the file as multipart form-data to `/api/ai/receipt-parse`
- Retired the mock layer (`frontend/src/mock/api.js` and `store.js`), which is removed at commit

## v0.9.0 — AI Features with Google Gemini (Receipt Scan, Summary, Reminders, Notes)
**Release Date:** October 8, 2026

- Added `middleware/upload.js` for receipt uploads:
  - Multer with in-memory storage, so files never touch disk and the bytes go straight to Gemini
  - 10MB size cap, one file per request, and an allow-list of PDF and common image types (PNG, JPEG, WEBP, HEIC/HEIF)
  - `uploadReceipt()` wrapper that turns Multer errors (too large, wrong type, missing file) into clean `ApiError` responses
- Added `services/geminiService.js`, which holds all the AI logic behind four feature functions:
  - `parseReceipt` sends a receipt image or PDF to Gemini's vision model with a strict JSON response schema at a low temperature, then validates the result with Zod so it can drop straight into an invoice or expense
  - `businessSummary` turns this month's numbers into a short plain-English read with one actionable suggestion
  - `paymentReminder` writes a reminder email in a friendly, firm, or final-notice tone and splits the result into subject and body
  - `writeNote` drafts a service description or payment-terms note
  - Shared `generate()` helper so all four features use one call path, plus a `requireAi()` guard that fails with a clear error when `GEMINI_API_KEY` is missing instead of crashing the server at startup
- Added `routes/ai.js`, mounted at `/api/ai`, as thin plumbing over the service:
  - `POST /receipt-parse` accepts a file upload and returns the structured receipt data
  - `POST /business-summary` gathers revenue (this month vs. last), outstanding, overdue count and total, and the top three overdue invoices from the database first, then has Gemini summarize those facts
  - `POST /payment-reminder` loads the invoice with its client, pulls the company profile for the signature, calculates days overdue, and returns the draft with the client's email address
  - `POST /write-note` validates the request and returns a drafted note
- Protected every AI route with `requireAuth` and the per-user `aiLimiter`, so a runaway loop can't quietly run up a Gemini bill
- Wired the router into `server.js` at `/api/ai`
- Tested in Postman: `POST /api/ai/receipt-parse` with a PNG receipt returned the vendor, date, line items, subtotal, and total, and `POST /api/ai/write-note` returned a polished payment-terms note
- Updated `middleware/rateLimit.js` (from v0.2.0) to pass `req.ip` to `ipKeyGenerator` instead of `(req, res)`, so IP-based rate limiting keys correctly for both the AI and auth limiters

---

## v0.8.0 — Expenses & Payments APIs (auto-reconciling invoices)
**Release Date:** October 8, 2026

- Handles money going out and coming in: expenses on one side, and a payment ledger that closes the loop on invoices
- Added `routes/expenses.js`, mounted at `/api/expenses`:
  - `GET /` — lists expenses, optionally filtered by `category` and `month`, and returns overall and this-month spend totals plus a distinct category list for the filter dropdown
  - `POST /` — creates an expense, defaulting the date to today, the category to "General", and the currency to USD when omitted
  - `PATCH /:id` — partial update using the same "only rebuild SET clauses for fields actually sent" pattern as Clients and Items
  - `DELETE /:id` — deletes an expense scoped to the authenticated user
- Added `routes/payments.js`, mounted at `/api/payments`:
  - `GET /` — lists payments joined with invoice number, invoice total, and client name, plus overall and this-month totals
  - `POST /` — verifies the invoice belongs to the user, then records the payment and reconciles the invoice inside one transaction
  - `DELETE /:id` — removes a payment and re-reconciles its invoice in the same transaction
- Added `reconcileInvoice()`, which re-sums every payment against an invoice and keeps its status truthful. Payments that cover the total flip it to `paid` and stamp `paid_at`. If a removed payment leaves it underpaid, it quietly reverts to `sent` and clears `paid_at`
- Wired both routers into `server.js`; every route is protected by `requireAuth` and scoped by `user_id`
- Tested in Postman:
  - `POST /api/expenses` logged an Adobe expense under "Software", with defaults applied for the omitted date, currency, and notes
  - `POST /api/payments` with a partial payment (5480 against a 5945.80 invoice) correctly left the invoice as `sent`
  - Multi-payment: a second payment covering the remaining balance flipped the invoice to `paid`
  - Single full payment: one payment equal to the invoice total flipped it to `paid` immediately

---

## v0.7.0 — Settings & Services Catalog APIs
**Release Date:** September 30, 2026

- Added `routes/settings.js`, mounted at `/api/settings`:
  - `GET /` — fetches the authenticated user's company settings, auto-creating a default row via `Settings.ensure()` if one doesn't exist yet
  - `PATCH /` — updates only the company settings fields present in the request body (company name, logo, address, email, phone, currency, tax rate, invoice prefix, accent color)
- Added `routes/items.js`, mounted at `/api/items`, for the reusable services/products catalog:
  - `GET /` — lists all catalog items for the authenticated user, alphabetically by name
  - `POST /` — validates and creates a new catalog item (name, description, rate, unit)
  - `PATCH /:id` — partial update using the same "only rebuild SET clauses for fields actually sent" pattern established in the Clients and Invoices routes
  - `DELETE /:id` — deletes a catalog item scoped to the authenticated user
- Both routers protected end-to-end by `requireAuth` and scoped by `user_id` on every query
- Verified end-to-end in Postman: `PATCH /api/settings` correctly updated company name, address, currency, tax rate, and invoice prefix in one call; `POST /api/items` correctly created a new catalog item ("Frontend development", $95/hour) with defaults applied for the omitted `description` field

---

## v0.6.0 — Dashboard & Reports APIs (SQL aggregations, aging report)
**Release Date:** September 28, 2026

- Added `routes/dashboard.js`, mounted at `/api/dashboard`:
  - Single-pass aggregate query for total revenue, outstanding balance, revenue collected this month, overdue count/total, and total invoice count
  - Six-month revenue series generated with `generate_series` + a left join, so months with zero activity still appear with `0` rather than being skipped
  - Five most recent invoices, joined with client name/company, serialized via `serializeInvoice`
  - Total client count
- Added `routes/reports.js`, mounted at `/api/reports`:
  - Revenue, expenses, and computed net profit, plus outstanding balance
  - Six-month revenue-vs-expenses trend using the same month-generation pattern as the dashboard
  - Accounts receivable aging report, bucketing unpaid invoices into current, 1–30, 31–60, 61–90, and 90+ days overdue
  - Top five clients ranked by amount billed, with paid-vs-total for each
  - Invoice status breakdown by total dollar value (draft, sent, overdue, paid)
- Verified end-to-end in Postman against live data (2 invoices, 1 client, both unpaid and not yet due): `/api/dashboard` correctly reported outstanding balance, invoice/client counts, and the two recent invoices with a zeroed six-month series; `/api/reports` correctly bucketed the full outstanding balance as "Current" aging and attributed it to the right client and status

---

## v0.5.0 — Invoices APIs (line items, totals & status in a transaction)
**Release Date:** September 10, 2026

- Added `routes/invoices.js`, mounted at `/api/invoices` (all routes protected by `requireAuth`):
  - `GET /` — lists invoices with filtering by client and status (including a derived "overdue" state for sent invoices past their due date), text search across invoice number/client name, and configurable sorting
  - `GET /:id` — returns a single invoice with its client details and line items
  - `POST /` — creates an invoice, computes its totals from raw line items, and persists the invoice and its items atomically within a transaction
  - `PATCH /:id` — partial update; only recalculates totals when items, tax rate, or discount actually change, and only rebuilds the `SET` clause for fields present in the request
  - `PATCH /:id/status` — dedicated status-transition endpoint that stamps `paid_at` when an invoice moves to "paid"
  - `DELETE /:id` — deletes an invoice scoped to the authenticated user
- Added `utils/invoice.js` — the money-math layer:
  - `round2()` snaps values to two decimal places to avoid floating-point rounding errors in currency math
  - `computeTotals()` normalizes raw line items, calculates each item's amount (`quantity × rate`), then derives subtotal, discount, tax amount, and total
  - `effectiveStatus()` derives a display status, marking a "sent" invoice as "overdue" once its due date has passed
  - `serializeInvoice()` converts Postgres's numeric-as-string values into real numbers before a response reaches the client
- Renamed `routes/client.js` to `clients.js` for naming consistency across route files
- Carried forward the same `user_id`-scoping ownership boundary established in the Clients CRUD API to every invoice query
- Verified end-to-end in Postman: created an invoice for an existing client with a tax rate and multiple line items, and confirmed subtotal, tax amount, and total all compute correctly and persist atomically alongside their line items

---

## v0.4.0 — Clients CRUD APIs
**Release Date:** September 9, 2026

- Added `routes/client.js`, mounted at `/api/clients` (all routes protected by `requireAuth`):
  - `GET /` — lists all clients for the authenticated user, with a billing rollup per client (invoice count, total billed, outstanding balance) computed via a single grouped query with a left join on invoices
  - `GET /:id` — returns a single client, their full invoice history, and computed stats (total billed, outstanding, invoice count)
  - `POST /` — validates and creates a new client
  - `PATCH /:id` — partial update; only rebuilds `SET` clauses for fields actually present in the request body, leaving the rest untouched
  - `DELETE /:id` — deletes a client scoped to the authenticated user
- Every route scopes its query by `user_id`, so one user can never read, edit, or delete another user's clients
- Wired `routes/client.js` into `server.js` at `/api/clients`
- Verified end-to-end in Postman: created a client (`Nova Retail Group`), confirmed it appears via the list endpoint with correctly zeroed rollup stats, and confirmed the single-client endpoint returns the client with an empty invoice history

---

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