# Invoicer — Full Documentation

> The complete reference for Invoicer. For a quick overview, see the [main README](../README.md).

> Invoicing that runs itself. Snap a photo of a receipt and the AI fills in your invoice, writes your payment reminders, and summarizes your month in plain English.

![Invoicer landing page](screenshots/landing.png)

![Node](https://img.shields.io/badge/Node-%E2%89%A520-339933?logo=node.js&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Neon-4169E1?logo=postgresql&logoColor=white)
![Gemini](https://img.shields.io/badge/AI-Google%20Gemini-8E75B2?logo=googlegemini&logoColor=white)

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [API Reference](#api-reference)
- [Database Schema](#database-schema)
- [Security & Reliability](#security--reliability)
- [Project Structure](#project-structure)
- [Screenshots](#screenshots)
- [Development Log](#development-log)
- [Background & Acknowledgments](#background--acknowledgments)

## Overview

Invoicer is a full-stack billing tool with AI built into the parts of invoicing that are actually tedious. Underneath the AI features, it is a complete billing system: a client CRM, invoices with a live line-item builder and PDF export, payment tracking that reconciles itself, expense management, a reusable services catalog, and an analytics dashboard.

The backend is a REST API built on Express and PostgreSQL (hosted on Neon). Google Gemini powers all four AI features. The frontend is a React single-page app that talks to the API through an HTTP-only cookie session.

## Features

### AI features (Google Gemini)

| Feature | What it does |
| --- | --- |
| **Receipt scanning** | Upload a photo or PDF of a receipt. Gemini's vision model reads the vendor, date, every line item (quantity and price), subtotal, tax, and total, then pre-fills an invoice or an expense, including a suggested category. |
| **AI business summary** | One click produces a plain-English read on your month: revenue versus last month, overdue invoices and their total, and a specific follow-up suggestion. The numbers come from database queries, not from the model guessing. |
| **AI payment reminders** | Pick a tone (friendly, firm, or final notice) and Gemini drafts the reminder email, tuned to how overdue the invoice is, ready to copy. |
| **Write with AI** | Drafts a professional service description or a payment-terms note so you aren't staring at a blank box. |

### Core billing

- **Authentication:** cookie-based sessions that survive a page refresh and re-authenticate automatically
- **Clients (CRM):** a card per client with total billed and amount owed, plus a detail page with invoice history and per-client charts
- **Invoices:** live line-item builder with subtotal, tax, discount, and grand total updating as you type; status controls (draft, sent, paid); PDF export
- **Payments:** a ledger of incoming payments. Recording a payment that covers an invoice automatically flips it to paid, and deleting one reverts it, so there is no double bookkeeping
- **Expenses:** track business costs with category filters and total and this-month spend
- **Services catalog:** save common services and rates (for example, "Frontend development, $95/hour") and drop them into any invoice with one click
- **Analytics dashboard:** revenue, outstanding, collected this month, and overdue stats; a six-month revenue chart; collection-rate gauge; invoice status breakdown; receivables aging (current, 1–30, 31–60, 61–90, 90+ days); top clients; recent invoices
- **Reports:** revenue versus expenses over six months, status breakdown, aging, top clients, and CSV export
- **Settings:** company profile (name, logo, address) that flows onto every invoice and PDF, plus invoicing defaults (currency, tax rate, invoice number prefix), appearance, and password change
- **Quality of life:** `Cmd/Ctrl + K` command palette to jump to any page or search invoices and clients, light and dark themes that persist, and notifications for overdue invoices

## Tech Stack

| Layer | Technology |
| --- | --- |
| **Frontend** | React 19, Vite, Tailwind CSS v4, React Query, React Router 7, Framer Motion, Recharts, lucide-react, @react-pdf/renderer |
| **Backend** | Node.js (≥ 20), Express 5 |
| **Database** | PostgreSQL on Neon, accessed with `pg` |
| **AI** | Google Gemini via `@google/genai` |
| **Auth & security** | JWT in an HTTP-only cookie, bcrypt, `express-rate-limit`, CORS |
| **Validation & uploads** | Zod, Multer (in-memory storage) |

## Architecture

```mermaid
flowchart LR
    UI["React + Vite frontend"] -->|"/api requests + HTTP-only cookie"| API["Express 5 API"]
    API -->|"parameterized SQL"| DB[("PostgreSQL on Neon")]
    API -->|"structured prompts"| AI["Google Gemini"]
```

The API follows a layered structure: **routes** handle HTTP and validation, **models** and SQL queries handle persistence, and a dedicated **service** owns all Gemini logic. In the AI routes, the database does the arithmetic first and Gemini only turns small, accurate facts into readable language.

## Getting Started

### Prerequisites

- Node.js 20 or newer
- A [Neon](https://neon.tech) Postgres database (turn on **Connection pooling**)
- A [Google AI Studio](https://aistudio.google.com/apikey) API key for Gemini

### 1. Clone and install

```bash
git clone https://github.com/codebrbri/ai-invoice-manager.git
cd ai-invoice-manager

cd backend && npm install
cd ../frontend && npm install
```

### 2. Configure the backend

Create a `.env` file in the `backend/` folder (see [Environment Variables](#environment-variables)). Generate a strong JWT secret with:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 3. Set up the database and demo data

```bash
cd backend
npm run migrate   # applies the schema
npm run seed      # creates a demo account with realistic data
```

The seed script creates a demo account loaded with 28 clients, 14 catalog items, 84 invoices spread over about 11 months (each paid invoice with a matching payment), and 49 expenses. It is safe to rerun: it resets only the demo account's data and leaves other users untouched.

> The server also applies the schema on startup, so `npm run migrate` is optional.

### 4. Run the app

Start the backend and the frontend, each in its own terminal:

```bash
# Terminal 1: API on http://localhost:8000
cd backend
npm run dev

# Terminal 2: frontend on http://localhost:5173
cd frontend
npm run dev
```

The frontend dev server proxies `/api` requests to the backend on port 8000, so start the backend first.

Open [http://localhost:5173](http://localhost:5173) and sign in with the demo account (the login page has a **Use demo credentials** button):

| Email | Password |
| --- | --- |
| `alex@timetoprogram.com` | `Test@1234` |

To confirm the API is up, visit `http://localhost:8000/api/health`. It reports the server's uptime and whether the database connection is live.

## Environment Variables

| Variable | Description | Example |
| --- | --- | --- |
| `NODE_ENV` | Runtime environment | `development` |
| `PORT` | API port | `8000` |
| `DATABASE_URL` | Neon connection string (**required**) | `postgresql://user:password@host.neon.tech/dbname?sslmode=require` |
| `JWT_SECRET` | Secret used to sign session tokens (**required**) | a long random string |
| `JWT_EXPIRES_IN` | Session lifetime | `7d` |
| `COOKIE_NAME` | Name of the session cookie | `aibm_token` |
| `CLIENT_ORIGIN` | Allowed frontend origin(s) for CORS, comma-separated | `http://localhost:5173` |
| `GEMINI_API_KEY` | Google Gemini API key. Without it, the AI endpoints return a clear error and the rest of the app works normally. | `your_gemini_api_key_here` |
| `GEMINI_MODEL` | Gemini model to use | `gemini-3.8-flash` |

The server validates `DATABASE_URL` and `JWT_SECRET` at startup and exits immediately with a clear message if either is missing.

## API Reference

All routes live under `/api`. Everything except `/health`, `/auth/register`, and `/auth/login` requires a valid session cookie, and every query is scoped to the authenticated user.

| Resource | Endpoints |
| --- | --- |
| **Health** | `GET /health` |
| **Auth** | `POST /auth/register` · `POST /auth/login` · `POST /auth/logout` · `GET /auth/me` · `PATCH /auth/profile` · `PATCH /auth/password` |
| **Clients** | `GET /clients` · `POST /clients` · `GET /clients/:id` · `PATCH /clients/:id` · `DELETE /clients/:id` |
| **Invoices** | `GET /invoices` (filter, search, sort) · `POST /invoices` · `GET /invoices/:id` · `PATCH /invoices/:id` · `PATCH /invoices/:id/status` · `DELETE /invoices/:id` |
| **Payments** | `GET /payments` · `POST /payments` · `DELETE /payments/:id` |
| **Expenses** | `GET /expenses` (category and month filters) · `POST /expenses` · `PATCH /expenses/:id` · `DELETE /expenses/:id` |
| **Items (catalog)** | `GET /items` · `POST /items` · `PATCH /items/:id` · `DELETE /items/:id` |
| **Dashboard** | `GET /dashboard` |
| **Reports** | `GET /reports` |
| **Settings** | `GET /settings` · `PATCH /settings` |
| **AI** | `POST /ai/receipt-parse` (multipart file upload) · `POST /ai/business-summary` · `POST /ai/payment-reminder` · `POST /ai/write-note` |

Errors use one consistent shape across the whole API:

```json
{
  "error": {
    "message": "Validation failed",
    "details": []
  }
}
```

## Database Schema

Eight PostgreSQL tables, all scoped to a user and cascading on delete:

| Table | Purpose |
| --- | --- |
| `users` | Accounts, with bcrypt password hashes |
| `company_settings` | One row per user: company profile, currency, tax rate, invoice prefix, and the next invoice number |
| `clients` | The client CRM |
| `invoices` | Invoice header, totals, and status, with a unique invoice number per user |
| `invoice_items` | Line items, ordered by `position` |
| `catalog_items` | Reusable services and rates |
| `expenses` | Business expenses |
| `payments` | Payments recorded against invoices |

## Security & Reliability

- **Sessions in an HTTP-only cookie.** The JWT is never exposed to client-side JavaScript. The cookie is `secure` and `sameSite: none` in production, and `lax` in development.
- **Passwords hashed with bcrypt** (cost factor 12), and the hash is never returned in any response.
- **Ownership checks on every query.** Authentication proves who you are, and a `user_id` filter on each query stops one user from reaching another user's data by guessing an ID.
- **The server owns the money math.** Clients send only description, quantity, and rate. Line amounts, subtotal, tax, and total are all computed server-side, so a tampered request can't change what an invoice adds up to.
- **Transactions for multi-step writes.** An invoice and its line items are saved atomically, a payment and the invoice-status update succeed or fail together, and sequential invoice numbers are generated without collisions.
- **Validation at the edge.** Every request body, param, and upload is checked with Zod before it reaches the handler, and all SQL is parameterized.
- **Rate limiting.** AI endpoints are capped at 15 requests per minute per user to control Gemini costs, and auth endpoints are capped per IP to slow brute-force attempts.
- **Centralized error handling.** Postgres error codes (duplicate value, missing reference, bad identifier) and validation errors are translated into clean responses, and stack traces are hidden in production.
- **Upload safety.** Receipts are limited to 10 MB, one file, and an allow-list of PDF and image types. Files are held in memory and never written to disk.

## Project Structure

```
ai-invoice-manager/
├── backend/
│   ├── scripts/
│   │   ├── migrate.js          # apply the schema
│   │   └── seed.js             # generate the demo account's data
│   └── src/
│       ├── config/             # env loading, DB pool, schema
│       ├── middleware/         # auth, errorHandler, rateLimit, upload, validate
│       ├── models/             # User, Settings
│       ├── routes/             # ai, auth, clients, dashboard, expenses,
│       │                       # health, invoices, items, payments, reports, settings
│       ├── services/           # geminiService (all AI logic)
│       ├── utils/              # ApiError, asyncHandler, invoice math, jwt
│       └── server.js
├── frontend/
│   └── src/
│       └── api/                # axios client and one module per resource
├── docs/
│   ├── DOCUMENTATION.md
│   ├── NOTES.md
│   ├── invoicer-feature-reference.md
│   └── screenshots/
├── CHANGELOG.md
├── LICENSE
└── README.md
```

## Screenshots

### Landing and sign in

| Landing page | Sign in |
| --- | --- |
| ![Landing page](screenshots/landing.png) | ![Sign in](screenshots/login.png) |

### Dashboard

| Light | Dark |
| --- | --- |
| ![Dashboard in light mode](screenshots/dashboard-light.png) | ![Dashboard in dark mode](screenshots/dashboard-dark.png) |

![AI business summary](screenshots/ai-business-summary.png)

### Invoicing

![Invoice builder with live totals](screenshots/invoice-builder.png)

![Scanning a receipt into an invoice](screenshots/receipt-scan.GIF)

| Invoice detail | AI payment reminder |
| --- | --- |
| ![Invoice detail](screenshots/invoice-detail.png) | ![AI payment reminder](screenshots/payment-reminder.png) |

### Clients, payments, and expenses

| Clients | Client detail |
| --- | --- |
| ![Clients](screenshots/clients.png) | ![Client detail](screenshots/client-detail.png) |

| Payments | Expenses |
| --- | --- |
| ![Payments](screenshots/payments.png) | ![Expenses](screenshots/expenses.png) |

### Reports, catalog, and settings

![Reports](screenshots/reports.png)

| Services catalog | Settings |
| --- | --- |
| ![Services catalog](screenshots/items.png) | ![Settings](screenshots/settings.png) |

### Under the hood

#### Seeded database in Neon
![Neon tables](screenshots/neon-tables.png) 

#### Seed script output

```bash
$ npm run migrate → ✅ Schema applied.
$ npm run seed →

User ready: alex@timetoprogram.com (existing)
Created 28 clients
Created 14 catalog items
Created 84 invoices (50 paid + payments)
Created 49 expenses
✅ Seed complete.
``` 

## Development Log

The project was built in ten versioned sessions, from an empty backend folder to a fully connected app. See [CHANGELOG.md](../CHANGELOG.md) for what shipped in each version, and [NOTES.md](../docs/NOTES.md) for the commands, logic breakdowns, and lessons learned along the way.

| Version | Milestone |
| --- | --- |
| v0.1.0 | Backend scaffold, Neon PostgreSQL, and database schema |
| v0.2.0 | Core utilities, server boot, and centralized error handling |
| v0.3.0 | Authentication (register, login, cookie sessions) |
| v0.4.0 | Clients CRUD |
| v0.5.0 | Invoices with line items, totals, and status in a transaction |
| v0.6.0 | Dashboard and reports (SQL aggregations, aging report) |
| v0.7.0 | Settings and services catalog |
| v0.8.0 | Expenses and auto-reconciling payments |
| v0.9.0 | Gemini AI features |
| v0.10.0 | Demo data seeding and frontend connection |

## Background & Acknowledgments

Invoicer was built as a guided tutorial project. The frontend UI came from a boilerplate that originally ran on mock data, and I built the backend from scratch (the API, database schema, authentication, business logic, and Gemini integration) and then connected the frontend to it by replacing the mock layer with real API calls.

Tutorial credit: [Full-Stack AI Invoicing & Billing App Tutorial | React, Node.js, Postgres & Google Gemini](https://youtu.be/FrRSqYYzBlk?si=UyNk68Um664ud508) | Time to Program.

## License

Released under the [MIT License](LICENSE). The frontend UI boilerplate comes from the tutorial credited above and is not covered by this license.