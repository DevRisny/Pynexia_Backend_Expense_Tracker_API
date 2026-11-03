"use strict";

/** An error with an HTTP status and a stable machine-readable code. */
class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const notFound = (what = "Resource") => new ApiError(404, "not_found", `${what} not found`);

function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: "route_not_found", message: `No route for ${req.method} ${req.path}` } });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: { code: "invalid_json", message: "Request body is not valid JSON" } });
  }
  if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
    return res.status(409).json({ error: { code: "conflict", message: "A record with these values already exists" } });
  }
  if (err.code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
    return res.status(409).json({ error: { code: "in_use", message: "This record is still used by other records" } });
  }
  console.error(`[${req.id}]`, err);
  res.status(500).json({ error: { code: "internal_error", message: "Something went wrong on our side", requestId: req.id } });
}

module.exports = { ApiError, notFound, notFoundHandler, errorHandler };
