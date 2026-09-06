# Invoicer — Changelog

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