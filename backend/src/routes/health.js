/**
 * @file: routes/health.js
 * @description Exposes a health-check endpoint that reports service uptime and database connectivity.
 */

/**
 * Defines a health-check route for monitoring service and database status.
 */

const express = require("express");
const { pool } = require("../config/db");

const router = express.Router();

router.get("/", async (req, res) => {
    let db = "unknown";
    try {
        await pool.query("SELECT 1");
        db = "connected";
    } catch (error) {
        db = "disconnected";
    }
    res.json({
        status: "ok",
        uptime: process.uptime(),
        db,
        timestamp: new Date().toISOString(),
    });
});

module.exports = router;
