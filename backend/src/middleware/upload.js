/**
 * @file: middleware/upload.js
 * @description Handles receipt uploads with Multer, keeping the file in memory and rejecting oversized or unsupported files with friendly errors.
 */

const multer = require("multer");
const ApiError = require("../utils/ApiError");

/**
 * Sets the maximum upload size to 10MB.
 */
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Lists the file types accepted for upload: PDFs and common image formats.
 */
const ACCEPTED = new Set([
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "image/heic",
    "image/heif",
]);

/**
 * Configures Multer to keep the file in memory rather than writing it to disk.
 * The bytes can then be forwarded straight to Gemini without any cleanup.
 */
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BYTES, files: 1 },
    fileFilter: (req, file, cb) => {
        if (!ACCEPTED.has(file.mimetype)) {
            return cb(ApiError.badRequest("Upload a PDF or image (PNG/JPG/WEBP)"));
        }
        cb(null, true);
    },
});

/**
 * Wraps Multer so any upload error becomes a clean, friendly message before it reaches the error handler.
 * This covers files that are too large, the wrong type, or missing entirely.
 */
const uploadReceipt = (field = "file") => (req, res, next) => {
    upload.single(field)(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            if (err.code === "LIMIT_FILE_SIZE") {
                return next(ApiError.badRequest("File exceeds 10MB limit"));
            }
            return next(ApiError.badRequest(err.message));
        }
        if (err) return next(err);
        if (!req.file) return next(ApiError.badRequest("No file uploaded"));
        next();
    });
};

module.exports = { uploadReceipt };