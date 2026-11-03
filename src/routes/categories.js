"use strict";

const express = require("express");
const { z } = require("zod");
const { validate } = require("../middleware/validate");
const { ApiError, notFound } = require("../middleware/errors");
const { fromCents, thisMonth, monthRange } = require("../money");

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #2f6feb");
const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(40),
  icon: z.string().trim().min(1).max(8).default("📦"),
  color: hex.default("#64748b"),
}).strict();
const updateSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  icon: z.string().trim().min(1).max(8).optional(),
  color: hex.optional(),
}).strict().refine((v) => Object.keys(v).length > 0, "Send at least one field to update");
const idParam = z.object({ id: z.coerce.number().int().positive() });
const deleteQuery = z.object({ reassignTo: z.coerce.number().int().positive().optional() });

module.exports = function categoryRoutes(db) {
  const r = express.Router();
  const owned = (userId, id) => db.prepare("SELECT * FROM categories WHERE id = ? AND user_id = ?").get(id, userId);

  /** All categories with how much was spent in each this month. */
  r.get("/", (req, res) => {
    const { from, to } = monthRange(thisMonth());
    const rows = db.prepare(`
      SELECT c.id, c.name, c.icon, c.color,
             COUNT(e.id) AS expenseCount,
             COALESCE(SUM(CASE WHEN e.spent_on BETWEEN ? AND ? THEN e.amount_cents END), 0) AS monthCents
      FROM categories c LEFT JOIN expenses e ON e.category_id = c.id
      WHERE c.user_id = ? GROUP BY c.id ORDER BY c.name COLLATE NOCASE`).all(from, to, req.user.id);
    res.json({ data: rows.map(({ monthCents, ...c }) => ({ ...c, spentThisMonth: fromCents(monthCents) })) });
  });

  r.post("/", validate(createSchema), (req, res) => {
    const { name, icon, color } = req.valid.body;
    const info = db.prepare("INSERT INTO categories (user_id, name, icon, color) VALUES (?, ?, ?, ?)").run(req.user.id, name, icon, color);
    res.status(201).json({ data: owned(req.user.id, info.lastInsertRowid) });
  });

  r.patch("/:id", validate(idParam, "params"), validate(updateSchema), (req, res, next) => {
    const { id } = req.valid.params;
    if (!owned(req.user.id, id)) return next(notFound("Category"));
    const { name, icon, color } = req.valid.body;
    db.prepare("UPDATE categories SET name = COALESCE(?, name), icon = COALESCE(?, icon), color = COALESCE(?, color) WHERE id = ?")
      .run(name ?? null, icon ?? null, color ?? null, id);
    res.json({ data: owned(req.user.id, id) });
  });

  /** Delete a category. If it has expenses, pass ?reassignTo=<id> to move them first. */
  r.delete("/:id", validate(idParam, "params"), validate(deleteQuery, "query"), (req, res, next) => {
    const { id } = req.valid.params;
    const { reassignTo } = req.valid.query;
    if (!owned(req.user.id, id)) return next(notFound("Category"));
    const used = db.prepare("SELECT COUNT(*) n FROM expenses WHERE category_id = ?").get(id).n;
    if (used && !reassignTo) {
      return next(new ApiError(409, "category_in_use", `This category has ${used} expense(s). Pass ?reassignTo=<categoryId> to move them before deleting.`));
    }
    if (reassignTo && (reassignTo === id || !owned(req.user.id, reassignTo))) {
      return next(new ApiError(422, "validation_failed", "reassignTo must be another category you own"));
    }
    db.transaction(() => {
      if (used) db.prepare("UPDATE expenses SET category_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE category_id = ?").run(reassignTo, id);
      db.prepare("DELETE FROM categories WHERE id = ?").run(id);
    })();
    res.status(204).end();
  });

  return r;
};
