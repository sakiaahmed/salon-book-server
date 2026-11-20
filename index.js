require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");

const app = express();

const corsOptions = {
  origin: [
    "http://localhost:3000",
    process.env.CLIENT_URL,
  ].filter(Boolean),
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());

const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
});

async function run() {
  try {
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    console.log("✅ Connected to MongoDB successfully!");
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err.message);
  }
}
run();

app.get("/", (req, res) => {
  res.send("SalonBook server is running");
});

const port = process.env.PORT || 5000;
app.listen(port, () => {
  console.log(`SalonBook server listening on port ${port}`);
});