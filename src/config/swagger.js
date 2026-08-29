function isSwaggerEnabled(env = process.env) {
  if (env.SWAGGER_ENABLED === "true") return true;
  if (env.SWAGGER_ENABLED === "false") return false;
  return env.NODE_ENV !== "production";
}

module.exports = { isSwaggerEnabled };
