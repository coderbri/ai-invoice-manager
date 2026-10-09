/**
 * @file: routes/ai.js
 * @description Exposes the four Gemini-powered features (receipt parsing, business summary, payment reminders, and note writing) as authenticated, rate-limited endpoints.
 */

const express = require("express");
const { z } = require("zod");

const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const { requireAuth } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const { uploadReceipt } = require("../middleware/upload");
const { aiLimiter } = require("../middleware/rateLimit");
const { query, queryOne } = require("../config/db");
const Settings = require("../models/Settings");
const gemini = require("../services/geminiService");

/**
 * Creates the router and protects every AI endpoint with authentication.
 */
const router = express.Router();
router.use(requireAuth);

/**
 * Parses an uploaded receipt into structured data.
 * The rate limiter runs first, then the upload middleware catches the incoming file.
 * The handler itself stays tiny: it pulls the raw bytes and mime type off req.file and hands them to Gemini's parseReceipt.
 * All the logic lives in the service, so the route is just plumbing.
 */
router.post(
    "/receipt-parse",
    aiLimiter,
    uploadReceipt("file"),
    asyncHandler(async (req, res) => {
        const data = await gemini.parseReceipt({
            buffer: req.file.buffer,
            mimeType: req.file.mimetype,
        });
        res.json({ result: data });
    })
);

/**
 * Gathers this month's data from the database first, which is the important part.
 * One query computes revenue this month versus last month, the outstanding total, and the overdue count and amount.
 * A second query pulls the top three overdue invoices with their client names.
 * Only then is that tidy payload handed to Gemini to summarize.
 * That's the whole trick to a good AI feature: feed the model tight, relevant facts instead of asking it to guess.
 */
router.post(
    "/business-summary",
    aiLimiter,
    asyncHandler(async (req, res) => {
        const uid = req.user.id;
        const rows = await queryOne(
            `SELECT
                COALESCE(SUM(CASE WHEN status='paid' AND date_trunc('month',COALESCE(paid_at,issue_date))=date_trunc('month',CURRENT_DATE) THEN total ELSE 0 END), 0) AS revenue_this_month,
                COALESCE(SUM(CASE WHEN status='paid' AND date_trunc('month',COALESCE(paid_at,issue_date))=date_trunc('month',CURRENT_DATE - interval '1 month') THEN total ELSE 0 END),0) AS revenue_last_month,
                COALESCE(SUM(CASE WHEN status<>'paid' THEN total ELSE 0 END), 0) AS outstanding,
                COUNT(*) FILTER (WHERE status='sent' AND due_date < CURRENT_DATE)::int AS overdue_count,
                COALESCE(SUM(CASE WHEN status='sent' AND due_date < CURRENT_DATE THEN total ELSE 0 END),0) AS overdue_total
             FROM invoices WHERE user_id = $1`,
            [uid]
        );
        const { rows: topOverdue } = await query(
            `SELECT c.name AS client, i.invoice_number, i.total, (CURRENT_DATE - i.due_date) AS days_overdue
             FROM invoices i LEFT JOIN clients c ON c.id = i.client_id
             WHERE i.user_id = $1 AND i.status='sent' AND i.due_date < CURRENT_DATE
             ORDER BY i.total DESC LIMIT 3`,
            [uid]
        );
        
        const data = {
            revenueThisMonth: Number(rows.revenue_this_month),
            revenueLastMonth: Number(rows.revenue_last_month),
            outstanding: Number(rows.outstanding),
            overdueCount: rows.overdue_count,
            overdueTotal: Number(rows.overdue_total),
            topOverdue: topOverdue.map((r) => ({
                client: r.client,
                invoice: r.invoice_number,
                amount: Number(r.total),
                daysOverdue: r.days_overdue,
            })),
        };
        
        const summary = await gemini.businessSummary(data);
        res.json({ summary, data });
    })
);

/**
 * Drafts a payment reminder email for an invoice.
 * It loads the invoice joined with its client, pulls in the company profile so the email can be signed properly, and works out exactly how many days overdue it is.
 * It bundles all of that with the tone you picked, asks the service to write the email, and returns the subject, the body, and the client's address so the UI knows where to send it.
 */
router.post(
    "/payment-reminder",
    aiLimiter,
    validate(
        z.object({
            invoiceId: z.string().uuid(),
            tone: z.enum(["friendly", "firm", "final"]).default("friendly"),
        })
    ),
    asyncHandler(async (req, res) => {
        const invoice = await queryOne(
            `SELECT i.*, c.name AS client_name, c.email AS client_email, c.company AS client_company
            FROM invoices i LEFT JOIN clients c ON c.id = i.client_id
            WHERE i.id = $1 AND i.user_id = $2`,
            [req.body.invoiceId, req.user.id]
        );
        if (!invoice) throw ApiError.notFound("Invoice not found");
        
        const settings = await Settings.ensure(req.user.id);

        /**
         * Converts the gap between now and the due date from milliseconds into whole days.
         * The result never drops below zero, and an invoice with no due date counts as zero days overdue.
         */
        const daysOverdue = invoice.due_date
            ? Math.max(
                0,
                Math.floor(
                    (Date.now() - new Date(invoice.due_date).getTime()) / 86_400_000
                )
            ) : 0;
        
        const draft = await gemini.paymentReminder({
            tone: req.body.tone,
            invoice: {
                number: invoice.invoice_number,
                total: Number(invoice.total),
                currency: invoice.currency,
                dueDate: invoice.due_date
            },
            client: {
                name: invoice.client_name,
                company: invoice.client_company,
            },
            company: { name: settings.company_name || req.user.name },
            daysOverdue,
        });
        res.json({ draft, meta: { daysOverdue, to: invoice.client_email } });
    })
);

/**
 * Drafts a service description or payment-terms note.
 * It validates the kind and an optional prompt, then lets the service write the text.
 */
router.post(
    "/write-note",
    aiLimiter,
    validate(
        z.object({
            kind: z.enum(["description", "terms"]).default("description"),
            prompt: z.string().trim().max(600).optional(),
            items: z
                .array(
                    z.object({
                        description: z.string().optional(),
                        quantity: z.coerce.number().optional(),
                        rate: z.coerce.number().optional(),
                    })
                )
                .optional(),
            client: z.object({ name: z.string().optional() }).partial().optional(),
        })
    ),
    asyncHandler(async (req, res) => {
        const text = await gemini.writeNote(req.body);
        res.json({ text });
    })
);

/**
 * Every one of these four endpoints sits behind the AI rate limiter.
 * That way a runaway loop can never quietly run up a Gemini bill.
 */
module.exports = router;