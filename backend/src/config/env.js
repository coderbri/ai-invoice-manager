/**
 * @file config/environment.js
 * @description Centralized environment configuration module. Loads environment 
 * variables, verifies critical boot dependencies, and exports validated settings 
 * with production-ready fallbacks.
 */

const dotenv = require("dotenv");
const path = require("path")

/** Load .env from the project root (relative to backend/config) */
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

/** Fail fast on missing essential variables to prevent subtle runtime errors */
const required = ["DATABASE_URL" , "JWT_SECRET"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
    console.error(`Missing required env vars: ${missing.join(", ")}`);
    process.exit(1);
}

/**
 * Validated application configuration.
 * Single source of truth across all backend modules.
 */
module.exports = {
    nodeEnv: process.env.NODE_ENV || "development",
    port: Number(process.env.PORT) || 8000,
    databaseUrl: process.env.DATABASE_URL,
    jwtSecret: process.env.JWT_SECRET,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
    cookieName: process.env.COOKIE_NAME || "aibm_token",
    clientOrigins: (process.env.CLIENT_ORIGIN || "http://localhost:5173,http://localhost:5174")
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean),
    geminiApiKey: process.env.GEMINI_API_KEY || "",
    geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    isProd: process.env.NODE_ENV === "production",
}