/**
 * @file: models/User.js
 * @description Provides user persistence queries and password hashing helpers for authentication workflows.
 */

const bcrypt = require("bcrypt");
const { query, queryOne } = require("../config/db");

/** Selectable user fields that exclude the password hash. */
const PUBLIC_COLS = "id, email, name, created_at, updated_at";

/** Hashes and compares user passwords with bcrypt. */
function hashPassword(plain) {
    return bcrypt.hash(plain, 12);
}

function comparePassword(plain, hash) {
    return bcrypt.compare(plain, hash);
}

/** Retrieves users by their email address or identifier. */
async function findByEmail(email) {
    return queryOne(`SELECT * FROM users WHERE email = $1`, [email]);
}

async function findById(id) {
    return queryOne(`SELECT ${PUBLIC_COLS} FROM users WHERE id = $1`, [id]);
}

async function findByIdWithHash(id) {
    return queryOne(`SELECT * FROM users WHERE id = $1`, [id]);
}

/** Creates and updates user records. */
async function create({ name, email, passwordHash }) {
    return queryOne(
        `INSERT INTO users (name, email, password_hash)
        VALUES ($1, $2, $3)
        RETURNING ${PUBLIC_COLS}`,
        [name, email, passwordHash]
    );
}

async function updateName(id, name) {
    return queryOne(
        `UPDATE users SET name = $2, updated_at = now()
        WHERE id = $1 RETURNING ${PUBLIC_COLS}`,
        [id, name]
    );
}

async function updatePassword(id, passwordHash) {
    return query(
        `UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`,
        [id, passwordHash]
    );
}

module.exports = {
    PUBLIC_COLS,
    hashPassword,
    comparePassword,
    findByEmail,
    findById,
    findByIdWithHash,
    create,
    updateName,
    updatePassword,
};
