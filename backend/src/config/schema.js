/**
 * @file: schema.js
 * @description PostgreSQL database schema definitions. Contains DDL statements for
 * authentication, user settings, client CRM, invoicing, catalog items, expenses,
 * and payment records along with optimization indexes.
 */

const SCHEMA_SQL = `
-- User authentication credentials and core profile info
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    name            TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-user invoice defaults and branding configuration (populates PDFs)
CREATE TABLE IF NOT EXISTS company_settings (
    user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    company_name    TEXT NOT NULL DEFAULT '',
    logo_url        TEXT NOT NULL DEFAULT '',
    address         TEXT NOT NULL DEFAULT '',
    email           TEXT NOT NULL DEFAULT '',
    phone           TEXT NOT NULL DEFAULT '',
    currency        TEXT NOT NULL DEFAULT 'USD',
    tax_rate        NUMERIC(6,3) NOT NULL DEFAULT 0,
    invoice_prefix  TEXT NOT NULL DEFAULT 'INV-',
    next_seq        INTEGER NOT NULL DEFAULT 1,
    accent_color    TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Client CRM registry for invoicing and relationship management
CREATE TABLE IF NOT EXISTS clients (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    email           TEXT NOT NULL DEFAULT '',
    company         TEXT NOT NULL DEFAULT '',
    phone           TEXT NOT NULL DEFAULT '',
    address         TEXT NOT NULL DEFAULT '',
    notes           TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_clients_user ON clients(user_id);

-- Core billing invoices tracking status, totals, and lifecycle dates
CREATE TABLE IF NOT EXISTS invoices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id       UUID REFERENCES clients(id) ON DELETE SET NULL,
    invoice_number  TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'draft', -- draft | sent | paid
    issue_date      DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date        DATE,
    currency        TEXT NOT NULL DEFAULT 'USD',
    tax_rate        NUMERIC(6,3) NOT NULL DEFAULT 0,    -- percent
    discount        NUMERIC(12,2) NOT NULL DEFAULT 0,   -- flat amount
    subtotal        NUMERIC(12,2) NOT NULL DEFAULT 0,
    tax_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
    total           NUMERIC(12,2) NOT NULL DEFAULT 0,
    notes           TEXT NOT NULL DEFAULT '',
    terms           TEXT NOT NULL DEFAULT '',
    paid_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoices_user ON invoices(user_id);
CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_number ON invoices(user_id, invoice_number);

-- Line items linked to individual invoices
CREATE TABLE IF NOT EXISTS invoice_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id      UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    description     TEXT NOT NULL DEFAULT '',
    quantity        NUMERIC(12,2) NOT NULL DEFAULT 1,
    rate            NUMERIC(12,2) NOT NULL DEFAULT 0,
    amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
    position        INTEGER NOT NULL DEFAULT 0
);

-- Reusable products and services catalog for quick invoice builder insertion
CREATE TABLE IF NOT EXISTS catalog_items (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    rate        NUMERIC(12,2) NOT NULL DEFAULT 0,
    unit        TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_catalog_user ON catalog_items(user_id);

-- Business cost tracking (supports manual entry and Gemini receipt vision extraction)
CREATE TABLE IF NOT EXISTS expenses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vendor          TEXT NOT NULL DEFAULT '',
    category        TEXT NOT NULL DEFAULT 'General',
    expense_date    DATE NOT NULL DEFAULT CURRENT_DATE,
    amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
    currency        TEXT NOT NULL DEFAULT 'USD',
    notes           TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expenses_user ON expenses(user_id);

-- Incoming payment ledger linked to invoices for tracking and auto-reconciliation
CREATE TABLE IF NOT EXISTS payments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invoice_id  UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
    method      TEXT NOT NULL DEFAULT '',
    paid_on     DATE NOT NULL DEFAULT CURRENT_DATE,
    notes       TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
`;

module.exports = { SCHEMA_SQL };