# Invoicer — Build Notes

### Table of Contents

- [Stage 1: Backend Scaffold & Environment Setup](#stage-1-backend-scaffold--environment-setup)
- [Stage 2: Database Layer (Neon Postgres, Schema, Connection Pool)](#stage-2-database-layer-neon-postgres-schema-connection-pool)


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