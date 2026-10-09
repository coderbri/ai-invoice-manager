# Invoicer — Build Notes

### Table of Contents

- [Stage 1: Backend Scaffold & Environment Setup](#stage-1-backend-scaffold--environment-setup)
- [Stage 2: Database Layer (Neon Postgres, Schema, Connection Pool)](#stage-2-database-layer-neon-postgres-schema-connection-pool)
- [Stage 3: Core Utilities & Error Handling](#stage-3-core-utilities--error-handling)
- [Stage 4: Authentication (Register, Login, Sessions, Password Change)](#stage-4-authentication-register-login-sessions-password-change)
- [Stage 5: Clients CRUD API](#stage-5-clients-crud-api)
- [Stage 6: Invoices API (line items, totals & status in a transaction)](#stage-6-invoices-api-line-items-totals--status-in-a-transaction)
- [Stage 7: Dashboard & Reports APIs (SQL aggregations, aging report)](#stage-7-dashboard--reports-apis-sql-aggregations-aging-report)
- [Stage 8: Settings & Services Catalog APIs](#stage-8-settings--services-catalog-apis)
- [Stage 9: Expenses & Payments APIs (auto-reconciling invoices)](#stage-9-expenses--payments-apis-auto-reconciling-invoices)
- [Stage 10: AI Features with Google Gemini](#stage-10-ai-features-with-google-gemini)


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

---

## Stage 4: Authentication (Register, Login, Sessions, Password Change)

**Manual Verification (Postman)**
- Registered two test users via `POST /register` to confirm duplicate-email checking and independent sessions:
```json
  { "name": "Alex Chen", "email": "alex@timetoprogram.com", "password": "Test@1234", "companyName": "Chen Studio" }
  { "name": "John Smith", "email": "jsmith@timetoprogram.com", "password": "Test@1234", "companyName": "Smithy Studios" }
```
- Confirmed `/login` returns the authenticated user (password hash correctly excluded from the response, matching `PUBLIC_COLS`)
- Confirmed the session cookie set on login/register is picked up automatically by Postman's cookie jar, and `GET /me` (a `requireAuth`-protected route) returns the same user without re-sending credentials — proof the cookie → JWT → `req.user` chain works end-to-end

**Takeaways**

- **Never return the password hash, even by accident.** `models/User.js` uses a `PUBLIC_COLS` constant for every query whose result might reach a response — `findByEmail`/`findByIdWithHash` are the *only* two functions that `SELECT *`, and both are used strictly for internal password comparison, never sent back to the client. Having one named constant instead of retyping the column list everywhere means there's exactly one place to get it right.
- **`issueSession()` centralizes what "being logged in" means.** Both `/register` and `/login` end by calling the same helper (sign a JWT with `sub: user.id`, set it as an HTTP-only cookie). If the session strategy ever changes — different expiry, refresh tokens, whatever — there's one function to update instead of two near-duplicate code paths drifting apart over time.
- **`ensure()` is an idempotent upsert, not a "create."** `ON CONFLICT (user_id) DO NOTHING` means calling `Settings.ensure()` on a user who already has settings is a safe no-op, not an error. This matters because `nextInvoiceNumber()` also calls it defensively — a user could theoretically hit invoicing before their settings row exists for some edge-case reason, and this guarantees a row is always there before it's read/updated.
- **Sequential invoice numbers need a transaction, not just a normal update.** If two requests tried to grab the "next" invoice number for the same user at nearly the same time without a transaction, they could both read `next_seq = 5` and both produce `INV-0005` — a collision. Wrapping the read-and-increment in `withTransaction` (from Stage 2) makes the whole operation atomic, so concurrent requests get serialized instead of racing.
- **`requireAuth` is where "cookie" becomes "user."** Every protected route just calls this once as middleware rather than re-verifying a JWT inline — it decodes the cookie, confirms the user it points to still exists (handles the case where a user was deleted but their old token is still floating around in a browser), and attaches `req.user` so downstream handlers never touch tokens directly.
- **Validation middleware doesn't just reject bad input — it silently reshapes it.** By default, Zod's `.object()` schemas strip any key not explicitly declared. That's usually a feature (it sanitizes unexpected fields off the request body automatically), but it's a sharp edge: if a schema is missing a field the handler actually needs, that field vanishes with no error, and the failure shows up later as a confusing logic bug rather than an obvious validation error. Worth double-checking that every field a handler reads from `req.body` is also declared in that route's schema.
- **Rate limiting `/password` alongside `/login` and `/register` matters** because a password-change endpoint that verifies a "current password" is itself a guessable-secret endpoint — without a limiter, it's just as brute-forceable as the login route.

---

## Stage 5: Clients CRUD API

**Manual Verification (Postman)**
- Created a client while authenticated (session cookie carried automatically):
```json
  { "name": "Nova Retail Group", "email": "billing@novaretail.com", "company": "Nova Retail" }
```
  → `201 Created`, returns the full client record with a fresh UUID
- Confirmed `GET /` lists the new client with rollup fields correctly zeroed (`invoice_count: 0`, `total_billed: 0`, `outstanding: 0`) since no invoices exist yet
- Confirmed `GET /:id` (using the UUID from creation) returns the client, an empty `invoices` array, and matching zeroed `stats`
- That client UUID will be needed next for creating an invoice against it

**Takeaways**
- **The rollup query is the pattern worth remembering:** a single `LEFT JOIN` + `GROUP BY` computes count/sum aggregates per client in one round trip, instead of running an N+1 query (one query per client to fetch their invoice stats). `COALESCE(SUM(...), 0)` matters here specifically because a client with zero invoices produces `NULL` from `SUM` over an empty group — without the `COALESCE`, `total_billed` would come back as `null` instead of `0`.
- **`GET /:id` intentionally does two separate queries instead of one big join** — first confirm the client exists and belongs to this user (and 404 immediately if not), then fetch its invoices. Doing it in one step would make it harder to distinguish "client doesn't exist" from "client exists but has no invoices."
- **The `user_id` scope on every query is the actual authorization boundary**, not `requireAuth` alone. `requireAuth` only proves *who* is asking; every query's `WHERE ... AND user_id = $2` is what stops that authenticated user from reaching another user's data by guessing a client UUID. Auth and ownership-scoping are two separate concerns, and both are needed together.
- **The dynamic `PATCH` builder is the reusable shape for partial updates**: loop over an explicit allow-list of column names, only add a field to `SET` if it's actually present in the body, and bail out with a 400 if nothing was sent. Since it's driven by an allow-list rather than `Object.keys(req.body)`, there's no risk of an unexpected key (or something Zod didn't strip) reaching raw SQL.

---

## Stage 6: Invoices API (line items, totals & status in a transaction)

**Manual Verification (Postman)**
- Created an invoice for an existing client (`Nova Retail Group`, from Stage 5) with a tax rate and two line items:
```json
  {
    "client_id": "bd19cce5-929b-41e6-9728-2c41890b69dd",
    "status": "sent",
    "tax_rate": 8.5,
    "items": [
      { "description": "Design sprint", "quantity": 1, "rate": 3200 },
      { "description": "Frontend development", "quantity": 24, "rate": 95 }
    ]
  }
```
  → `201 Created`, returns the full invoice with computed `subtotal: 5480`, `tax_amount: 465.8`, `total: 5945.8`, and both line items persisted with generated UUIDs and `amount` values
- Confirmed the math: `(1 × 3200) + (24 × 95) = 5480` subtotal → `5480 × 8.5% = 465.80` tax → `5480 + 465.80 = 5945.80` total
- Confirmed `invoice_number` auto-generated as `INV-000x` via `Settings.nextInvoiceNumber()` when not supplied in the request

**Takeaways**

- **The request body is shaped like a real invoice form, not a database row — that's intentional.** A frontend wouldn't collect `subtotal`, `tax_amount`, or `total` from the user at all; those are *derived* values. The form only needs to capture what a person actually fills in: which client, a status (draft/sent), a tax rate, an optional discount, and a dynamic list of line items where each row is just a description, quantity, and rate — the same three fields a user would type into an "Add line item" row in the UI. Everything else (`amount` per line, `subtotal`, `tax_amount`, `total`) is something the *server* computes from those raw inputs via `computeTotals()`, never something trusted from the client.
- **This is a deliberate security/data-integrity boundary, not just a convenience.** If the API trusted a client-sent `total` field, a modified request could submit line items worth $50 but claim a `total` of $5 — nothing server-side would catch it. By only accepting `description`/`quantity`/`rate` per item and deriving every dollar amount internally, the server is the single source of truth for money math, regardless of what a compromised or buggy frontend might send.
- **The `items` array maps directly to how a dynamic form would build it.** In a real UI, "Add line item" pushes a new `{ description, quantity, rate }` object into an array in frontend state, and removing a row splices it back out — by the time the form submits, `items` is just whatever's currently in that array, in order. The `position` field on each stored item (defaulted to its array index via `it.position ?? i` in `computeTotals`) exists specifically to preserve that display order when the invoice is reloaded later, since SQL rows have no inherent order without one.
- **`COALESCE($5, CURRENT_DATE)` on `issue_date` mirrors an optional form field with a sensible default.** A user creating an invoice usually won't bother setting "today" explicitly — the form can simply omit the field, and the database fills it in rather than requiring the frontend to compute and send today's date itself.
- **Constructing the parameterized `INSERT` is a one-to-one column-position mapping — and it's exactly where a single misplaced character breaks everything.** The column list `(user_id, client_id, ..., paid_at)` and the `VALUES ($1, $2, ..., $15)` placeholders have to agree in count *and* order; the values array passed alongside them then has to match that same order a third time. Three parallel lists that all have to stay in sync is naturally error-prone by hand — a stray parenthesis, a missing comma, or a values array built in the wrong order all produce the same category of bug, just at different stages (SQL parse error vs. silently swapped column data).
- **`replaceItems()` uses delete-then-reinsert rather than diffing and updating individual items — a deliberate simplicity trade-off.** For a `PATCH` that includes a new `items` array, it's far simpler to wipe all existing line items for that invoice and reinsert the new set than to compute which items were added, removed, or edited. This only works safely because it's wrapped in `withTransaction()` — if the reinsert step failed partway through, the delete would roll back too, rather than leaving an invoice with no items at all.
- **`PATCH /:id` only recomputes totals when it actually needs to** — either `items` changed, or `tax_rate`/`discount` changed. If someone's just updating `notes` or `terms`, there's no reason to touch the money math at all; the existing stored totals stay untouched. This mirrors the same "only rebuild what's present" allow-list pattern from the Clients `PATCH` route in Stage 5.
- **`PATCH /:id/status` exists as its own endpoint rather than folding status changes into the general `PATCH`** because moving to "paid" has a side effect beyond just updating a column — it needs to stamp `paid_at`. Keeping that as a dedicated, narrower endpoint makes the "mark as paid" action in the UI a single, explicit intent rather than a general-purpose update that happens to also change status.

---

## Stage 7: Dashboard & Reports APIs (SQL aggregations, aging report)

**Manual Verification (Postman)**

- Tested `GET /api/dashboard` against live data (2 invoices, 1 client, both `sent` and not yet due):
  ```json
  {
      "stats": {
          "totalRevenue": 0,
          "outstanding": 11891.6,
          "paidThisMonth": 0,
          "overdueCount": 0,
          "overdueTotal": 0,
          "invoiceCount": 2,
          "clientCount": 1
      },
      "revenueSeries": [ /* 6 months, Apr–Sep, all zeroed */ ],
      "recentInvoices": [ /* INV-0003 and INV-0002, both $5,945.80, Nova Retail Group */ ]
  }
  ```
    → correctly reported the outstanding balance, invoice/client counts, and the two most recent invoices; `revenueSeries` came back zeroed across all six months since nothing has been marked "paid" yet

- Tested `GET /api/reports` against the same data:
  ```json
  {
      "totals": { "revenue": 0, "expenses": 0, "netProfit": 0, "outstanding": 11891.6 },
      "monthly": [ /* 6 months, all zeroed */ ],
      "aging": [
          { "bucket": "Current", "value": 11891.6 },
          { "bucket": "1–30d", "value": 0 },
          { "bucket": "31–60d", "value": 0 },
          { "bucket": "61–90d", "value": 0 },
          { "bucket": "90d+", "value": 0 }
      ],
      "topClients": [ { "name": "Nova Retail Group", "billed": 11891.6, "paid": 0 } ],
      "statusBreakdown": [
          { "name": "Draft", "value": 0 },
          { "name": "Sent", "value": 11891.6 },
          { "name": "Overdue", "value": 0 },
          { "name": "Paid", "value": 0 }
      ]
  }
  ```
    → correctly bucketed the full outstanding balance as "Current" aging (both invoices have no `due_date` set yet), attributed the full amount to Nova Retail Group as top client, and classified it under "Sent" in the status breakdown

**Takeaways**

- **A single aggregate query beats several round trips when every number comes from the same table.** Both the dashboard's `totals` query and the reports' `totals`/`aging`/`status` queries pack multiple `SUM(CASE WHEN ...)` expressions into one `SELECT` over `invoices`, computing five or six different figures (revenue, outstanding, overdue, this-month, etc.) in a single pass rather than one query per metric.
- **`generate_series` + `LEFT JOIN` is the reusable pattern for "always show N periods, even empty ones."** Without generating the six month rows first via a CTE and left-joining invoices onto them, months with zero paid invoices would simply be missing from the result set instead of showing up as `0` — which would break a frontend chart expecting exactly six data points every time.
- **`COUNT(*) FILTER (WHERE ...)` computes a conditional count in the same query as everything else,** instead of needing a second query just to count overdue invoices. It's the count-based sibling of the `SUM(CASE WHEN ...)` pattern used everywhere else in these two files.
- **A plain `COUNT(*)` (no `FILTER`) sits fine alongside `SUM(CASE WHEN...)` in the same aggregate query, with no `GROUP BY` needed** — every aggregate in the `SELECT` list runs over the same full row set matched by `WHERE user_id = $1`, so `COUNT(*)` just counts all of them while each `SUM` conditionally totals a subset. It's easy to miss the comma between the last `SUM(...)` and a trailing `COUNT(*)` when adding one to an existing list of aggregates by hand.
- **The aging report's bucketing logic depends entirely on `CURRENT_DATE - due_date` returning a plain integer day count** — Postgres date subtraction gives you an `integer` (days), which is what makes `BETWEEN 1 AND 30` etc. work directly without extra date-math functions.
- **Dashboard and Reports intentionally overlap rather than share one endpoint.** Both compute revenue/outstanding, but dashboard is tuned for an at-a-glance snapshot (recent invoices, client count) while reports is tuned for analysis (trends, aging, top clients, status breakdown). Duplicating a couple of simple sums across two endpoints is a reasonable trade for keeping each endpoint's query focused on what its specific UI needs.
- **Testing against real, non-trivial data (not just an empty database) is what actually validates aggregation logic.** The zeroed dashboard/reports responses from Stage 5 only proved the queries didn't crash; this session's test — with two real unpaid invoices — is what confirmed the `SUM`/`COALESCE`/bucketing logic produces the *correct* numbers, not just *some* numbers.

---

## Stage 8: Settings & Services Catalog APIs

**Logic Flow**

- **`routes/settings.js` is deliberately thin** because there's really only one row per user to manage — no list, no ID param, no ownership check needed beyond "which user is this." `GET /` calls `Settings.ensure()`, which (from Stage 4) upserts a default row if none exists yet, so the endpoint never 404s for a user who hasn't touched settings before. `PATCH /` hands the validated body straight to `Settings.update()`, which — also from Stage 4 — only rebuilds `SET` clauses for allow-listed fields actually present, so sending just `{ "tax_rate": 8.5 }` leaves everything else untouched.

- **`routes/items.js` follows the same CRUD shape established by Clients (Stage 5) almost exactly** — list, create, partial update via a dynamic `SET` builder, delete — just against `catalog_items` instead of `clients`. Recognizing that repeated shape is useful: once you've built this pattern once, most single-table CRUD resources in the app are a copy-adapt job rather than something to design from scratch each time.

- **The catalog exists purely to save typing on the invoice line-item builder** — nothing in this file talks to `invoices` or `invoice_items` directly. The connection is one-directional and manual: the frontend's "From Catalog" picker reads from `GET /api/items`, and picking one just pre-fills a line item's `description`/`rate` in the invoice form. There's no foreign key tying an invoice line item back to the catalog item it came from, which is intentional — editing a catalog item's rate later shouldn't retroactively change the amount on invoices you already sent.

- **`rate` is normalized to a JS `Number` in every response** (`{ ...r, rate: Number(r.rate) }`) because Postgres's `NUMERIC` type is returned by `pg` as a string by default, to avoid floating-point precision loss. Casting it back to `Number` at the API boundary keeps the JSON response using an actual number type for the frontend, consistent with how `invoice.js` and the reports routes already handle every other money field.

**Manual Verification (Postman)**
- `PATCH http://localhost:8000/api/settings`
  ```json
    {
        "company_name": "Chen Studio",
        "address": "410 Townsend St, San Francisco, CA",
        "currency": "USD",
        "tax_rate": 8.5,
        "invoice_prefix": "INV-"
    }
  ```
    → `200 OK`
  ```json
    {
        "settings": {
            "user_id": "62ddc9a3-d9b9-4421-ab55-a44979571f89",
            "company_name": "Chen Studio",
            "logo_url": "",
            "address": "410 Townsend St, San Francisco, CA",
            "email": "jsmith@timetoprogram.com",
            "phone": "",
            "currency": "USD",
            "tax_rate": "8.500",
            "invoice_prefix": "INV-",
            "next_seq": 4,
            "accent_color": "",
            "created_at": "2026-09-08T06:40:05.662Z",
            "updated_at": "2026-09-30T01:42:44.831Z"
        }
    }
  ```
  Confirms only the five submitted fields changed — `email` still reflects the value set back in registration, and `next_seq` (already at 4 from prior invoice creation) was untouched by this update. Note `tax_rate` comes back as the string `"8.500"`, not a number — unlike `items.js`, `settings.js` doesn't currently cast `NUMERIC` fields to `Number` before responding, so the frontend will need to handle that itself (or a future pass could add the same normalization used for `rate`).
  
  ---
- `POST http://localhost:8000/api/items`
  ```json
    { "name": "Frontend development", "rate": 95, "unit": "hour" }
  ```
    → `201 Created`
  ```json
    {
        "item": {
            "id": "82fe1e79-4ce4-48cc-828b-119314cb8177",
            "user_id": "62ddc9a3-d9b9-4421-ab55-a44979571f89",
            "name": "Frontend development",
            "description": "",
            "rate": 95,
            "unit": "hour",
            "created_at": "2026-09-30T01:49:49.487Z",
            "updated_at": "2026-09-30T01:49:49.487Z"
        }
    }
  ```
    Confirms the omitted `description` field correctly defaulted to an empty string, and `rate` came back as an actual number (`95`, not `"95.00"`) — the `Number(item.rate)` cast doing its job.

---

## Stage 9: Expenses & Payments APIs (auto-reconciling invoices)

**Logic Flow**

- **`routes/expenses.js` is the Stage 5/8 CRUD shape with one new idea: a dynamic filtered `GET`.** The handler builds its `WHERE` clause from two arrays that grow together: `where` holds the SQL fragments and `params` holds their values. Each optional filter (`category`, `month`) pushes its value onto `params` and then references it as `$${params.length}`, so the placeholder number always matches the value's position. With no filters, only `user_id = $1` is applied.
- **The totals and category list deliberately ignore the filters.** The totals query and the `SELECT DISTINCT category` query run separately from the filtered list and only scope by `user_id`. The header cards ("total spend", "spent this month") and the category dropdown therefore stay stable while the user filters the table.
- **`ser()` and `num()` normalize money at the API boundary.** Postgres `NUMERIC` comes back from `pg` as a string, so every response converts `amount` back to a real number, consistent with the other money fields in the app.
- **`routes/payments.js` is built around `reconcileInvoice()`, the function that makes invoice status "tell the truth" automatically.** It receives a transaction `client` and an `invoiceId`, then:
  1. Fetches the invoice `total` and re-sums every payment recorded against it in one query.
  2. If `paid >= total` (and the total is above zero), it flips the invoice to `paid`. `COALESCE(paid_at, now())` stamps the timestamp once and preserves the original paid date if more payments arrive later.
  3. Otherwise it reverts a `paid` invoice back to `sent` and clears `paid_at`. An invoice that was never paid is left alone.
- **`POST /` runs in two phases.** The first phase is an ownership check: it looks up the invoice by `id` and `user_id` outside the transaction and 404s if it isn't the user's. This stops anyone from attaching payments to someone else's invoice by guessing a UUID. The second phase is the transaction, which inserts the payment and calls `reconcileInvoice` before committing. If either step throws, both roll back, so the payment ledger and the invoice status can never disagree.
- **`DELETE /:id` mirrors the same pattern in reverse.** It looks up the payment's `invoice_id` first (scoped to the user), then deletes the payment and re-reconciles inside one transaction. Removing a payment that had fully covered an invoice automatically reverts it to `sent`.
- **Invoice status is derived, not manually maintained.** Nothing in the payments flow trusts a client to say "this invoice is paid." The server computes it from the actual payment rows every time, so it's the same server-owns-the-money-math boundary established in Stage 6.

**Manual Verification (Postman)**

- `POST http://localhost:8000/api/expenses`
```json
  { "vendor": "Adobe", "category": "Software", "amount": 54.99 }
```
  → `201 Created`
```json
  {
      "expense": {
          "id": "84b2daba-e3f0-4ba6-be0d-52f5abe3d9a2",
          "user_id": "62ddc9a3-d9b9-4421-ab55-a44979571f89",
          "vendor": "Adobe",
          "category": "Software",
          "expense_date": "2026-10-08T04:00:00.000Z",
          "amount": 54.99,
          "currency": "USD",
          "notes": "",
          "created_at": "2026-10-08T03:36:36.643Z",
          "updated_at": "2026-10-08T03:36:36.643Z"
      }
  }
```
  Confirms the omitted `expense_date`, `currency`, and `notes` fell back to their defaults, and `amount` came back as a number.

- **Test 1: partial payment leaves the invoice as `sent`.** `POST http://localhost:8000/api/payments`
```json
  {
      "invoiceId": "24318c62-a657-481d-ace7-2eaa4d055816",
      "amount": 5480,
      "method": "Bank transfer"
  }
```
  → `201 Created` with the payment record. Then `GET /api/invoices` shows the invoice still `"sent"` with `paid_at: null`. The invoice total is `5945.8` (subtotal 5480 plus 465.80 tax), so 5480 doesn't cover it. The invoice's `updated_at` matched the payment's `created_at` to the millisecond, which shows the reconcile ran in the same transaction and correctly took the "not fully covered" branch.

- **Test 2: multi-payment sum flips the invoice to `paid`.** Record the remaining balance against the same invoice:
```json
  {
      "invoiceId": "24318c62-a657-481d-ace7-2eaa4d055816",
      "amount": 465.8,
      "method": "Bank transfer"
  }
```
  `5480 + 465.80 = 5945.80`, which meets the total. `GET /api/invoices` shows the invoice as `"paid"` with a `paid_at` timestamp. This proves `reconcileInvoice` sums all payments rather than just checking the latest one.

- **Test 3: single full payment.** Record the full invoice total on a separate unpaid invoice (swap in its `id`):
```json
  {
      "invoiceId": "<unpaid-invoice-id>",
      "amount": 5945.8,
      "method": "Credit card"
  }
```
  The invoice flips to `"paid"` in a single call.

**Takeaways**

- **When something "doesn't update," check the numbers before the code.** The first reconcile test left the invoice as `sent` because the payment was the invoice's subtotal (5480), not its total (5945.80). The tax is easy to forget. The matching `updated_at` and `created_at` timestamps were the clue that the reconcile ran and behaved correctly.
- **The transaction here is what makes the feature trustworthy, not just convenient.** A payment row and an invoice status are two separate writes. Without `withTransaction`, a crash between them would leave money recorded against an invoice that still says `sent`, or the reverse. Wrapping both means they succeed or fail together.
- **Compare with `>=`, and guard the zero case.** Using `paid >= total` handles overpayments naturally instead of requiring an exact match. The `total > 0` guard stops a zero-total invoice from being marked paid by any payment.
- **Reconcile after deletes, not just inserts.** It's easy to build "payment recorded, invoice paid" and forget the reverse. Because `DELETE` also calls `reconcileInvoice`, the invoice status is always a function of the payment rows currently in the table, whatever order things happened in.
- **A dynamic `WHERE` builder is the same idea as the dynamic `SET` builder.** Both push values onto a params array and reference them with `$${array.length}`, so placeholder numbers can never drift out of sync with their values. This keeps every value parameterized (no string-concatenated user input in SQL) even when the query shape changes.
- **Do ownership checks before opening a transaction.** The invoice lookup fails fast with a clean 404 before any connection is checked out for writes, so rejected requests never touch the transaction path.

---

## Stage 10: AI Features with Google Gemini

**Logic Flow**

- **The upload layer comes first.** `middleware/upload.js` configures Multer with `memoryStorage()`, so the file lives in a buffer on `req.file` instead of being written to disk. That means there's no temp file to clean up, and the bytes can go straight to Gemini. Limits (10MB, one file) and a MIME allow-list are enforced before the handler ever runs. The `uploadReceipt()` wrapper exists because Multer reports problems through its own error types. The wrapper catches those, translates them into `ApiError.badRequest` messages ("File exceeds 10MB limit", "Upload a PDF or image"), and also rejects requests with no file at all.

- **The service layer holds all the AI logic.** `services/geminiService.js` builds the Gemini client only if `GEMINI_API_KEY` exists. Every feature starts with `requireAi()`, so a missing key returns a clear 500 on the AI routes instead of crashing the whole server at boot. All four features go through one `generate()` helper, which calls the model named in `GEMINI_MODEL`, returns the text, and throws if the response is empty.

- **Feature 1, receipt parsing, uses structured output.** The request has three parts: a prompt, the file as base64 `inlineData`, and a `responseSchema` describing the exact JSON shape wanted (vendor, date, currency, subtotal, tax, total, category, notes, and an array of line items with description, quantity, and rate). With `responseMimeType: "application/json"` and a temperature of 0.1, Gemini returns data instead of prose. The reply then passes through a Zod validator whose defaults fill any missing field, so downstream code never sees `undefined`. Parse failures are caught and rethrown as a clear server error rather than leaking a raw `SyntaxError`. The `image/jpg` alias is also normalized to `image/jpeg` before sending.

- **Feature 2, business summary, is grounded in database facts.** The route runs the queries first: a single aggregate for revenue this month, revenue last month, outstanding, overdue count, and overdue total, plus a second query for the top three overdue invoices with client names. It shapes those into a small `data` object and only then asks Gemini to summarize it. The prompt asks for 2-3 sentences, a percentage trend if computable, and one actionable suggestion. The response returns both the `summary` and the `data` it was based on, which makes the output easy to check.

- **Feature 3, payment reminders, shifts tone and splits the result.** The route loads the invoice joined to its client, scoped by `user_id` so you can't draft reminders for someone else's invoice. It gets the company profile through `Settings.ensure()` for the signature, falling back to the user's name if no company name is set. Days overdue is `(now − due_date) / 86,400,000 ms`, floored and never below zero, with zero for invoices that have no due date. The `tone` value (`friendly`, `firm`, or `final`) selects a tone guide in the prompt. The service asks for "a subject line, then a blank line, then the body" and splits the text at the first newline into `{ subject, body }`, stripping a leading "Subject:" if the model adds one. The route returns `meta.to` with the client's email so the UI knows where the draft goes.

- **Feature 4, write note, is a pass-through.** The route validates `kind` (`description` or `terms`), an optional prompt capped at 600 characters, and optional line items and client context. The service builds a prompt from whichever pieces were supplied, with `.filter(Boolean)` dropping the empty ones, and returns plain text.

- **The route file is plumbing.** `routes/ai.js` applies `requireAuth` to the whole router, then each endpoint chains `aiLimiter` first. On `/receipt-parse`, the limiter runs before `uploadReceipt`, so a rate-limited request is rejected before any file gets parsed into memory. Finally, `server.js` mounts the router at `/api/ai`.

**Manual Verification (Postman)**

No automated tests this session. The endpoints are exercised by hand, and the seed script in the next stage will supply realistic data to exercise the summary and reminder routes.

- `POST http://localhost:8000/api/ai/receipt-parse`
  - Body → form-data, with a key named `file` set to type **File** and a PNG of a receipt attached
  - Expected: the vendor, date, every line item with its quantity and price, the subtotal, and the total, returned as `{ "result": { ... } }`

- `POST http://localhost:8000/api/ai/write-note`
```json
  {
      "kind": "terms",
      "prompt": "net 15, friendly"
  }
```
  → `200 OK`
```json
  { "text": "We appreciate your business! Payment is due within 15 days of the invoice date." }
```
  Confirms the full route → validation → service → Gemini → trimmed text path works end to end.

**Takeaways**

- **Don't ask the model to guess. Give it facts.** The business summary works because the database does the arithmetic (revenue, overdue totals, top offenders) and Gemini only turns a small, accurate JSON object into readable language. That's far more reliable than handing a model raw rows and hoping it adds them up correctly.
- **Structured output turns an AI call into a normal function call.** Passing a `responseSchema` means Gemini returns JSON in a known shape instead of free text you'd have to scrape. Validating it with Zod afterward is a second safety net: the schema steers the model, and Zod guarantees what your code receives.
- **Treat model output as untrusted input.** Even with a schema, a response can be malformed or incomplete. Catching parse and validation failures and returning one clear server error is better than letting a raw `SyntaxError` or a misleading 400 "Validation failed" reach the client, who sent a perfectly good request.
- **Temperature should match the task.** Receipt extraction runs at 0.1 because there is one right answer and you want repeatability. Summaries sit at 0.5, reminders at 0.6, and notes at 0.7, where some variety in wording is welcome.
- **Memory storage is the right fit here and has a limit.** Keeping the upload in a buffer avoids disk cleanup and gives Gemini the bytes directly. The trade-off is that each in-flight upload holds up to 10MB in RAM, which is why the size cap and single-file limit matter.
- **Order middleware by cost.** The rate limiter runs before the upload parser, and authentication runs before both. The cheapest checks reject bad requests first, before any file is buffered or any paid API call is made.
- **Keep routes thin and services deep.** The routes only gather inputs and shape outputs. Prompts, schemas, and model settings live in one service file, so swapping models, tuning a prompt, or replacing Gemini later touches one place.
- **Make a missing key fail softly.** Building the client conditionally and checking it per request means the rest of the app keeps working in an environment without an API key, and the AI routes explain exactly what's missing.
- **Third-party helper signatures can change between major versions, so check the README when upgrading.** `ipKeyGenerator` in express-rate-limit v8 takes the IP string, not the request and response objects. The old call shape can fail silently, and a limiter that never trips looks identical to one that works until someone actually hammers the endpoint. A quick test is to send 31 bad logins in a row and confirm the 31st returns a 429.