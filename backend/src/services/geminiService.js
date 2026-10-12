/**
 * @file: services/geminiService.js
 * @description Wraps every Google Gemini call behind four feature functions: receipt parsing, business summaries, payment reminders, and note writing.
 */

const { GoogleGenAI, Type } = require("@google/genai");
const { z } = require("zod");

const env = require("../config/env");
const ApiError = require("../utils/ApiError");

/**
 * Creates the Gemini client only when an API key is configured.
 * Without a key the client stays null, so each feature fails with a clear error instead of the server crashing at startup.
 */
const ai = env.geminiApiKey
    ? new GoogleGenAI({ apiKey: env.geminiApiKey })
    : null;

/**
 * Guards every AI feature by throwing a clear server error when the API key is missing.
 */
function requireAi() {
    if (!ai) {
        throw ApiError.internal("GEMINI_API_KEY is not configured on the server.");
    }
}
/**
 * Lists the HTTP statuses that signal a temporary Gemini outage worth retrying.
 */
const RETRYABLE_STATUSES = new Set([503, 504]);

/**
 * Sets how many times a single Gemini call is attempted before giving up.
 */
const MAX_ATTEMPTS = 3;

/**
 * Pauses for the given number of milliseconds, used between retries.
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wraps a single call to the model so all four features share one clean path.
 * Temporary outages (503 and 504) are retried with exponential backoff, waiting 1s and then 2s.
 * If the service is still unavailable, or the usage limit is hit, the raw Google error is replaced with a friendly message.
 * Any other error is rethrown unchanged, and an empty response still throws.
 */
async function generate({ contents, config }) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            const result = await ai.models.generateContent({
                model: env.geminiModel,
                contents,
                config,
            });
            const text = typeof result.text === "function" ? result.text() : result.text;
            if (!text) throw new Error("Empty response from Gemini");
            return text;
        } catch (err) {
            if (RETRYABLE_STATUSES.has(err.status) && attempt < MAX_ATTEMPTS) {
                await sleep(1000 * 2 ** (attempt - 1));
                continue;
            }
            if (RETRYABLE_STATUSES.has(err.status)) {
                throw new ApiError(503, "The AI service is busy right now. Please try again in a moment.");
            }
            if (err.status === 429) {
                throw ApiError.tooMany("AI usage limit reached. Please wait a moment and try again.");
            }
            throw err;
        }
    }
}

/**
 * FEATURE 1: Receipt scanning.
 * Defines the strict response schema, which is the key trick with structured AI output.
 * Instead of asking Gemini for free text, we hand it the exact JSON shape we want back.
 */
const receiptResponseSchema = {
    type: Type.OBJECT,
    required: ["vendor", "total", "lineItems"],
    properties: {
        vendor: { type: Type.STRING, description: "Merchant / vendor name" },
        date: { type: Type.STRING, description: "ISO date YYYY-MM-DD if visible, else empty" },
        currency: { type: Type.STRING, description: "3-letter code like USD, else empty" },
        subtotal: { type: Type.NUMBER },
        tax: { type: Type.NUMBER },
        total: { type: Type.NUMBER },
        category: { type: Type.STRING, description: "Expense category e.g., Meals, Software, Travel" },
        notes: { type: Type.STRING },
        lineItems: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                required: ["description", "quantity", "rate"],
                properties: {
                    description: { type: Type.STRING },
                    quantity: { type: Type.NUMBER },
                    rate: { type: Type.NUMBER, description: "Unit price" },
                },
            },
        },
    },
};

/**
 * Validates and normalizes Gemini's JSON response.
 * Every field falls back to a safe default, so the result can always be used directly.
 */
const receiptValidator = z.object({
    vendor: z.string().default(""),
    date: z.string().default(""),
    currency: z.string().default(""),
    subtotal: z.number().default(0),
    tax: z.number().default(0),
    total: z.number().default(0),
    category: z.string().default(""),
    notes: z.string().default(""),
    lineItems: z
        .array(
            z.object({
                description: z.string().default(""),
                quantity: z.coerce.number().default(1),
                rate: z.coerce.number().default(0),
            })
        )
        .default([]),
});

/**
 * Parses a receipt image or PDF into structured data.
 * It sends the file inline alongside a prompt, asks for JSON matching the schema at a low temperature for accuracy, and validates the result.
 * A photo comes back as clean, structured data that can be dropped straight into an invoice or expense.
 */
async function parseReceipt({ buffer, mimeType }) {
    requireAi();

    /**
     * Normalizes the non-standard image/jpg alias to image/jpeg, the type Gemini recognizes.
     * Some clients label JPEG files with the alias, and the upload filter accepts both.
     */
    const normalizedMime = mimeType === "image/jpg" ? "image/jpeg" : mimeType;

    const prompt = [
        "You are an accounts-payable assistant. Extract structured data from this receipt or invoice image/PDF.",
        "Return the vendor, date, currency, each line item (description, quantity, unit rate), subtotal, tax, and grand total.",
        "If a value is not visible, use an empty string or 0. Quantities default to 1 when not shown.",
        "Suggest a sensible expense category."
    ].join("\n");
    
    const text = await generate({
        contents: [
            {
                role: "user",
                parts: [
                    { text: prompt },
                    { inlineData: { mimeType: normalizedMime, data: buffer.toString("base64") } },
                ],
            },
        ],
        config: {
            responseMimeType: "application/json",
            responseSchema: receiptResponseSchema,
            temperature: 0.1,
        },
    });
    
    /**
     * Turns malformed or off-schema model output into a clear server error.
     * Without this, a failed JSON parse would surface as a raw 500, and a Zod failure would be misreported as a 400 "Validation failed" for input the client never got wrong.
     */
    try {
        return receiptValidator.parse(JSON.parse(text));
    } catch {
        throw ApiError.internal("Could not read that receipt. Try a clearer image or PDF.");
    }
}

/**
 * FEATURE 2: Business summary.
 * Takes this month's numbers and asks Gemini for a short plain-English read with one actionable suggestion.
 */
async function businessSummary(data) {
    requireAi();
    const prompt = [
        "You are a friendly financial analyst for a small business owner.",
        "Given this month's billing data (JSON), write a concise 2-3 sentence plain-English summary.",
        "Mention revenue trend vs last month with a percentage if computable, count and dollar total of overdue invoices,",
        "and one actionable suggestion (e.g., follow up with a specific client). Be specific with numbers. No markdown, no bullet points.",
        "",
        "DATA:",
        JSON.stringify(data),
    ].join("\n");
    
    const text = await generate({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { temperature: 0.5 },
    });
    
    return text.trim();
}

/**
 * FEATURE 3: Payment reminder.
 * Writes a reminder email whose tone shifts with how overdue the invoice is, from a friendly nudge to a final notice.
 * The first line of the result becomes the subject and the rest becomes the body.
 */
async function paymentReminder({ tone, invoice, client, company, daysOverdue }) {
    requireAi();
    const toneGuide = 
        tone === "firm"
            ? "firm but professional — this invoice is significantly overdue"
            : tone === "final"
            ? "serious and direct — a final notice before escalation, still courteous"
            : "warm, polite and friendly — a gentle nudge";
    
    const prompt = [
        `Write a payment reminder email. Tone: ${toneGuide}.`,
        "Return a short subject line, then a blank line, then the email body.",
        "Use the merchant/company name as the signature. Keep it under 130 words. Plain text, no markdown.",
        "",
        "CONTEXT:",
        JSON.stringify({ invoice, client, company, daysOverdue }),
    ].join("\n");
    
    const text = await generate({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { temperature: 0.6 },
    });
    const trimmed = text.trim();
    const nl = trimmed.indexOf("\n");
    let subject = "";
    let body = trimmed;
    if (nl > -1) {
        subject = trimmed.slice(0, nl).replace(/^subject:\s*/i, "").trim();
        body = trimmed.slice(nl + 1).trim();
    }
    return { subject, body };
}

/**
 * FEATURE 4: Write note.
 * Drafts either a professional service description or a payment-terms note for an invoice.
 */
async function writeNote({ kind, prompt, items, client }) {
    requireAi();
    const target = 
        kind === "terms"
            ? "professional payment-terms / notes text for the bottom of an invoice"
            : "a concise, professional service description for an invoice line item or summary";
    const full = [
        `Write ${target}.`,
        prompt ? `The user's request: ${prompt}` : "",
        "Keep it polished and brief (1-3 sentences). Plain text only, no markdown, no preamble.",
        items?.length ? `Line items for context: ${JSON.stringify(items)}` : "",
        client ? `Client: ${JSON.stringify(client)}` : "",
    ]
        .filter(Boolean)
        .join("\n");
    
    const text = await generate({
        contents: [{ role: "user", parts: [{ text: full }] }],
        config: { temperature: 0.7 },
    });
    return text.trim();
}

module.exports = {
    parseReceipt,
    businessSummary,
    paymentReminder,
    writeNote
};