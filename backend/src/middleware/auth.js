/**
 * @file: middleware/auth.js
 * @description Authenticates protected requests from signed session cookies and attaches the current user.
 */

const env = require("../config/env");
const { verifyToken } = require("../utils/jwt");
const ApiError = require("../utils/ApiError");
const User = require("../models/User");

/**
 * Verifies the session cookie, loads its user, and attaches that user to the request.
 */
async function requireAuth(req, res, next) {
    try {
        const token = req.cookies?.[env.cookieName];
        if (!token) throw ApiError.unauthorized();
        
        const payload = verifyToken(token);
        const user = await User.findById(payload.sub);
        if (!user) throw ApiError.unauthorized("Session no longer valid");
        
        req.user = user;
        next();
    } catch (error) {
        if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
            return next(ApiError.unauthorized("Invalid or expired session"));
        }
        next(error);
    }
}

module.exports = { requireAuth };
