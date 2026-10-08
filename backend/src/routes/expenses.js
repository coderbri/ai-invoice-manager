/**
 * @file: routes/expenses.js
 * @description Tracks business expenses with category and month filtering, running totals, and a distinct category list for the filter dropdown.
 */

const express = require("express");
const { z } = require("zod");

const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const { requireAuth } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const { query, queryOne } = require("../config/db");

const router = express.Router();
router.use(requireAuth);

const uuid = z.string().uuid("Invalid id");
const idParam = z.object({ id: uuid });

/** Validates an optional calendar date in YYYY-MM-DD format. */
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional();

/** Validation schema for expense creation and updates. */
const expenseSchema = z.object({
    vendor: z.string().trim().max(160).optional(),
    category: z.string().trim().max(60).optional(),
    expense_date: dateStr,
    amount: z.coerce.number().min(0).max(100_000_000).default(0),
    currency: z.string().trim().max(8).optional(),
    notes: z.string().trim().max(1000).optional(),
});

/** Converts a Postgres NUMERIC string into a plain number, falling back to zero. */
const num = (v) => Number(v) || 0;

/** Serializes an expense row so its amount is returned as a number instead of a string. */
const ser = (r) => ({ ...r, amount: num(r.amount) });

/**
 * Lists the user's expenses, optionally filtered by category and month.
 * Also returns overall and this-month totals plus the distinct categories,
 * which stay unfiltered so the category dropdown always shows every option.
 */
router.get(
    "/",
    asyncHandler(async (req, res) => {
        const params = [req.user.id];
        const where = ["user_id = $1"];
        if (req.query.category && req.query.category !== "all") {
            params.push(req.query.category);
            where.push(`category = $${params.length}`);
        }
        
        if (req.query.month) {
            params.push(`${req.query.month}-01`);
            where.push(`date_trunc('month', expense_date) = date_trunc('month', $${params.length}::date)`);
        }
        const { rows } = await query(
            `SELECT * FROM expenses WHERE ${where.join(" AND ")} ORDER BY expense_date DESC, created_at DESC`,
            params
        );
        
        /** Computes total spend and this month's spend in one pass over the user's expenses. */
        const totals = await queryOne(
            `SELECT 
                COALESCE(SUM(amount),0) AS total,
                COALESCE(SUM(CASE WHEN date_trunc('month',expense_date)=date_trunc('month',CURRENT_DATE) THEN amount ELSE 0 END),0) AS this_month
             FROM expenses WHERE user_id = $1`,
            [req.user.id]
        );
        
        const { rows: cats } = await query(
            `SELECT DISTINCT category FROM expenses WHERE user_id = $1 AND category <> '' ORDER BY category`,
            [req.user.id]
        );
        
        res.json({
            expenses: rows.map(ser),
            totals: { total: num(totals.total), thisMonth: num(totals.this_month) },
            categories: cats.map((c) => c.category),
        });
    })
);

/** Creates an expense, defaulting the date to today and the category to "General" when omitted. */
router.post(
    "/",
    validate(expenseSchema),
    asyncHandler(async (req, res) => {
        const b = req.body;
        const exp = await queryOne(
            `INSERT INTO expenses (user_id, vendor, category, expense_date, amount, currency, notes)
             VALUES ($1,$2,$3,COALESCE($4, CURRENT_DATE),$5,$6,$7) RETURNING *`,
            [
                req.user.id,
                b.vendor || "",
                b.category || "General",
                b.expense_date || null,
                b.amount,
                b.currency || "USD",
                b.notes || "",
            ]
        );
        res.status(201).json({ expense: ser(exp) });
    })
);

/** Partially updates an expense, rebuilding SET clauses only for fields present in the request body. */
router.patch(
    "/:id",
    validate(idParam, "params"),
    validate(expenseSchema.partial()),
    asyncHandler(async (req, res) => {
        const fields = ["vendor", "category", "expense_date", "amount", "currency", "notes"];
        const sets = [];
        const values = [req.params.id, req.user.id];
        
        for (const f of fields) {
            if (req.body[f] !== undefined) {
                values.push(req.body[f]);
                sets.push(`${f} = $${values.length}`);
            }
        }
        
        if (!sets.length) throw ApiError.badRequest("No fields to update");
        const exp = await queryOne(
            `UPDATE expenses SET ${sets.join(", ")}, updated_at = now()
             WHERE id = $1 AND user_id = $2 RETURNING *`,
            values
        );
        if (!exp) throw ApiError.notFound("Expense not found");
        res.json({ expense: ser(exp) });
    })
);

/** Deletes an expense scoped to the authenticated user. */
router.delete(
    "/:id",
    validate(idParam, "params"),
    asyncHandler(async (req, res) => {
        const r = await query(`DELETE FROM expenses WHERE id = $1 AND user_id = $2`, [
            req.params.id,
            req.user.id
        ]);
        if (!r.rowCount) throw ApiError.notFound("Expense not found");
        res.json({ ok: true });
    })
);

module.exports = router;