"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

/** Default categories every new account starts with (name, emoji, colour). */
const DEFAULT_CATEGORIES = [
  ["Food & Dining", "🍽️", "#f97316"],
  ["Transport", "🚌", "#2f6feb"],
  ["Shopping", "🛍️", "#d946ef"],
  ["Bills & Utilities", "💡", "#eab308"],
  ["Health", "💊", "#12a594"],
  ["Education", "📚", "#6d5efc"],
  ["Entertainment", "🎬", "#e5484d"],
  ["Other", "📦", "#64748b"],
];

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT    NOT NULL,
  currency      TEXT    NOT NULL DEFAULT 'LKR',
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  icon       TEXT    NOT NULL DEFAULT '📦',
  color      TEXT    NOT NULL DEFAULT '#64748b',
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (user_id, name COLLATE NOCASE)
);

CREATE TABLE IF NOT EXISTS expenses (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id    INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  amount_cents   INTEGER NOT NULL CHECK (amount_cents > 0),
  description    TEXT    NOT NULL,
  spent_on       TEXT    NOT NULL,             -- YYYY-MM-DD
  payment_method TEXT    NOT NULL DEFAULT 'cash'
                 CHECK (payment_method IN ('cash','card','bank','mobile','other')),
  note           TEXT,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON expenses(user_id, spent_on);
CREATE INDEX IF NOT EXISTS idx_expenses_user_cat  ON expenses(user_id, category_id);

CREATE TABLE IF NOT EXISTS budgets (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id  INTEGER REFERENCES categories(id) ON DELETE CASCADE,  -- NULL = overall budget
  month        TEXT    NOT NULL,                                     -- YYYY-MM
  limit_cents  INTEGER NOT NULL CHECK (limit_cents > 0),
  UNIQUE (user_id, category_id, month)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_overall ON budgets(user_id, month) WHERE category_id IS NULL;
`;

function openDatabase(file = ":memory:") {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}

function seedDefaultCategories(db, userId) {
  const insert = db.prepare("INSERT INTO categories (user_id, name, icon, color) VALUES (?, ?, ?, ?)");
  db.transaction(() => DEFAULT_CATEGORIES.forEach(([n, i, c]) => insert.run(userId, n, i, c)))();
}

module.exports = { openDatabase, seedDefaultCategories, DEFAULT_CATEGORIES };
