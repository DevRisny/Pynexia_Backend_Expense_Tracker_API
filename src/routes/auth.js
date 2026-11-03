"use strict";

const express = require("express");
const bcrypt = require("bcryptjs");
const { z } = require("zod");
const rateLimit = require("express-rate-limit");
const { validate } = require("../middleware/validate");
const { ApiError } = require("../middleware/errors");
const { requireAuth, signToken } = require("../middleware/auth");
const { seedDefaultCategories } = require("../db");

const password = z.string()
  .min(8, "Password must be at least 8 characters")
  .max(72, "Password must be at most 72 characters")
  .regex(/[A-Za-z]/, "Password must contain a letter")
  .regex(/\d/, "Password must contain a number");

const registerSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(60),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  password,
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code like LKR").default("LKR"),
}).strict();

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  password: z.string().min(1, "Enter your password"),
}).strict();

const updateMeSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code like LKR").optional(),
}).strict().refine((v) => Object.keys(v).length > 0, "Send at least one field to update");

const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: password }).strict();

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, currency: u.currency });

module.exports = function authRoutes(db, config) {
  const r = express.Router();
  const auth = requireAuth(config, db);

  // Same cost as a real hash, so "unknown email" and "wrong password" take the same time
  const DUMMY_HASH = bcrypt.hashSync("timing-equaliser-password", config.bcryptRounds);

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: config.loginRateLimit, standardHeaders: "draft-8", legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ error: { code: "too_many_attempts", message: "Too many attempts. Try again in 15 minutes." } }),
  });

  r.post("/register", limiter, validate(registerSchema), (req, res, next) => {
    const { name, email, password: pw, currency } = req.valid.body;
    if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) {
      return next(new ApiError(409, "email_taken", "An account with this email already exists"));
    }
    const hash = bcrypt.hashSync(pw, config.bcryptRounds);
    const user = db.transaction(() => {
      const info = db.prepare("INSERT INTO users (name, email, password_hash, currency) VALUES (?, ?, ?, ?)").run(name, email, hash, currency);
      seedDefaultCategories(db, info.lastInsertRowid);
      return db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
    })();
    res.status(201).json({ user: publicUser(user), token: signToken(config, user) });
  });

  r.post("/login", limiter, validate(loginSchema), (req, res, next) => {
    const { email, password: pw } = req.valid.body;
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    const ok = bcrypt.compareSync(pw, user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok) return next(new ApiError(401, "invalid_credentials", "Email or password is incorrect"));
    res.json({ user: publicUser(user), token: signToken(config, user) });
  });

  r.get("/me", auth, (req, res) => res.json({ user: publicUser(req.user) }));

  r.patch("/me", auth, validate(updateMeSchema), (req, res) => {
    const { name, currency } = req.valid.body;
    db.prepare("UPDATE users SET name = COALESCE(?, name), currency = COALESCE(?, currency) WHERE id = ?")
      .run(name ?? null, currency ?? null, req.user.id);
    res.json({ user: publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id)) });
  });

  r.post("/change-password", auth, validate(changePasswordSchema), (req, res, next) => {
    const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.user.id);
    if (!bcrypt.compareSync(req.valid.body.currentPassword, row.password_hash)) {
      return next(new ApiError(401, "invalid_credentials", "Current password is incorrect"));
    }
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(bcrypt.hashSync(req.valid.body.newPassword, config.bcryptRounds), req.user.id);
    res.status(204).end();
  });

  return r;
};
