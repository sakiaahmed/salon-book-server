require("dotenv").config();

const express = require("express");
const cors = require("cors");

const { toNodeHandler } = require("better-auth/node");
const { auth } = require("./auth");

const servicesRouter = require("./routes/services");
const appointmentsRouter = require("./routes/appointments");

const {
  router: paymentsRouter,
  handleStripeWebhook,
} = require("./routes/payments");

const app = express();

// Allowed frontend origins
const allowedOrigins = [
  "http://localhost:3000",
  "https://salonbook-client-omega.vercel.app",
  process.env.CLIENT_URL,
].filter(Boolean);

// CORS Configuration
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests without origin (Postman/server-to-server)
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Not allowed by CORS"));
  },

  credentials: true,

  methods: [
    "GET",
    "POST",
    "PUT",
    "DELETE",
    "PATCH",
    "OPTIONS",
  ],

  allowedHeaders: [
    "Content-Type",
    "Authorization",
  ],
};

app.use(cors(corsOptions));

// Stripe Webhook
// IMPORTANT: Must be before express.json()
app.post(
  "/api/payments/webhook",
  express.raw({ type: "application/json" }),
  handleStripeWebhook
);

// Better Auth
app.all("/api/auth/*splat", toNodeHandler(auth));

// Parse JSON requests
app.use(express.json());

// Application Routes
app.use("/api/services", servicesRouter);
app.use("/api/appointments", appointmentsRouter);
app.use("/api/payments", paymentsRouter);

// Health Check
app.get("/", (req, res) => {
  res.send("SalonBook server is running");
});

// Start Server
const port = process.env.PORT || 5000;

app.listen(port, () => {
  console.log(`SalonBook server listening on port ${port}`);
});