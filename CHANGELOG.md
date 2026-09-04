# Invoicer — Changelog

## v0.1.0 — Initial Commit
**Release Date:** September 4, 2026

- Set up README for **Invoicer**, an AI-powered invoicing and billing app
- Cloned frontend UI boilerplate, installed packages, and verified it runs
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