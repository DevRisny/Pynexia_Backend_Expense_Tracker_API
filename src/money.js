"use strict";

const { z } = require("zod");

/** Money is stored as integer cents to avoid floating-point errors (0.1 + 0.2). */
const toCents = (amount) => Math.round(amount * 100);
const fromCents = (cents) => Math.round(cents) / 100;

/** A positive amount with at most two decimals, e.g. 1250 or 1250.75 */
const amountSchema = z
  .number({ error: "Amount must be a number" })
  .positive("Amount must be greater than 0")
  .max(100_000_000, "Amount is too large")
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "Use at most two decimal places");

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD").refine((s) => {
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, "This is not a real calendar date");

const isoMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use the format YYYY-MM");

const today = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => today().slice(0, 7);

/** First and last day of a YYYY-MM month. */
function monthRange(month) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}`, days: last };
}

module.exports = { toCents, fromCents, amountSchema, isoDate, isoMonth, today, thisMonth, monthRange };
