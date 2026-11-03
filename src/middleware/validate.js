"use strict";

const { ApiError } = require("./errors");

/**
 * Validate req[source] against a zod schema and replace it with the parsed,
 * typed value. Errors list every invalid field so clients can show them all.
 */
function validate(schema, source = "body") {
  return (req, res, next) => {
    const result = schema.safeParse(req[source] ?? {});
    if (!result.success) {
      const details = result.error.issues.map((i) => ({ field: i.path.join(".") || source, message: i.message }));
      return next(new ApiError(422, "validation_failed", "Some fields are invalid", details));
    }
    // Express 5 makes req.query a getter, so parsed values go on req.valid
    req.valid = { ...(req.valid || {}), [source]: result.data };
    next();
  };
}

module.exports = { validate };
