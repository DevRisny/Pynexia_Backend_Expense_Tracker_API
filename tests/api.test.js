"use strict";

const { test, describe, before } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { openDatabase } = require("../src/db");
const { createApp } = require("../src/app");
const { loadConfig } = require("../src/config");

const today = new Date().toISOString().slice(0, 10);
const month = today.slice(0, 7);

function makeApp(overrides = {}) {
  const config = loadConfig({ jwtSecret: "test-secret-0123456789", bcryptRounds: 4, loginRateLimit: 1000, ...overrides });
  return createApp(openDatabase(":memory:"), config);
}

async function signUp(app, email = "risny@example.com") {
  const res = await request(app).post("/api/auth/register").send({ name: "Risny", email, password: "Budget2026" });
  assert.equal(res.status, 201);
  return { token: res.body.token, auth: { Authorization: `Bearer ${res.body.token}` } };
}

describe("auth", () => {
  const app = makeApp();

  test("registers, signs in and returns the profile", async () => {
    const { auth } = await signUp(app);
    const login = await request(app).post("/api/auth/login").send({ email: "RISNY@example.com", password: "Budget2026" });
    assert.equal(login.status, 200);
    assert.ok(login.body.token);
    const me = await request(app).get("/api/auth/me").set(auth);
    assert.equal(me.body.user.email, "risny@example.com");
    assert.equal(me.body.user.currency, "LKR");
    assert.equal(me.body.user.password_hash, undefined, "never leaks the hash");
  });

  test("rejects duplicate emails and weak passwords", async () => {
    const dup = await request(app).post("/api/auth/register").send({ name: "Risny", email: "risny@example.com", password: "Budget2026" });
    assert.equal(dup.status, 409);
    const weak = await request(app).post("/api/auth/register").send({ name: "A", email: "nope", password: "short" });
    assert.equal(weak.status, 422);
    const fields = weak.body.error.details.map((d) => d.field).sort();
    assert.deepEqual(fields, ["email", "name", "password", "password"].sort());
  });

  test("wrong password and unknown email give the same answer", async () => {
    const a = await request(app).post("/api/auth/login").send({ email: "risny@example.com", password: "Wrong12345" });
    const b = await request(app).post("/api/auth/login").send({ email: "ghost@example.com", password: "Wrong12345" });
    assert.equal(a.status, 401); assert.equal(b.status, 401);
    assert.deepEqual(a.body, b.body);
  });

  test("protects routes and rejects tampered tokens", async () => {
    assert.equal((await request(app).get("/api/expenses")).status, 401);
    const { token } = await signUp(app, "tamper@example.com");
    const bad = token.slice(0, -2) + (token.endsWith("aa") ? "bb" : "aa");
    const res = await request(app).get("/api/expenses").set("Authorization", `Bearer ${bad}`);
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, "invalid_token");
  });

  test("changes the password", async () => {
    const { auth } = await signUp(app, "change@example.com");
    const wrong = await request(app).post("/api/auth/change-password").set(auth).send({ currentPassword: "nope", newPassword: "NewPass2026" });
    assert.equal(wrong.status, 401);
    const ok = await request(app).post("/api/auth/change-password").set(auth).send({ currentPassword: "Budget2026", newPassword: "NewPass2026" });
    assert.equal(ok.status, 204);
    assert.equal((await request(app).post("/api/auth/login").send({ email: "change@example.com", password: "NewPass2026" })).status, 200);
  });

  test("rate-limits repeated sign-in attempts", async () => {
    const limited = makeApp({ loginRateLimit: 3 });
    const tries = [];
    for (let i = 0; i < 4; i++) tries.push((await request(limited).post("/api/auth/login").send({ email: "x@y.com", password: "Wrong12345" })).status);
    assert.deepEqual(tries, [401, 401, 401, 429]);
  });
});

describe("expenses", () => {
  const app = makeApp();
  let auth, cats;
  before(async () => {
    ({ auth } = await signUp(app));
    cats = (await request(app).get("/api/categories").set(auth)).body.data;
  });
  const cat = (name) => cats.find((c) => c.name === name).id;

  test("new accounts get 8 default categories", () => assert.equal(cats.length, 8));

  test("creates, reads, updates and deletes an expense", async () => {
    const created = await request(app).post("/api/expenses").set(auth)
      .send({ amount: 1250.5, description: "Bus pass", categoryId: cat("Transport"), paymentMethod: "card" });
    assert.equal(created.status, 201);
    assert.equal(created.body.data.amount, 1250.5);
    assert.equal(created.body.data.spentOn, today);
    assert.match(created.headers.location, /\/api\/expenses\/\d+$/);
    const id = created.body.data.id;

    const patched = await request(app).patch(`/api/expenses/${id}`).set(auth).send({ amount: 1300, note: "Monthly" });
    assert.equal(patched.body.data.amount, 1300);
    assert.equal(patched.body.data.note, "Monthly");
    assert.equal(patched.body.data.description, "Bus pass", "untouched fields stay");

    assert.equal((await request(app).delete(`/api/expenses/${id}`).set(auth)).status, 204);
    assert.equal((await request(app).get(`/api/expenses/${id}`).set(auth)).status, 404);
  });

  test("stores money exactly (no floating point drift)", async () => {
    for (const a of [0.1, 0.2]) await request(app).post("/api/expenses").set(auth).send({ amount: a, description: "drift test", categoryId: cat("Other") });
    const res = await request(app).get("/api/expenses?q=drift").set(auth);
    assert.equal(res.body.meta.totalAmount, 0.3);
  });

  test("validates input", async () => {
    const res = await request(app).post("/api/expenses").set(auth)
      .send({ amount: -5, description: "", categoryId: cat("Food & Dining"), spentOn: "2026-02-30" });
    assert.equal(res.status, 422);
    const fields = res.body.error.details.map((d) => d.field);
    for (const f of ["amount", "description", "spentOn"]) assert.ok(fields.includes(f), f);
    const future = await request(app).post("/api/expenses").set(auth).send({ amount: 10, description: "x", categoryId: cat("Other"), spentOn: "2999-01-01" });
    assert.equal(future.status, 422);
    const extra = await request(app).post("/api/expenses").set(auth).send({ amount: 10, description: "x", categoryId: cat("Other"), user_id: 99 });
    assert.equal(extra.status, 422, "unknown fields such as user_id are rejected");
  });

  test("filters, searches, sorts and pages", async () => {
    const add = (amount, description, name, paymentMethod = "cash") =>
      request(app).post("/api/expenses").set(auth).send({ amount, description, categoryId: cat(name), paymentMethod });
    await add(450, "Lunch rice and curry", "Food & Dining");
    await add(3200, "Groceries 50% off", "Food & Dining", "card");
    await add(800, "Tuk tuk", "Transport");
    await add(15000, "Textbooks", "Education", "bank");

    const food = await request(app).get(`/api/expenses?categoryId=${cat("Food & Dining")}`).set(auth);
    assert.equal(food.body.meta.total, 2);
    assert.equal(food.body.meta.totalAmount, 3650);

    const pct = await request(app).get("/api/expenses?q=50%25").set(auth);
    assert.equal(pct.body.meta.total, 1, "% is searched literally");

    const range = await request(app).get("/api/expenses?min=500&max=5000&sort=amount&order=asc").set(auth);
    assert.deepEqual(range.body.data.map((e) => e.amount), [800, 3200]);

    const paged = await request(app).get("/api/expenses?limit=2&page=2&sort=amount&order=desc").set(auth);
    assert.equal(paged.body.data.length, 2);
    assert.equal(paged.body.meta.page, 2);

    const bad = await request(app).get("/api/expenses?from=2026-05-01&to=2026-04-01").set(auth);
    assert.equal(bad.status, 422);
  });

  test("exports CSV safely", async () => {
    await request(app).post("/api/expenses").set(auth).send({ amount: 99, description: "=HYPERLINK(\"x\")", categoryId: cat("Other") });
    const res = await request(app).get("/api/expenses/export.csv").set(auth);
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /text\/csv/);
    assert.match(res.headers["content-disposition"], /attachment/);
    assert.ok(res.text.startsWith("date,description,category,amount"));
    assert.ok(res.text.includes("\"'=HYPERLINK(\"\"x\"\")\""), "formula is neutralised");
  });

  test("users cannot see or change each other's data", async () => {
    const other = await signUp(app, "other@example.com");
    const mine = await request(app).post("/api/expenses").set(auth).send({ amount: 10, description: "private", categoryId: cat("Other") });
    const id = mine.body.data.id;
    assert.equal((await request(app).get(`/api/expenses/${id}`).set(other.auth)).status, 404);
    assert.equal((await request(app).patch(`/api/expenses/${id}`).set(other.auth).send({ amount: 1 })).status, 404);
    assert.equal((await request(app).delete(`/api/expenses/${id}`).set(other.auth)).status, 404);
    const theirList = await request(app).get("/api/expenses").set(other.auth);
    assert.equal(theirList.body.meta.total, 0);
    const steal = await request(app).post("/api/expenses").set(other.auth).send({ amount: 10, description: "x", categoryId: cat("Other") });
    assert.equal(steal.status, 422, "cannot file an expense under someone else's category");
  });
});

describe("categories", () => {
  const app = makeApp();
  let auth;
  before(async () => ({ auth } = await signUp(app)));

  test("creates, renames and blocks duplicates", async () => {
    const c = await request(app).post("/api/categories").set(auth).send({ name: "Gym", icon: "🏋️", color: "#12a594" });
    assert.equal(c.status, 201);
    assert.equal((await request(app).post("/api/categories").set(auth).send({ name: "gym" })).status, 409);
    const r = await request(app).patch(`/api/categories/${c.body.data.id}`).set(auth).send({ name: "Fitness" });
    assert.equal(r.body.data.name, "Fitness");
  });

  test("a category with expenses needs reassignTo before deletion", async () => {
    const cats = (await request(app).get("/api/categories").set(auth)).body.data;
    const from = cats.find((c) => c.name === "Shopping").id;
    const to = cats.find((c) => c.name === "Other").id;
    await request(app).post("/api/expenses").set(auth).send({ amount: 2000, description: "Shoes", categoryId: from });
    const blocked = await request(app).delete(`/api/categories/${from}`).set(auth);
    assert.equal(blocked.status, 409);
    assert.equal((await request(app).delete(`/api/categories/${from}?reassignTo=${to}`).set(auth)).status, 204);
    const moved = await request(app).get(`/api/expenses?categoryId=${to}`).set(auth);
    assert.equal(moved.body.data[0].description, "Shoes");
  });
});

describe("budgets and reports", () => {
  const app = makeApp();
  let auth, food, transport;
  before(async () => {
    ({ auth } = await signUp(app));
    const cats = (await request(app).get("/api/categories").set(auth)).body.data;
    food = cats.find((c) => c.name === "Food & Dining").id;
    transport = cats.find((c) => c.name === "Transport").id;
    for (const [amount, categoryId, paymentMethod] of [[4000, food, "cash"], [5000, food, "card"], [1000, transport, "cash"]]) {
      await request(app).post("/api/expenses").set(auth).send({ amount, description: "spend", categoryId, paymentMethod });
    }
  });

  test("budget status moves from ok to warning to over", async () => {
    assert.equal((await request(app).put("/api/budgets").set(auth).send({ categoryId: food, limit: 10000 })).status, 201);
    assert.equal((await request(app).put("/api/budgets").set(auth).send({ categoryId: transport, limit: 5000 })).status, 201);
    assert.equal((await request(app).put("/api/budgets").set(auth).send({ limit: 9000 })).status, 201, "overall budget");
    const res = await request(app).get(`/api/budgets?month=${month}`).set(auth);
    const by = Object.fromEntries(res.body.data.map((b) => [b.category ? b.category.name : "overall", b]));
    assert.equal(by["Food & Dining"].status, "warning");
    assert.equal(by["Food & Dining"].percentUsed, 90);
    assert.equal(by.Transport.status, "ok");
    assert.equal(by.overall.status, "over");
    assert.equal(by.overall.spent, 10000);
    assert.equal(by.overall.remaining, 0);

    const again = await request(app).put("/api/budgets").set(auth).send({ categoryId: food, limit: 20000 });
    assert.equal(again.status, 200, "setting it again updates instead of duplicating");
  });

  test("summary report adds up", async () => {
    const r = (await request(app).get(`/api/reports/summary?month=${month}`).set(auth)).body;
    assert.equal(r.total, 10000);
    assert.equal(r.count, 3);
    assert.equal(r.byCategory[0].name, "Food & Dining");
    assert.equal(r.byCategory[0].share, 90);
    assert.equal(r.byPaymentMethod.find((m) => m.method === "cash").total, 5000);
    assert.equal(r.topExpenses[0].amount, 5000);
  });

  test("monthly report covers the requested months", async () => {
    const r = (await request(app).get("/api/reports/monthly?months=3").set(auth)).body;
    assert.equal(r.data.length, 3);
    assert.equal(r.data[2].month, month);
    assert.equal(r.data[2].total, 10000);
  });
});

describe("platform", () => {
  const app = makeApp();
  test("health, docs, security headers and JSON errors", async () => {
    const h = await request(app).get("/api/health");
    assert.equal(h.body.status, "ok");
    assert.ok(h.headers["x-request-id"]);
    assert.equal(h.headers["x-powered-by"], undefined);
    assert.ok(h.headers["content-security-policy"]);
    assert.equal((await request(app).get("/openapi.json")).body.openapi, "3.1.0");
    const missing = await request(app).get("/api/nope");
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, "route_not_found");
    const badJson = await request(app).post("/api/auth/login").set("Content-Type", "application/json").send("{oops");
    assert.equal(badJson.status, 400);
    assert.equal(badJson.body.error.code, "invalid_json");
  });
});
