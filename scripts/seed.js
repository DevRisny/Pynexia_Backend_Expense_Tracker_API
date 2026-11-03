"use strict";

/**
 * Creates a demo account with three months of realistic expenses and budgets.
 *   npm run seed           -> demo@expense.app / Demo2026!
 */
const bcrypt = require("bcryptjs");
const { loadConfig } = require("../src/config");
const { openDatabase, seedDefaultCategories } = require("../src/db");

const config = loadConfig();
const db = openDatabase(config.dbFile);
const EMAIL = "demo@expense.app";

db.prepare("DELETE FROM users WHERE email = ?").run(EMAIL);
const userId = db.prepare("INSERT INTO users (name, email, password_hash, currency) VALUES (?, ?, ?, 'LKR')")
  .run("Demo Student", EMAIL, bcrypt.hashSync("Demo2026!", 10)).lastInsertRowid;
seedDefaultCategories(db, userId);
const cat = Object.fromEntries(db.prepare("SELECT name, id FROM categories WHERE user_id = ?").all(userId).map((c) => [c.name, c.id]));

// [category, description, min, max, timesPerMonth, payment]
const PATTERNS = [
  ["Food & Dining", "Lunch at canteen", 350, 650, 14, "cash"],
  ["Food & Dining", "Groceries", 2500, 6500, 4, "card"],
  ["Food & Dining", "Kottu with friends", 900, 1800, 2, "cash"],
  ["Transport", "Bus fare", 80, 220, 16, "cash"],
  ["Transport", "PickMe ride", 450, 1400, 3, "mobile"],
  ["Bills & Utilities", "Mobile data package", 1200, 1200, 1, "mobile"],
  ["Bills & Utilities", "Electricity bill share", 2200, 3400, 1, "bank"],
  ["Education", "Printing and photocopies", 150, 600, 3, "cash"],
  ["Education", "Online course", 2900, 4500, 0.5, "card"],
  ["Health", "Pharmacy", 400, 1600, 1, "cash"],
  ["Shopping", "Clothes", 2500, 7500, 0.7, "card"],
  ["Entertainment", "Movie ticket", 1000, 1500, 1, "card"],
  ["Other", "Gift for a friend", 1500, 3500, 0.4, "cash"],
];

let seed = 20261103;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const insert = db.prepare("INSERT INTO expenses (user_id, category_id, amount_cents, description, spent_on, payment_method) VALUES (?, ?, ?, ?, ?, ?)");
const now = new Date();
const today = now.toISOString().slice(0, 10);
let count = 0;

db.transaction(() => {
  for (let back = 2; back >= 0; back--) {
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    for (const [c, desc, min, max, times, pay] of PATTERNS) {
      const n = Math.floor(times) + (rand() < times % 1 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const day = 1 + Math.floor(rand() * days);
        const date = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), day)).toISOString().slice(0, 10);
        if (date > today) continue;
        const amount = Math.round((min + rand() * (max - min)) / 10) * 10;
        insert.run(userId, cat[c], amount * 100, desc, date, pay);
        count++;
      }
    }
  }
  const budget = db.prepare("INSERT INTO budgets (user_id, category_id, month, limit_cents) VALUES (?, ?, ?, ?)");
  for (let back = 2; back >= 0; back--) {
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1)).toISOString().slice(0, 7);
    budget.run(userId, null, month, 45000_00);
    budget.run(userId, cat["Food & Dining"], month, 18000_00);
    budget.run(userId, cat.Transport, month, 5000_00);
    budget.run(userId, cat.Shopping, month, 6000_00);
    budget.run(userId, cat.Entertainment, month, 2500_00);
  }
})();

console.log(`Seeded ${count} expenses and 15 budgets (3 months) for ${EMAIL} (password: Demo2026!)`);
db.close();
