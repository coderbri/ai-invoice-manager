/**
 * @file: scripts/seed.js
 * @description Seeds a demo account with realistic clients, invoices, payments, catalog items, and expenses so every dashboard and report has data to show.
 */

/**
 * Imports the shared pool, schema, models, and invoice math.
 * Reusing computeTotals means seeded invoices get the same money math as real ones.
 */
const { pool } = require("../src/config/db");
const { SCHEMA_SQL } = require("../src/config/schema");
const User = require("../src/models/User");
const Settings = require("../src/models/Settings");
const { computeTotals } = require("../src/utils/invoice");

/**
 * Credentials for the demo account the seed creates, or resets if it already exists.
 */
const DEMO = {
    email: "alex@timetoprogram.com",
    password: "Test@1234",
    name: "Alex Chen",
};

/**
 * Volume knobs for the generated data set.
 * SPREAD_DAYS controls how far back in time invoices and expenses are scattered.
 */
const NUM_CLIENTS = 28;
const NUM_INVOICES = 84;
const NUM_EXPENSES = 49;
const SPREAD_DAYS = 330;

/** Company names used for the generated clients, reused in order if NUM_CLIENTS exceeds the list. */
const COMPANY_NAMES = [
    "Nova Retail Group", "Brightline Studios", "Harbor & Co.", "Peak Fitness",
    "Summit Media", "Ironclad Security", "Lumen Analytics", "Copperfield Design",
    "Riverstone Legal", "Vantage Partners", "Northwind Traders", "Blue Orbit Labs",
    "Meridian Health", "Crestview Realty", "Palette Creative", "Foundry Works",
    "Cedar & Pine", "Quantum Foods", "Apex Logistics", "Bluepeak Ventures",
    "Sierra Robotics", "Willowbrook Cafe", "Onyx Interactive", "Beacon Financial",
    "Tidewater Marine", "Greenhouse Co", "Solstice Apparel", "Kestrel Aviation",
];

/** Cities and streets combined at random to build client addresses. */
const CITIES = [
    "San Francisco, CA", "New York, NY", "Boston, MA", "Miami, FL", "Austin, TX",
    "Seattle, WA", "Chicago, IL", "Denver, CO", "Portland, OR", "Atlanta, GA",
];
const STREETS = ["Market St", "Greene St", "Wharf Rd", "Ocean Dr", "Congress Ave", "Pine St", "Broadway", "Mission St", "Elm Ave", "Harbor Blvd"];

/**
 * Reusable services as [name, description, rate, unit].
 * They become both the catalog items and the line items on every generated invoice.
 */
const CATALOG = [
    ["Brand & UI design sprint", "One-week design engagement", 3200, "project"],
    ["Frontend development", "React / TypeScript build", 95, "hour"],
    ["Backend API development", "Node / Postgres build", 110, "hour"],
    ["Monthly retainer — support", "Ongoing support & maintenance", 1500, "month"],
    ["Consultation & discovery", "Strategy and scoping call", 150, "hour"],
    ["Performance audit", "Full performance review", 900, "project"],
    ["UX research study", "Interviews + synthesis", 2400, "project"],
    ["Mobile app development", "React Native build", 120, "hour"],
    ["DevOps & CI/CD setup", "Pipelines and infra", 130, "hour"],
    ["SEO optimization", "Technical SEO pass", 750, "project"],
    ["Content & copywriting", "Marketing copy", 85, "hour"],
    ["Logo & brand identity", "Full identity package", 2800, "project"],
    ["Database optimization", "Query + schema tuning", 140, "hour"],
    ["Security assessment", "Pentest & report", 3500, "project"],
];

/**
 * Expense vendors as [vendor, category, minAmount, maxAmount].
 * Each generated expense picks a random amount within its vendor's range.
 */
const EXPENSE_VENDORS = [
    ["Adobe", "Software", 30, 90], ["Figma", "Software", 12, 60], ["GitHub", "Software", 4, 44],
    ["Google Workspace", "Software", 12, 72], ["Notion", "Software", 8, 40], ["Linear", "Software", 8, 48],
    ["AWS", "Hosting", 80, 260], ["Vercel", "Hosting", 20, 150], ["Neon", "Hosting", 19, 120],
    ["Blue Bottle Coffee", "Meals", 8, 45], ["The Continental Bistro", "Meals", 40, 220], ["Chipotle", "Meals", 12, 60],
    ["Uber", "Travel", 12, 80], ["Delta Airlines", "Travel", 180, 650], ["Marriott", "Travel", 150, 420],
    ["WeWork", "Office", 250, 400], ["Staples", "Office", 20, 180],
    ["Apple Store", "Equipment", 99, 2200], ["Best Buy", "Equipment", 50, 900],
    ["Meta Ads", "Marketing", 50, 600], ["Google Ads", "Marketing", 60, 800], ["LinkedIn", "Marketing", 30, 300],
];

/** Returns a random whole number from 0 up to, but not including, n. */
const rand = (n) => Math.floor(Math.random() * n);

/** Returns a random element from an array. */
const pick = (arr) => arr[rand(arr.length)];

/** Rounds a number to two decimal places. */
const round2 = (n) => Math.round(n * 100) / 100;

/** Turns a name into a lowercase, letters-and-numbers-only slug of at most 16 characters, for building email addresses. */
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 16);

/** Returns the date n days before today as a YYYY-MM-DD string. */
function isoDaysAgo(n) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
}

/** Returns the date n days after a YYYY-MM-DD string as a YYYY-MM-DD string. */
function addDays(iso, n) {
    const d = new Date(iso);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}

/** Generates a random fake US phone number. */
function phone() {
    return `+1 (${200 + rand(700)}) 555-0${100 + rand(900)}`;
}

/**
 * Runs the whole seeding process.
 * It makes sure the demo user exists and sets their company profile, then wipes any old demo data so the script is safe to rerun.
 * Next it generates the clients, the catalog, and the invoices, which are spread across the last several months with a realistic mix of paid, sent, and draft.
 * Each invoice gets proper line items with totals computed by the real invoice math, and every paid invoice gets a matching payment.
 * Finally it adds a pile of expenses across every category.
 * Because the dates are spread out, the aging report looks like a real business.
 */
async function run() {
    console.log(`\nSeeding the database data for ${DEMO.email}...\n`);
    await pool.query(SCHEMA_SQL);
    
    const passwordHash = await User.hashPassword(DEMO.password);
    let user = await User.findByEmail(DEMO.email);
    if (user) {
        await pool.query(`UPDATE users SET name=$2, password_hash=$3, updated_at=now() WHERE id=$1`, [user.id, DEMO.name, passwordHash]);
        console.log(`User ready: ${DEMO.email} (existing)`);
    } else {
        user = await User.create({ name: DEMO.name, email: DEMO.email, passwordHash });
        console.log(`User ready: ${DEMO.email} (created)`);
    }
    const uid = user.id;
    
    await Settings.ensure(uid);
    await Settings.update(uid, {
        company_name: "Chen Studio",
        address: "410 Townsend St, San Francisco, CA 94107",
        email: DEMO.email,
        phone: "+1 (415) 555-0192",
        currency: "USD",
        tax_rate: 8.5,
        invoice_prefix: "INV-",
    });
    
    /** Wipes the demo user's old data, children before parents, so the seed can be rerun safely. */
    await pool.query(`DELETE FROM payments WHERE user_id=$1`, [uid]);
    await pool.query(`DELETE FROM expenses WHERE user_id=$1`, [uid]);
    await pool.query(`DELETE FROM catalog_items WHERE user_id=$1`, [uid]);
    await pool.query(`DELETE FROM invoices WHERE user_id=$1`, [uid]);
    await pool.query(`DELETE FROM clients WHERE user_id=$1`, [uid]);
    
    const clientIds = [];
    for (let i = 0; i < NUM_CLIENTS; i++) {
        const name = COMPANY_NAMES[i % COMPANY_NAMES.length];
        const company = name.replace(/ (Group|Studios|Co\.?|Partners|Labs|Ventures|Interactive|Traders)$/i, "");
        const { rows } = await pool.query(
            `INSERT INTO clients (user_id, name, email, company, phone, address)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
            [uid, name, `billing@${slug(name)}.com`, company, phone(), `${100 + rand(900)} ${pick(STREETS)}, ${pick(CITIES)}`]
        );
        clientIds.push(rows[0].id);
    }
    console.log(`Created ${clientIds.length} clients`);
    
    for (const [name, description, rate, unit] of CATALOG) {
        await pool.query(
            `INSERT INTO catalog_items (user_id, name, description, rate, unit) VALUES ($1,$2,$3,$4,$5)`,
            [uid, name, description, rate, unit]
        );
    }
    console.log(`Created ${CATALOG.length} catalog items`);
    
    const today = new Date();
    let seq = 1;
    let paidCount = 0;
    
    for (let i = 0; i < NUM_INVOICES; i++) {
        const issueDaysAgo = rand(SPREAD_DAYS);
        const issue = isoDaysAgo(issueDaysAgo);
        const due = addDays(issue, [15, 30, 30, 45][rand(4)]);
        const dueInFuture = new Date(due) >= today;
        
        const lineCount = 1 + rand(4);
        const items = [];
        for (let j = 0; j < lineCount; j++) {
            const [name, , rate, unit] = pick(CATALOG);
            const qty = unit === "hour" ? pick([8, 12, 16, 20, 24, 32, 40]) : 1;
            items.push({ description: name, quantity: qty, rate });
        }
        
        const taxRate = Math.random() < 0.7 ? 8.5 : 0;
        const discount = Math.random() < 0.15 ? [50, 100, 150, 200][rand(4)] : 0;
        const totals = computeTotals(items, taxRate, discount);
        
        /** Rolls a status for the invoice: roughly 60% paid, 25% sent, and 15% draft. */
        const roll = Math.random();
        let status;
        if (roll < 0.6) status = "paid";
        else if (roll < 0.85) status = "sent";
        else status = "draft";
        
        /** For paid invoices, picks a paid date between the issue date and up to 35 days later, never in the future. */
        let paidAt = null;
        if (status === "paid") {
            const paidDaysAgo = Math.max(0, issueDaysAgo - rand(Math.min(35, issueDaysAgo + 1)));
            paidAt = isoDaysAgo(paidDaysAgo);
            paidCount++;
        }
        
        const number = `INV-${String(seq).padStart(4, "0")}`;
        seq++;
        const { rows } = await pool.query(
            `INSERT INTO invoices
                (user_id, client_id, invoice_number, status, issue_date, due_date,
                 currency, tax_rate, discount, subtotal, tax_amount, total, notes, terms, paid_at)
             VALUES ($1,$2,$3,$4,$5,$6,'USD',$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
            [
                uid, pick(clientIds), number, status, issue, due,
                taxRate, totals.discount, totals.subtotal, totals.taxAmount, totals.total,
                "Thank you for your business.", "Payment due within 30 days.", paidAt,
            ]
        );
        const invId = rows[0].id;
        
        let pos = 0;
        for (const it of totals.items) {
            await pool.query(
                `INSERT INTO invoice_items (invoice_id, description, quantity, rate, amount, position)
                 VALUES ($1,$2,$3,$4,$5,$6)`,
                [invId, it.description, it.quantity, it.rate, it.amount, pos++]
            );
        }
        
        /** Records a payment for the full invoice total on the paid date, so the ledger matches the paid status. */
        if (status === "paid") {
            await pool.query(
                `INSERT INTO payments (user_id, invoice_id, amount, method, paid_on, notes)
                 VALUES ($1,$2,$3,$4,$5,'')`,
                [uid, invId, totals.total, pick(["Bank transfer", "Credit card", "Check", "PayPal"]), paidAt]
            );
        }
    }
    
    /** Moves the invoice counter past the seeded numbers so the next real invoice doesn't collide with them. */
    await pool.query(`UPDATE company_settings SET next_seq=$2 WHERE user_id=$1`, [uid, seq]);
    console.log(`Created ${NUM_INVOICES} invoices (${paidCount} paid + payments)`);
    
    for (let i = 0; i < NUM_EXPENSES; i++) {
        const [vendor, category, min, max] = pick(EXPENSE_VENDORS);
        const amount = round2(min + Math.random() * (max - min));
        await pool.query(
            `INSERT INTO expenses (user_id, vendor, category, expense_date, amount, notes)
             VALUES ($1,$2,$3,$4,$5,'')`,
            [uid, vendor, category, isoDaysAgo(rand(SPREAD_DAYS)), amount]
        );
    }
    console.log(`Created ${NUM_EXPENSES} expenses`);
    console.log("\n✅ Seed complete.");
    console.log("   Login:    " + DEMO.email);
    console.log("   Password: " + DEMO.password + "\n");
}

/**
 * Kicks off the seed, reports any failure, and always closes the pool so the process can exit.
 */
run()
    .catch((error) => {
        console.error("\n❌ Seed failed:", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end();
    });