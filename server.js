const dotenv = require("dotenv");
const connectDB = require("./src/config/db");
const createApp = require("./src/app");
const { validateRuntimeConfig } = require("./src/config/runtime");

dotenv.config();
async function start() {
  const config = validateRuntimeConfig();
  await connectDB(config.mongoUri);
  const app = createApp();
  const server = app.listen(config.port, config.host, () => console.log("API server started"));
  const shutdown = async () => {
    server.close();
    const mongoose = require("mongoose");
    await mongoose.connection.close();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

start().catch((error) => {
  console.error("Unable to start API server");
  process.exitCode = 1;
});
