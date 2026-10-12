# Invoicer — Feature Reference

AI-powered invoicing and billing app. This doc captures what the frontend already does, so the backend can be built to support it fully. **Goal for this project: build the backend only; the UI is being cloned/reused as-is.**

## Tech Stack
- **Database:** PostgreSQL, hosted on Neon
- **Backend:** Node.js + Express
- **Frontend:** React + Vite
- **AI:** Google Gemini (powers all AI features)
- **Auth:** Cookie-based sessions (server validates credentials, hashes password, issues a token in a cookie; auto-reauthenticates on return visits)

## Landing / Marketing Page
- Top nav: "Sign in" and "Get started" buttons
- Headline: "Invoicing that runs itself."
- Ambient visual: wall of invoice/payment cards gently auto-scrolling
- Feature highlights row: receipt scanning, revenue summaries, payment reminders, notes writer
- Full feature section: invoices, client CRM, payments & expenses, analytics, CTA panel
- "Get started" → signup page (split layout)

## Onboarding / Auth
- Signup form (left) + live invoice-card panel (right)
- Signup fields: name, email, password only
- Company details (name, logo, address) are filled in later under Settings, and flow onto every invoice/PDF
- Demo account available, pre-loaded with sample data
- Login: server verifies user + password hash, returns a session token in a cookie; cookie keeps user logged in and reauthenticates automatically

## App Shell
- Collapsible left nav rail (expands on hover with labels): Dashboard, Invoices, Clients, Expenses, Payments, Items, Reports
- Global search bar + Cmd+K command palette (jump to any page, search invoices/clients)
- Light/dark theme toggle — instant recolor across all cards/charts/gauges, preference persists
- Notifications (surfaces overdue invoices)
- Profile menu

## Dashboard
- Stat cards: total revenue collected, amount outstanding, paid this month, overdue count + dollar amount
- **AI Business Summary** (AI feature #1): on-demand Gemini call using current month's numbers → plain-English business recap (revenue collected, overdue invoices/amounts, suggested client to follow up with)
- Revenue chart: last 6 months collected
- Collection rate gauge (half-donut): collected vs. outstanding share
- Invoice status donut (by count and dollar amount)
- Receivables aging chart (30/60/90-day overdue buckets)
- Top clients ranked by amount billed
- Recent invoices list

## Clients (CRM)
- Client cards: total billed, amount still owed
- Add client: name, email, company
- Client detail page:
  - Contact info
  - Stat cards: invoice count, total billed, outstanding
  - Full invoice history with status
  - Payment status donut (paid/open/overdue) scoped to that client
  - Billing-over-time chart scoped to that client

## Invoices
- Create invoice: select client, status, issue date, due date
- Live line item builder: description, quantity, rate → amount auto-calculates; subtotal, tax, and grand total update live
- **From Catalog** button: insert a saved service/item with one click
- **Scan Receipt** (AI feature #2): upload a receipt image → sent to backend → Gemini vision reads vendor, date, and all line items (qty + price) → auto-fills the invoice
- **Write with AI** (AI feature #3): on notes and payment terms fields, Gemini drafts a professional service description or payment terms note
- Tax rate, discount, currency, and grand total controls
- Invoice detail page: company info (from Settings), client info, line items, totals
- Status controls: draft / sent / paid (one-click)
- Download PDF: generates a print-ready PDF of the invoice
- **AI Payment Reminder** (AI feature #4): choose a tone (friendly / firm / final notice) → Gemini writes a full reminder email tuned to how overdue the invoice is, one-click copy

## Payments
- Ledger of all incoming payments
- Record payment: select invoice (amount auto-fills), payment method, save
- Auto-reconciliation: recording a payment that fully covers an invoice automatically flips that invoice's status to "paid"

## Expenses
- Track business costs
- **Scan Receipt** (same AI feature as invoices, applied to expenses): Gemini reads vendor, amount, date, and suggests a category → prefills the expense for review
- Filter by category
- Totals: overall spend and spend this month

## Items (Catalog)
- Reusable list of common services/products and their rates
- Feeds the "From Catalog" picker in the invoice line item builder

## Reports
- Revenue vs. expenses, side by side, last 6 months
- Invoice status breakdown
- Receivables aging chart
- Top clients ranked
- Export CSV of the underlying data

## Settings
- Company profile: name, logo, address (flows onto invoices/PDFs)
- Invoicing defaults: default currency, tax rate, invoice number prefix
- Appearance: light/dark
- Change password

## AI Features Summary (all via Google Gemini)
1. **Business Summary** — plain-English monthly recap on the dashboard
2. **Receipt Scanning** — vision model reads receipts to auto-fill invoices and expenses
3. **Write with AI** — drafts invoice notes / payment terms
4. **Payment Reminder Generator** — tone-controlled reminder emails