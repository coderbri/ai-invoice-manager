/**
 * @file: utils/jwt.js
 * @description Signs and verifies JSON Web Tokens and defines secure authentication cookie options.
 */

const jwt = require("jsonwebtoken");
const env = require("../config/env");

/**
 * Creates and verifies JSON Web Tokens using the configured secret and expiration.
 */

function signToken(payload) {
    return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
}

function verifyToken(token) {
    return jwt.verify(token, env.jwtSecret);
}

/**
 * Cookie settings for securely storing authentication tokens.
 */
const cookieOptions = {
    httpOnly: true,
    secure: env.isProd,
    sameSite: env.isProd ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
};

module.exports = { signToken, verifyToken, cookieOptions };
