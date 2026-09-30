/**
 * @file: routes/settings.js
 * @description Manages a user's company settings — the profile info and 
 * invoicing defaults that appear on every invoice and PDF.
 */

const express = require("express");
const { z } = require("zod");

const asyncHandler = require("../utils/asyncHandler");
const { requireAuth } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const Settings = require("../models/Settings");

const router = express.Router();
router.use(requireAuth);

/** Validation schema for company settings updates; 
 * every field is optional since PATCH only touches what's sent. 
 * */
const settingsSchema = z.object({
    company_name: z.string().trim().max(120).optional(),
    logo_url: z.string().trim().max(500_00).optional(),
    address: z.string().trim().max(400).optional(),
    email: z.string().trim().max(160).optional(),
    phone: z.string().trim().max(40).optional(),
    currency: z.string().trim().max(8).optional(),
    tax_rate: z.coerce.number().min(0).max(100).optional(),
    invoice_prefix: z.string().trim().max(12).optional(),
    accent_color: z.string().trim().max(32).optional(),
});

/** Fetches the authenticated user's company settings, 
 * creating a default row first if one doesn't exist yet. 
 * */
router.get(
    "/",
    asyncHandler(async (req, res) => {
        const settings = await Settings.ensure(req.user.id);
        res.json({ settings });
    })
);

/** Updates whichever company settings fields are present in the request body. */
router.patch(
    "/",
    validate(settingsSchema),
    asyncHandler(async (req, res) => {
        const settings = await Settings.update(req.user.id, req.body);
        res.json({ settings });
    })
);

module.exports = router;