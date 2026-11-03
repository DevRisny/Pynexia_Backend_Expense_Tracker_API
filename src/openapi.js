"use strict";

/** OpenAPI 3.1 description of the API, served at /openapi.json and rendered at /docs. */
const ref = (n) => ({ $ref: `#/components/schemas/${n}` });
const json = (schema) => ({ "application/json": { schema } });
const errorResponse = (description) => ({ description, content: json(ref("Error")) });
const idParam = { name: "id", in: "path", required: true, schema: { type: "integer", minimum: 1 } };
const monthParam = { name: "month", in: "query", schema: { type: "string", pattern: "^\\d{4}-\\d{2}$", example: "2026-11" } };
const COMMON = { 401: errorResponse("Missing, invalid or expired token"), 422: errorResponse("Validation failed") };

module.exports = {
  openapi: "3.1.0",
  info: {
    title: "Expense Tracker API",
    version: "1.0.0",
    description: "A secure REST API for tracking personal expenses: JWT authentication, per-user data, categories, monthly budgets with alerts, reports and CSV export.\n\n**Try it:** call `POST /api/auth/register` or `POST /api/auth/login`, copy the `token`, click **Authorize** and paste it.",
    contact: { name: "Junaideen Risny Suha", url: "https://github.com/DevRisny" },
  },
  servers: [{ url: "/", description: "This server" }],
  tags: [
    { name: "Auth", description: "Register, sign in and manage your account" },
    { name: "Expenses", description: "Create, read, update, delete, search and export expenses" },
    { name: "Categories", description: "Spending categories (8 are created for every new account)" },
    { name: "Budgets", description: "Monthly limits, overall or per category, with status alerts" },
    { name: "Reports", description: "Totals, breakdowns and trends" },
  ],
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
    schemas: {
      Error: {
        type: "object",
        properties: { error: { type: "object", properties: {
          code: { type: "string", example: "validation_failed" },
          message: { type: "string", example: "Some fields are invalid" },
          details: { type: "array", items: { type: "object", properties: { field: { type: "string" }, message: { type: "string" } } } },
        } } },
      },
      User: { type: "object", properties: { id: { type: "integer" }, name: { type: "string" }, email: { type: "string", format: "email" }, currency: { type: "string", example: "LKR" } } },
      AuthResult: { type: "object", properties: { user: ref("User"), token: { type: "string", description: "JWT, valid for 2 hours" } } },
      Category: { type: "object", properties: { id: { type: "integer" }, name: { type: "string", example: "Transport" }, icon: { type: "string", example: "🚌" }, color: { type: "string", example: "#2f6feb" }, expenseCount: { type: "integer" }, spentThisMonth: { type: "number" } } },
      Expense: {
        type: "object",
        properties: {
          id: { type: "integer" }, amount: { type: "number", example: 1250.5 }, description: { type: "string", example: "Bus pass" },
          spentOn: { type: "string", format: "date" }, paymentMethod: { type: "string", enum: ["cash", "card", "bank", "mobile", "other"] },
          note: { type: ["string", "null"] }, category: { type: "object", properties: { id: { type: "integer" }, name: { type: "string" }, icon: { type: "string" }, color: { type: "string" } } },
          createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" },
        },
      },
      NewExpense: {
        type: "object", required: ["amount", "description", "categoryId"],
        properties: {
          amount: { type: "number", exclusiveMinimum: 0, example: 1250.5, description: "At most two decimals" },
          description: { type: "string", maxLength: 120, example: "Bus pass" },
          categoryId: { type: "integer", example: 2 },
          spentOn: { type: "string", format: "date", description: "Defaults to today, cannot be in the future" },
          paymentMethod: { type: "string", enum: ["cash", "card", "bank", "mobile", "other"], default: "cash" },
          note: { type: "string", maxLength: 500 },
        },
      },
      Budget: {
        type: "object",
        properties: {
          id: { type: "integer" }, month: { type: "string", example: "2026-11" }, category: { oneOf: [ref("Category"), { type: "null" }] },
          limit: { type: "number" }, spent: { type: "number" }, remaining: { type: "number" }, percentUsed: { type: "number" },
          status: { type: "string", enum: ["ok", "warning", "over"] }, projectedSpend: { type: "number" }, onTrack: { type: "boolean" },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    "/api/health": { get: { tags: ["Auth"], summary: "Health check", security: [], responses: { 200: { description: "Service is up" } } } },
    "/api/auth/register": {
      post: {
        tags: ["Auth"], summary: "Create an account", security: [],
        requestBody: { required: true, content: json({ type: "object", required: ["name", "email", "password"], properties: {
          name: { type: "string", example: "Risny Suha" }, email: { type: "string", example: "risny@example.com" },
          password: { type: "string", example: "Budget2026", description: "8+ characters with a letter and a number" }, currency: { type: "string", example: "LKR" } } }) },
        responses: { 201: { description: "Account created", content: json(ref("AuthResult")) }, 409: errorResponse("Email already registered"), 422: COMMON[422], 429: errorResponse("Too many attempts") },
      },
    },
    "/api/auth/login": {
      post: {
        tags: ["Auth"], summary: "Sign in and get a token", security: [],
        requestBody: { required: true, content: json({ type: "object", required: ["email", "password"], properties: { email: { type: "string", example: "demo@expense.app" }, password: { type: "string", example: "Demo2026!" } } }) },
        responses: { 200: { description: "Signed in", content: json(ref("AuthResult")) }, 401: errorResponse("Email or password is incorrect"), 429: errorResponse("Too many attempts") },
      },
    },
    "/api/auth/me": {
      get: { tags: ["Auth"], summary: "Your profile", responses: { 200: { description: "Profile", content: json({ type: "object", properties: { user: ref("User") } }) }, 401: COMMON[401] } },
      patch: { tags: ["Auth"], summary: "Update name or currency", requestBody: { content: json({ type: "object", properties: { name: { type: "string" }, currency: { type: "string" } } }) }, responses: { 200: { description: "Updated" }, ...COMMON } },
    },
    "/api/auth/change-password": {
      post: { tags: ["Auth"], summary: "Change your password", requestBody: { content: json({ type: "object", properties: { currentPassword: { type: "string" }, newPassword: { type: "string" } } }) }, responses: { 204: { description: "Changed" }, ...COMMON } },
    },
    "/api/expenses": {
      get: {
        tags: ["Expenses"], summary: "List, filter, search and page expenses",
        parameters: [
          { name: "from", in: "query", schema: { type: "string", format: "date" } }, { name: "to", in: "query", schema: { type: "string", format: "date" } },
          { name: "categoryId", in: "query", schema: { type: "integer" } }, { name: "paymentMethod", in: "query", schema: { type: "string" } },
          { name: "min", in: "query", schema: { type: "number" } }, { name: "max", in: "query", schema: { type: "number" } },
          { name: "q", in: "query", description: "Search description and note", schema: { type: "string" } },
          { name: "sort", in: "query", schema: { type: "string", enum: ["spentOn", "amount", "createdAt"], default: "spentOn" } },
          { name: "order", in: "query", schema: { type: "string", enum: ["asc", "desc"], default: "desc" } },
          { name: "page", in: "query", schema: { type: "integer", default: 1 } }, { name: "limit", in: "query", schema: { type: "integer", default: 20, maximum: 100 } },
        ],
        responses: { 200: { description: "A page of expenses", content: json({ type: "object", properties: { data: { type: "array", items: ref("Expense") }, meta: { type: "object" } } }) }, ...COMMON },
      },
      post: { tags: ["Expenses"], summary: "Add an expense", requestBody: { required: true, content: json(ref("NewExpense")) }, responses: { 201: { description: "Created", content: json({ type: "object", properties: { data: ref("Expense") } }) }, ...COMMON } },
    },
    "/api/expenses/export.csv": { get: { tags: ["Expenses"], summary: "Download expenses as CSV (same filters as the list)", responses: { 200: { description: "CSV file", content: { "text/csv": {} } }, ...COMMON } } },
    "/api/expenses/{id}": {
      parameters: [idParam],
      get: { tags: ["Expenses"], summary: "Get one expense", responses: { 200: { description: "The expense" }, 404: errorResponse("Not found"), ...COMMON } },
      patch: { tags: ["Expenses"], summary: "Update any fields of an expense", requestBody: { content: json(ref("NewExpense")) }, responses: { 200: { description: "Updated" }, 404: errorResponse("Not found"), ...COMMON } },
      delete: { tags: ["Expenses"], summary: "Delete an expense", responses: { 204: { description: "Deleted" }, 404: errorResponse("Not found"), ...COMMON } },
    },
    "/api/categories": {
      get: { tags: ["Categories"], summary: "List categories with this month's spending", responses: { 200: { description: "Categories", content: json({ type: "object", properties: { data: { type: "array", items: ref("Category") } } }) }, ...COMMON } },
      post: { tags: ["Categories"], summary: "Create a category", requestBody: { content: json({ type: "object", required: ["name"], properties: { name: { type: "string" }, icon: { type: "string" }, color: { type: "string" } } }) }, responses: { 201: { description: "Created" }, 409: errorResponse("Name already used"), ...COMMON } },
    },
    "/api/categories/{id}": {
      parameters: [idParam],
      patch: { tags: ["Categories"], summary: "Rename or restyle a category", responses: { 200: { description: "Updated" }, 404: errorResponse("Not found"), ...COMMON } },
      delete: {
        tags: ["Categories"], summary: "Delete a category",
        parameters: [{ name: "reassignTo", in: "query", description: "Move this category's expenses here first", schema: { type: "integer" } }],
        responses: { 204: { description: "Deleted" }, 409: errorResponse("Category still has expenses"), 404: errorResponse("Not found"), ...COMMON },
      },
    },
    "/api/budgets": {
      get: { tags: ["Budgets"], summary: "Budgets for a month with spending, status and projection", parameters: [monthParam], responses: { 200: { description: "Budgets", content: json({ type: "object", properties: { data: { type: "array", items: ref("Budget") } } }) }, ...COMMON } },
      put: { tags: ["Budgets"], summary: "Set a monthly budget (overall when categoryId is null)", requestBody: { content: json({ type: "object", required: ["limit"], properties: { month: { type: "string", example: "2026-11" }, categoryId: { type: ["integer", "null"] }, limit: { type: "number", example: 50000 } } }) }, responses: { 200: { description: "Updated" }, 201: { description: "Created" }, ...COMMON } },
    },
    "/api/budgets/{id}": { parameters: [idParam], delete: { tags: ["Budgets"], summary: "Remove a budget", responses: { 204: { description: "Deleted" }, 404: errorResponse("Not found"), ...COMMON } } },
    "/api/reports/summary": {
      get: {
        tags: ["Reports"], summary: "Totals, breakdowns, daily trend and top expenses",
        parameters: [monthParam, { name: "from", in: "query", schema: { type: "string", format: "date" } }, { name: "to", in: "query", schema: { type: "string", format: "date" } }],
        responses: { 200: { description: "Summary" }, ...COMMON },
      },
    },
    "/api/reports/monthly": { get: { tags: ["Reports"], summary: "Month-by-month totals with change", parameters: [{ name: "months", in: "query", schema: { type: "integer", default: 6, maximum: 24 } }], responses: { 200: { description: "Monthly totals" }, ...COMMON } } },
  },
};
