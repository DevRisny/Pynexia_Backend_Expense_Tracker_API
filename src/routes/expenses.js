"use strict";

const express = require("express");
const { z } = require("zod");
const { validate } = require("../middleware/validate");
const { ApiError, notFound } = require("../middleware/errors");
const { toCents, fromCents, amountSchema, isoDate, today } = require("../money");

const METHODS = ["cash", "card", "bank", "mobile", "other"];

const createSchema = z.object({
  amount: amountSchema,
  description: z.string().trim().min(1, "Description is required").max(120),
  categoryId: z.number().int().positive("Choose a category"),
  spentOn: isoDate.default(() => today()).refine((d) => d <= today(), "Date cannot be in the future"),
  paymentMethod: z.enum(METHODS).default("cash"),
  note: z.string().trim().max(500).optional().nullable(),
}).strict();

const updateSchema = z.object({
  amount: amountSchema.optional(),
  description: z.string().trim().min(1).max(120).optional(),
  categoryId: z.number().int().positive().optional(),
  spentOn: isoDate.refine((d) => d <= today(), "Date cannot be in the future").optional(),
  paymentMethod: z.enum(METHODS).optional(),
  note: z.string().trim().max(500).optional().nullable(),
}).strict().refine((v) => Object.keys(v).length > 0, "Send at least one field to update");

const listQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  paymentMethod: z.enum(METHODS).optional(),
  min: z.coerce.number().nonnegative().optional(),
  max: z.coerce.number().positive().optional(),
  q: z.string().trim().max(60).optional(),
  sort: z.enum(["spentOn", "amount", "createdAt"]).default("spentOn"),
  order: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).refine((v) => !(v.from && v.to) || v.from <= v.to, { message: "'from' must be on or before 'to'", path: ["from"] })
  .refine((v) => v.min === undefined || v.max === undefined || v.min <= v.max, { message: "'min' must be less than 'max'", path: ["min"] });

const idParam = z.object({ id: z.coerce.number().int().positive() });
const SORT_COLUMNS = { spentOn: "e.spent_on", amount: "e.amount_cents", createdAt: "e.created_at" };

const SELECT = `
  SELECT e.id, e.amount_cents, e.description, e.spent_on, e.payment_method, e.note, e.created_at, e.updated_at,
         c.id AS cat_id, c.name AS cat_name, c.icon AS cat_icon, c.color AS cat_color
  FROM expenses e JOIN categories c ON c.id = e.category_id`;

const shape = (row) => ({
  id: row.id,
  amount: fromCents(row.amount_cents),
  description: row.description,
  spentOn: row.spent_on,
  paymentMethod: row.payment_method,
  note: row.note,
  category: { id: row.cat_id, name: row.cat_name, icon: row.cat_icon, color: row.cat_color },
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** Build the WHERE clause for list and CSV export from validated filters. */
function buildFilters(userId, f) {
  const where = ["e.user_id = ?"];
  const args = [userId];
  if (f.from) { where.push("e.spent_on >= ?"); args.push(f.from); }
  if (f.to) { where.push("e.spent_on <= ?"); args.push(f.to); }
  if (f.categoryId) { where.push("e.category_id = ?"); args.push(f.categoryId); }
  if (f.paymentMethod) { where.push("e.payment_method = ?"); args.push(f.paymentMethod); }
  if (f.min !== undefined) { where.push("e.amount_cents >= ?"); args.push(toCents(f.min)); }
  if (f.max !== undefined) { where.push("e.amount_cents <= ?"); args.push(toCents(f.max)); }
  if (f.q) {
    // escape LIKE wildcards so a search for "50%" means the literal text
    const like = "%" + f.q.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
    where.push("(e.description LIKE ? ESCAPE '\\' OR e.note LIKE ? ESCAPE '\\')");
    args.push(like, like);
  }
  return { sql: where.join(" AND "), args };
}

const csvCell = (v) => {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;           // stop spreadsheet formula injection
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

module.exports = function expenseRoutes(db) {
  const r = express.Router();
  const ownsCategory = (userId, id) => !!db.prepare("SELECT 1 FROM categories WHERE id = ? AND user_id = ?").get(id, userId);
  const getOwned = (userId, id) => db.prepare(`${SELECT} WHERE e.id = ? AND e.user_id = ?`).get(id, userId);

  r.get("/", validate(listQuery, "query"), (req, res) => {
    const f = req.valid.query;
    const { sql, args } = buildFilters(req.user.id, f);
    const totals = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(e.amount_cents),0) s FROM expenses e WHERE ${sql}`).get(...args);
    const rows = db.prepare(`${SELECT} WHERE ${sql} ORDER BY ${SORT_COLUMNS[f.sort]} ${f.order === "asc" ? "ASC" : "DESC"}, e.id DESC LIMIT ? OFFSET ?`)
      .all(...args, f.limit, (f.page - 1) * f.limit);
    res.json({
      data: rows.map(shape),
      meta: { page: f.page, limit: f.limit, total: totals.n, totalPages: Math.max(1, Math.ceil(totals.n / f.limit)), totalAmount: fromCents(totals.s), currency: req.user.currency },
    });
  });

  r.get("/export.csv", validate(listQuery, "query"), (req, res) => {
    const { sql, args } = buildFilters(req.user.id, req.valid.query);
    const rows = db.prepare(`${SELECT} WHERE ${sql} ORDER BY e.spent_on DESC, e.id DESC`).all(...args);
    const header = ["date", "description", "category", "amount", "currency", "payment_method", "note"];
    const lines = rows.map((x) => [x.spent_on, x.description, x.cat_name, fromCents(x.amount_cents).toFixed(2), req.user.currency, x.payment_method, x.note].map(csvCell).join(","));
    res.type("text/csv").attachment(`expenses-${today()}.csv`).send([header.join(","), ...lines].join("\n") + "\n");
  });

  r.get("/:id", validate(idParam, "params"), (req, res, next) => {
    const row = getOwned(req.user.id, req.valid.params.id);
    if (!row) return next(notFound("Expense"));
    res.json({ data: shape(row) });
  });

  r.post("/", validate(createSchema), (req, res, next) => {
    const b = req.valid.body;
    if (!ownsCategory(req.user.id, b.categoryId)) return next(new ApiError(422, "validation_failed", "Some fields are invalid", [{ field: "categoryId", message: "Category not found" }]));
    const info = db.prepare(`INSERT INTO expenses (user_id, category_id, amount_cents, description, spent_on, payment_method, note)
                             VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(req.user.id, b.categoryId, toCents(b.amount), b.description, b.spentOn, b.paymentMethod, b.note ?? null);
    res.status(201).location(`/api/expenses/${info.lastInsertRowid}`).json({ data: shape(getOwned(req.user.id, info.lastInsertRowid)) });
  });

  r.patch("/:id", validate(idParam, "params"), validate(updateSchema), (req, res, next) => {
    const { id } = req.valid.params;
    const b = req.valid.body;
    if (!getOwned(req.user.id, id)) return next(notFound("Expense"));
    if (b.categoryId && !ownsCategory(req.user.id, b.categoryId)) return next(new ApiError(422, "validation_failed", "Some fields are invalid", [{ field: "categoryId", message: "Category not found" }]));
    const sets = []; const args = [];
    const map = { amount: ["amount_cents", toCents], description: ["description"], categoryId: ["category_id"], spentOn: ["spent_on"], paymentMethod: ["payment_method"], note: ["note"] };
    for (const [k, [col, fn]] of Object.entries(map)) {
      if (k in b) { sets.push(`${col} = ?`); args.push(fn ? fn(b[k]) : b[k] ?? null); }
    }
    sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
    db.prepare(`UPDATE expenses SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`).run(...args, id, req.user.id);
    res.json({ data: shape(getOwned(req.user.id, id)) });
  });

  r.delete("/:id", validate(idParam, "params"), (req, res, next) => {
    const info = db.prepare("DELETE FROM expenses WHERE id = ? AND user_id = ?").run(req.valid.params.id, req.user.id);
    if (!info.changes) return next(notFound("Expense"));
    res.status(204).end();
  });

  return r;
};
