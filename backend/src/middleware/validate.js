/**
 * @file: middleware/validate.js
 * @description Validates request data with Zod schemas before it reaches route handlers.
 */

/**
 * Creates middleware that parses a request source with a Zod schema.
 */

const ApiError = require("../utils/ApiError");

const validate = (schema, source = "body") => (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
        return next(ApiError.badRequest("Validation failed", result.error.issues));
    }
    req[source] = result.data;
    next();
};

module.exports = { validate };
