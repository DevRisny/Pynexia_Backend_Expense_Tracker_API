"use strict";

const { loadConfig } = require("./config");
const { openDatabase } = require("./db");
const { createApp } = require("./app");

const config = loadConfig();
const db = openDatabase(config.dbFile);
const app = createApp(db, config);

const server = app.listen(config.port, () => {
  console.log(`Expense Tracker API running on http://localhost:${config.port}`);
  console.log(`  Dashboard  http://localhost:${config.port}/`);
  console.log(`  API docs   http://localhost:${config.port}/docs`);
});

// close the database cleanly on Ctrl+C or when a container stops
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
}
