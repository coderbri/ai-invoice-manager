/**
 * @file: scripts/migrate.js
 * @description Standalone command that applies the database schema without starting the server.
 */

const { pool } = require("../src/config/db");
const { SCHEMA_SQL } = require("../src/config/schema");

/**
 * Self-running function that applies the schema, logs the result, and closes the pool.
 * This is what `npm run migrate` executes.
 */
(async () => {
    try {
        await pool.query(SCHEMA_SQL);
        console.log("✅ Schema applied.");
    } catch (error) {
        console.error("❌ Migration failed:", error.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
})();