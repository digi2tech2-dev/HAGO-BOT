const mongoose = require("mongoose");

const connectDB = async (mongoUri = process.env.MONGO_URI) => {
  try {
    await mongoose.connect(mongoUri);
    console.log("MongoDB Connected Successfully.");
  } catch (error) {
    console.error("Database connection failed");
    throw error;
  }
};

module.exports = connectDB;
