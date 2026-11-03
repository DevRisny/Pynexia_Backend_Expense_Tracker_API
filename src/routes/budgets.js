"use strict";

const express = require("express");
const { z } = require("zod");
const { validate } = require("../middleware/validate");
const { ApiError, notFound } = require("../middleware/errors");
const { toCents, fromCents, amountSchema, isoMonth, thisMonth, monthRange } = require("../money");

const upsertSchema = z.object({
  month: isoMonth.default(() => thisMonth()),
  categoryId: z.number().int().positive().nullable().default(null),   // null = overall monthly budget
  limit: amountSchema,
}).strict();
const monthQuery = z.object({ month: isoMonth.default(() => thisMonth()) });
const idParam = z.object({ id: z.coerce.number().int().positive() });

/** ok below 80%, warning from 80%, over when spending passes the limit. */
const statusOf = (pct) => (pct > 100 ? "over" : pct >= 80 ? "warning" : "ok");

module.exports = function budgetRoutes(db) {
  const r = express.Router();

  r.get("/", validate(monthQuery, "query"), (req, res) => {
    const { month } = req.valid.query;
    const { from, to, days } = monthRange(month);
    const rows = db.prepare(`
      SELECT b.id, b.category_id, b.limit_cents, c.name, c.icon, c.color,
        (SELECT COALESCE(SUM(e.amount_cents),0) FROM expenses e
          WHERE e.user_id = b.user_id AND e.spent_on BETWEEN ? AND ?
            AND (b.category_id IS NULL OR e.category_id = b.category_id)) AS spent_cents
      FROM budgets b LEFT JOIN categories c ON c.id = b.category_id
      WHERE b.user_id = ? AND b.month = ?
      ORDER BY b.category_id IS NOT NULL, c.name`).all(from, to, req.user.id, month);

    // how far through the month we are, so the API can say if spending is ahead of pace
    const now = new Date().toISOString().slice(0, 10);
    const elapsed = now < from ? 0 : now > to ? days : Number(now.slice(8, 10));
    const data = rows.map((b) => {
      const pct = (b.spent_cents / b.limit_cents) * 100;
      const projected = elapsed ? (b.spent_cents / elapsed) * days : 0;
      return {
        id: b.id, month,
        category: b.category_id ? { id: b.category_id, name: b.name, icon: b.icon, color: b.color } : null,
        limit: fromCents(b.limit_cents),
        spent: fromCents(b.spent_cents),
        remaining: fromCents(Math.max(0, b.limit_cents - b.spent_cents)),
        percentUsed: Math.round(pct * 10) / 10,
        status: statusOf(pct),
        projectedSpend: fromCents(projected),
        onTrack: projected <= b.limit_cents,
      };
    });
    res.json({ data, meta: { month, daysInMonth: days, daysElapsed: elapsed, currency: req.user.currency } });
  });

  /** Create or replace the budget for a month (and category). */
  r.put("/", validate(upsertSchema), (req, res, next) => {
    const { month, categoryId, limit } = req.valid.body;
    if (categoryId && !db.prepare("SELECT 1 FROM categories WHERE id = ? AND user_id = ?").get(categoryId, req.user.id)) {
      return next(new ApiError(422, "validation_failed", "Some fields are invalid", [{ field: "categoryId", message: "Category not found" }]));
    }
    const existing = db.prepare("SELECT id FROM budgets WHERE user_id = ? AND month = ? AND category_id IS ?").get(req.user.id, month, categoryId);
    let id;
    if (existing) {
      db.prepare("UPDATE budgets SET limit_cents = ? WHERE id = ?").run(toCents(limit), existing.id);
      id = existing.id;
    } else {
      id = db.prepare("INSERT INTO budgets (user_id, category_id, month, limit_cents) VALUES (?, ?, ?, ?)").run(req.user.id, categoryId, month, toCents(limit)).lastInsertRowid;
    }
    res.status(existing ? 200 : 201).json({ data: { id, month, categoryId, limit } });
  });

  r.delete("/:id", validate(idParam, "params"), (req, res, next) => {
    const info = db.prepare("DELETE FROM budgets WHERE id = ? AND user_id = ?").run(req.valid.params.id, req.user.id);
    if (!info.changes) return next(notFound("Budget"));
    res.status(204).end();
  });

  return r;
};
