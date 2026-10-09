/**
 * @file: middleware/rateLimit.js
 * @description Defines the two rate limiters: one capping AI requests per user to control Gemini costs, and one slowing down brute-force login attempts per IP.
 */

const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

/**
 * Caps Gemini calls at 15 per minute, keyed by user id when authenticated and by IP otherwise.
 * Gemini calls cost money and time, so this stops a runaway loop from quietly running up a bill.
 */
const aiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 15,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip),
    message: {
        error: { message: "Too many AI requests — please wait a minute and retry." },
    },
});

/**
 * Caps auth attempts at 30 per 15 minutes per IP, which slows down anyone trying to brute-force a login.
 */
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip),
    message: {
        error: { message: "Too many auth attempts — please wait and retry." },
    },
});

module.exports = { aiLimiter, authLimiter };