"use strict";

const jwt = require("jsonwebtoken");
const { ApiError } = require("./errors");

/** Requires "Authorization: Bearer <token>" and puts the user on req.user. */
function requireAuth(config, db) {
  const findUser = db.prepare("SELECT id, name, email, currency FROM users WHERE id = ?");
  return (req, res, next) => {
    const header = req.get("authorization") || "";
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) {
      return next(new ApiError(401, "unauthorized", "Sign in first: send an Authorization: Bearer <token> header"));
    }
    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"], issuer: "expense-tracker" });
    } catch (e) {
      const expired = e.name === "TokenExpiredError";
      return next(new ApiError(401, expired ? "token_expired" : "invalid_token", expired ? "Your session expired, sign in again" : "The token is not valid"));
    }
    const user = findUser.get(Number(payload.sub));
    if (!user) return next(new ApiError(401, "invalid_token", "The account for this token no longer exists"));
    req.user = user;
    next();
  };
}

function signToken(config, user) {
  return jwt.sign({ sub: String(user.id), name: user.name }, config.jwtSecret, {
    algorithm: "HS256", expiresIn: config.jwtExpiresIn, issuer: "expense-tracker",
  });
}

module.exports = { requireAuth, signToken };
