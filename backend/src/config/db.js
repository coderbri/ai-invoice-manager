/**
 * @file: db.js
 * @description PostgreSQL connection pool initialization, query abstractions, 
 * transaction helper, and database bootstrap logic optimized for Neon serverless Postgres.
 */

const { Pool } = require("pg");
const env = require("./env");
const { SCHEMA_SQL } = require("./schema");

/** Configure Neon PostgreSQL connection pool with SSL enabled. */
const pool = new Pool({
    connectionString: env.databaseUrl,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
});

// Global pool error handler to catch unexpected idle client errors
pool.on("error", (err) => {
    console.error("Postgres pool error:", err.message);
});

/**
 * Executes a parameterized SQL query against the connection pool.
 * @param {string} text - SQL statement with placeholders ($1, $2, etc.)
 * @param {Array<any>} [params] - Parameter values to safely bind
 * @returns {Promise<import('pg').QueryResult>} Query result object
 */
async function query(text, params) {
    return pool.query(text, params);
}

/**
 * Helper to execute a query and return only the first row.
 * @param {string} text - SQL statement with placeholders
 * @param {Array<any>} [params] - Parameter values
 * @returns {Promise<Object|null>} Single row record or null if empty
 */
async function queryOne(text, params) {
    const { rows } = await pool.query(text, params);
    return rows[0] || null;
}

/**
 * Executes a callback function within an isolated database transaction block (BEGIN...COMMIT/ROLLBACK).
 * Useful for atomic multi-statement operations such as invoice creation with line items or payment reconciliation.
 * 
 * @param {function(import('pg').PoolClient): Promise<any>} fn - Async function accepting a dedicated client
 * @returns {Promise<any>} Result of the callback execution
 */
async function withTransaction(fn) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
    } catch (err) {
        await client.query("ROLLBACK");
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Verifies database connection on startup and ensures required tables and indexes exist.
 * @returns {Promise<void>}
 */
async function connectDB() {
    const { rows } = await pool.query("SELECT current_database() AS db");
    await pool.query(SCHEMA_SQL);
    console.log(`Postgres connected: ${rows[0].db} (schema ready)`);
}

module.exports = { pool, query, queryOne, withTransaction, connectDB };
