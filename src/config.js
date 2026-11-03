"use strict";

const crypto = require("node:crypto");

/**
 * Central configuration. Every value can be overridden with an environment
 * variable, so the same build runs locally, in tests and in production.
 */
function loadConfig(overrides = {}) {
  const env = process.env;
  const config = {
    port: Number(env.PORT) || 3000,
    dbFile: env.DB_FILE || "data/expenses.db",
    // A random secret is generated when none is configured, so a forgotten
    // variable never falls back to a well-known default value.
    jwtSecret: env.JWT_SECRET || crypto.randomBytes(48).toString("hex"),
    jwtExpiresIn: env.JWT_EXPIRES_IN || "2h",
    bcryptRounds: Number(env.BCRYPT_ROUNDS) || 12,
    corsOrigin: env.CORS_ORIGIN || "*",
    loginRateLimit: Number(env.LOGIN_RATE_LIMIT) || 10,
    ...overrides,
  };
  if (!env.JWT_SECRET && env.NODE_ENV === "production" && !overrides.jwtSecret) {
    throw new Error("JWT_SECRET must be set in production");
  }
  return config;
}

module.exports = { loadConfig };
