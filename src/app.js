"use strict";

const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const swaggerUi = require("swagger-ui-express");

const { requireAuth } = require("./middleware/auth");
const { notFoundHandler, errorHandler } = require("./middleware/errors");
const openapi = require("./openapi");

/**
 * Build the Express app. The database and config are passed in, so tests can
 * use a fresh in-memory database for every run.
 */
function createApp(db, config) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use((req, res, next) => {
    req.id = req.get("x-request-id") || crypto.randomUUID();
    res.set("X-Request-Id", req.id);
    next();
  });
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com"],
        "img-src": ["'self'", "data:"],
      },
    },
  }));
  app.use(cors({ origin: config.corsOrigin, exposedHeaders: ["X-Request-Id", "Location"] }));
  app.use(express.json({ limit: "20kb" }));

  // API documentation and a small dashboard that uses the API
  app.get("/openapi.json", (req, res) => res.json(openapi));
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapi, {
    customSiteTitle: "Expense Tracker API docs",
    customCss: ".swagger-ui .topbar { display: none } .swagger-ui .info { margin: 32px 0 }",
    swaggerOptions: { persistAuthorization: true, displayRequestDuration: true, tryItOutEnabled: true },
  }));
  app.use(express.static(path.join(__dirname, "..", "public")));
  // Chart.js is served from node_modules so the dashboard needs no third-party CDN
  const chartDir = path.dirname(require.resolve("chart.js"));   // .../chart.js/dist
  app.use("/vendor", express.static(chartDir));

  app.get("/api/health", (req, res) => {
    db.prepare("SELECT 1").get();
    res.json({ status: "ok", uptimeSeconds: Math.round(process.uptime()), time: new Date().toISOString() });
  });

  const auth = requireAuth(config, db);
  app.use("/api/auth", require("./routes/auth")(db, config));
  app.use("/api/categories", auth, require("./routes/categories")(db));
  app.use("/api/expenses", auth, require("./routes/expenses")(db));
  app.use("/api/budgets", auth, require("./routes/budgets")(db));
  app.use("/api/reports", auth, require("./routes/reports")(db));

  app.use("/api", notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
