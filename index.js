require("dotenv").config();
const express = require("express");
const cors = require("cors");

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

app.get("/", (req, res) => {
  res.send("SalonBook server is running");
});

const port = process.env.PORT || 5000;
app.listen(port, () => {
  console.log(`SalonBook server listening on port ${port}`);
});