"use strict";

const express = require("express");
const { z } = require("zod");
const { validate } = require("../middleware/validate");
const { fromCents, isoDate, isoMonth, thisMonth, monthRange } = require("../money");

const rangeQuery = z.object({ from: isoDate.optional(), to: isoDate.optional(), month: isoMonth.optional() })
  .refine((v) => !(v.from && v.to) || v.from <= v.to, { message: "'from' must be on or before 'to'", path: ["from"] });
const monthsQuery = z.object({ months: z.coerce.number().int().min(1).max(24).default(6) });

function resolveRange(q) {
  if (q.from || q.to) return { from: q.from || "0000-01-01", to: q.to || "9999-12-31" };
  return monthRange(q.month || thisMonth());
}

module.exports = function reportRoutes(db) {
  const r = express.Router();

  /** Totals, category and payment breakdown, daily trend and biggest expenses for a period. */
  r.get("/summary", validate(rangeQuery, "query"), (req, res) => {
    const { from, to } = resolveRange(req.valid.query);
    const uid = req.user.id;
    const tot = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(amount_cents),0) s, COALESCE(MAX(amount_cents),0) mx FROM expenses WHERE user_id = ? AND spent_on BETWEEN ? AND ?").get(uid, from, to);
    const byCategory = db.prepare(`
      SELECT c.id, c.name, c.icon, c.color, COUNT(e.id) n, SUM(e.amount_cents) s
      FROM expenses e JOIN categories c ON c.id = e.category_id
      WHERE e.user_id = ? AND e.spent_on BETWEEN ? AND ? GROUP BY c.id ORDER BY s DESC`).all(uid, from, to);
    const byMethod = db.prepare(`SELECT payment_method m, COUNT(*) n, SUM(amount_cents) s FROM expenses
      WHERE user_id = ? AND spent_on BETWEEN ? AND ? GROUP BY m ORDER BY s DESC`).all(uid, from, to);
    const daily = db.prepare(`SELECT spent_on d, SUM(amount_cents) s FROM expenses
      WHERE user_id = ? AND spent_on BETWEEN ? AND ? GROUP BY d ORDER BY d`).all(uid, from, to);
    const top = db.prepare(`SELECT e.id, e.description, e.amount_cents, e.spent_on, c.name cat FROM expenses e
      JOIN categories c ON c.id = e.category_id WHERE e.user_id = ? AND e.spent_on BETWEEN ? AND ?
      ORDER BY e.amount_cents DESC LIMIT 5`).all(uid, from, to);

    const activeDays = daily.length;
    res.json({
      period: { from, to },
      currency: req.user.currency,
      total: fromCents(tot.s),
      count: tot.n,
      averageExpense: tot.n ? fromCents(tot.s / tot.n) : 0,
      averagePerActiveDay: activeDays ? fromCents(tot.s / activeDays) : 0,
      largestExpense: fromCents(tot.mx),
      byCategory: byCategory.map((c) => ({ categoryId: c.id, name: c.name, icon: c.icon, color: c.color, count: c.n, total: fromCents(c.s), share: tot.s ? Math.round((c.s / tot.s) * 1000) / 10 : 0 })),
      byPaymentMethod: byMethod.map((m) => ({ method: m.m, count: m.n, total: fromCents(m.s) })),
      daily: daily.map((d) => ({ date: d.d, total: fromCents(d.s) })),
      topExpenses: top.map((t) => ({ id: t.id, description: t.description, amount: fromCents(t.amount_cents), spentOn: t.spent_on, category: t.cat })),
    });
  });

  /** Month-by-month totals for the last N months, with change versus the previous month. */
  r.get("/monthly", validate(monthsQuery, "query"), (req, res) => {
    const { months } = req.valid.query;
    const now = new Date();
    const list = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      list.push(d.toISOString().slice(0, 7));
    }
    const rows = db.prepare(`SELECT substr(spent_on,1,7) m, COUNT(*) n, SUM(amount_cents) s FROM expenses
      WHERE user_id = ? AND spent_on >= ? GROUP BY m`).all(req.user.id, list[0] + "-01");
    const byMonth = Object.fromEntries(rows.map((x) => [x.m, x]));
    let prev = null;
    const data = list.map((m) => {
      const s = byMonth[m]?.s || 0;
      const change = prev ? Math.round(((s - prev) / prev) * 1000) / 10 : null;
      prev = s;
      return { month: m, total: fromCents(s), count: byMonth[m]?.n || 0, changeFromPreviousPercent: change };
    });
    res.json({ data, currency: req.user.currency });
  });

  return r;
};
