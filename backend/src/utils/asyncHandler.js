/**
 * @file: utils/asyncHandler.js
 * @description Wraps asynchronous Express handlers and forwards rejected promises to error middleware.
 */

/**
 * Wraps an asynchronous Express handler and passes errors to the next middleware.
 */

const asyncHandler = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

module.exports = asyncHandler;
