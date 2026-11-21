
require("dotenv").config();

const express = require("express");
const Stripe = require("stripe");
const { ObjectId } = require("mongodb");
const { randomUUID } = require("crypto");

const { db } = require("../auth");

const {
  verifyToken,
  verifyAdmin,
  verifyCustomer,
} = require("../middlewares/auth");

const router = express.Router();

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const appointmentsCollection = db.collection("appointments");
const transactionsCollection = db.collection("transactions");

const CLIENT_URL = (
  process.env.CLIENT_URL || "http://localhost:3000"
).replace(/\/+$/, "");

const CURRENCY = (
  process.env.STRIPE_CURRENCY || "bdt"
).toLowerCase();

const ZERO_DECIMAL_CURRENCIES = new Set([
  "bif", "clp", "djf", "gnf", "jpy",
  "kmf", "krw", "mga", "pyg", "rwf",
  "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
]);

const CHECKOUT_LOCK_MS = 5 * 60 * 1000;

let paymentIndexesPromise = null;

// ============================================
// GENERAL HELPERS
// ============================================

const isValidId = (id) => {
  return (
    typeof id === "string" &&
    /^[a-fA-F0-9]{24}$/.test(id)
  );
};

const toMinorUnits = (amount) => {
  const multiplier = ZERO_DECIMAL_CURRENCIES.has(CURRENCY)
    ? 1
    : 100;

  return Math.round(Number(amount) * multiplier);
};

const fromMinorUnits = (amount) => {
  const divisor = ZERO_DECIMAL_CURRENCIES.has(CURRENCY)
    ? 1
    : 100;

  return Number(amount) / divisor;
};

// Ensure one transaction per Stripe Checkout Session
const ensurePaymentIndexes = async () => {
  if (!paymentIndexesPromise) {
    paymentIndexesPromise = transactionsCollection
      .createIndex(
        { stripeSessionId: 1 },
        {
          unique: true,
          sparse: true,
          name: "unique_stripe_session_id",
        }
      )
      .catch((error) => {
        paymentIndexesPromise = null;
        throw error;
      });
  }

  return paymentIndexesPromise;
};

// Stripe configuration and index check
const checkStripe = async (req, res, next) => {
  if (!stripe) {
    return res.status(503).json({
      message: "Stripe is not configured",
    });
  }

  if (!/^[a-z]{3}$/.test(CURRENCY)) {
    return res.status(500).json({
      message: "Invalid Stripe currency configuration",
    });
  }

  try {
    await ensurePaymentIndexes();
    next();
  } catch (error) {
    console.error("Payment index initialization error:", error);

    return res.status(500).json({
      message: "Payment database initialization failed",
    });
  }
};

// Validate Stripe session metadata against appointment
const validateSessionMetadata = async (session) => {
  const appointmentId = session.metadata?.appointmentId;
  const customerId = session.metadata?.customerId;

  if (!isValidId(appointmentId) || !isValidId(customerId)) {
    return {
      valid: false,
      message: "Invalid payment metadata",
    };
  }

  if (
    session.mode !== "payment" ||
    session.client_reference_id !== appointmentId
  ) {
    return {
      valid: false,
      message: "Invalid Checkout Session reference",
    };
  }

  const appointment = await appointmentsCollection.findOne({
    _id: new ObjectId(appointmentId),
  });

  if (!appointment) {
    return {
      valid: false,
      message: "Appointment not found",
    };
  }

  if (appointment.customerId.toString() !== customerId) {
    return {
      valid: false,
      message: "Payment customer does not match appointment owner",
    };
  }

  return {
    valid: true,
    appointment,
  };
};

// ============================================
// TRANSACTION HELPERS
// ============================================

// Successful payment always wins over a failed event.
// Repeated successful events update the same transaction.
const savePaidTransaction = async (transactionData) => {
  await transactionsCollection.updateOne(
    {
      stripeSessionId: transactionData.stripeSessionId,
    },
    {
      $set: {
        ...transactionData,
        status: "paid",
        updatedAt: new Date(),
      },
      $setOnInsert: {
        createdAt: new Date(),
      },
    },
    {
      upsert: true,
    }
  );
};

// Failed events must never overwrite an already-paid transaction.
const saveFailedTransaction = async (transactionData) => {
  const existing = await transactionsCollection.findOne({
    stripeSessionId: transactionData.stripeSessionId,
  });

  if (existing?.status?.toLowerCase() === "paid") {
    console.log(
      "Ignoring failed event for an already-paid session:",
      transactionData.stripeSessionId
    );

    return;
  }

  if (existing) {
    await transactionsCollection.updateOne(
      {
        _id: existing._id,
        status: { $ne: "paid" },
      },
      {
        $set: {
          ...transactionData,
          status: "failed",
          updatedAt: new Date(),
        },
      }
    );

    return;
  }

  try {
    await transactionsCollection.insertOne({
      ...transactionData,
      status: "failed",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  } catch (error) {
    // Another webhook may have inserted this session concurrently.
    if (error.code !== 11000) {
      throw error;
    }

    await transactionsCollection.updateOne(
      {
        stripeSessionId: transactionData.stripeSessionId,
        status: { $ne: "paid" },
      },
      {
        $set: {
          ...transactionData,
          status: "failed",
          updatedAt: new Date(),
        },
      }
    );
  }
};

// ============================================
// 1. CREATE STRIPE CHECKOUT SESSION
// Customer Only
// ============================================

router.post(
  "/create-checkout-session",
  verifyToken,
  verifyCustomer,
  checkStripe,
  async (req, res) => {
    let lockToken = null;
    let createdSession = null;

    try {
      const { appointmentId } = req.body;

      if (!isValidId(appointmentId)) {
        return res.status(400).json({
          message: "Invalid appointment ID",
        });
      }

      const customerId = new ObjectId(req.user.id);

      const appointment = await appointmentsCollection.findOne({
        _id: new ObjectId(appointmentId),
        customerId,
      });

      if (!appointment) {
        return res.status(404).json({
          message: "Appointment not found",
        });
      }

      if (
        String(appointment.status).toLowerCase() !== "confirmed"
      ) {
        return res.status(400).json({
          message: "Only confirmed appointments can be paid",
        });
      }

      if (
        String(appointment.paymentStatus).toLowerCase() === "paid"
      ) {
        return res.status(400).json({
          message: "This appointment is already paid",
        });
      }

      const amount = Number(appointment.servicePrice);
      const unitAmount = toMinorUnits(amount);

      if (
        !Number.isFinite(amount) ||
        amount <= 0 ||
        !Number.isSafeInteger(unitAmount) ||
        unitAmount <= 0
      ) {
        return res.status(400).json({
          message: "Invalid appointment payment amount",
        });
      }

      // Reuse the existing open Checkout Session
      if (appointment.stripeSessionId) {
        try {
          const existingSession =
            await stripe.checkout.sessions.retrieve(
              appointment.stripeSessionId
            );

          const metadataMatches =
            existingSession.metadata?.appointmentId ===
              appointment._id.toString() &&
            existingSession.metadata?.customerId ===
              req.user.id;

          if (!metadataMatches) {
            return res.status(409).json({
              message: "Existing payment session does not match this appointment",
            });
          }

          if (
            existingSession.status === "open" &&
            existingSession.url
          ) {
            return res.status(200).json({
              message: "Existing checkout session found",
              sessionId: existingSession.id,
              url: existingSession.url,
            });
          }

          if (
            existingSession.status === "complete" ||
            existingSession.payment_status === "paid"
          ) {
            return res.status(409).json({
              message: "Payment has been submitted and is being verified",
            });
          }

          // An expired session can be replaced.
        } catch (error) {
          if (error.code !== "resource_missing") {
            throw error;
          }

          console.warn("Previous Checkout Session was not found.");
        }
      }

      // Acquire an atomic checkout lock
      lockToken = randomUUID();

      const now = new Date();
      const lockExpiresAt = new Date(
        now.getTime() + CHECKOUT_LOCK_MS
      );

      const lockResult = await appointmentsCollection.updateOne(
        {
          _id: appointment._id,
          customerId,
          status: "confirmed",
          paymentStatus: { $ne: "paid" },

          $or: [
            {
              checkoutLockExpiresAt: { $exists: false },
            },
            {
              checkoutLockExpiresAt: { $lte: now },
            },
          ],
        },
        {
          $set: {
            checkoutLockToken: lockToken,
            checkoutLockExpiresAt: lockExpiresAt,
          },
        }
      );

      if (lockResult.modifiedCount !== 1) {
        return res.status(409).json({
          message: "A checkout request is already being processed. Please try again shortly.",
        });
      }

      // Create Checkout Session
      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",

          customer_email: req.user.email,

          client_reference_id: appointment._id.toString(),

          line_items: [
            {
              price_data: {
                currency: CURRENCY,

                product_data: {
                  name: appointment.serviceName,
                  description:
                    `SalonBook appointment - ${appointment.appointmentDate}`,
                },

                unit_amount: unitAmount,
              },

              quantity: 1,
            },
          ],

          metadata: {
            appointmentId: appointment._id.toString(),
            customerId: req.user.id,
          },

          payment_intent_data: {
            metadata: {
              appointmentId: appointment._id.toString(),
              customerId: req.user.id,
            },
          },

          success_url:
            `${CLIENT_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,

          cancel_url:
            `${CLIENT_URL}/payment/cancel?appointmentId=${appointment._id}`,
        },
        {
          idempotencyKey:
            `salonbook-${appointment._id}-${lockToken}`,
        }
      );

      createdSession = session;

      if (!session.id || !session.url) {
        throw new Error("Stripe did not return a valid Checkout URL");
      }

      // Store the session only if this request still owns the lock
      const saveResult = await appointmentsCollection.updateOne(
        {
          _id: appointment._id,
          customerId,
          checkoutLockToken: lockToken,
          status: "confirmed",
          paymentStatus: { $ne: "paid" },
        },
        {
          $set: {
            stripeSessionId: session.id,
            stripeSessionCreatedAt: new Date(),
            updatedAt: new Date(),
          },

          $unset: {
            checkoutLockToken: "",
            checkoutLockExpiresAt: "",
          },
        }
      );

      if (saveResult.modifiedCount !== 1) {
        // Prevent a session from remaining open when it was not saved.
        try {
          await stripe.checkout.sessions.expire(session.id);
        } catch (expireError) {
          console.error(
            "Unable to expire unsaved Checkout Session:",
            expireError.message
          );
        }

        createdSession = null;

        return res.status(409).json({
          message: "Appointment changed while checkout was being created. Please refresh and try again.",
        });
      }

      res.status(201).json({
        message: "Stripe Checkout Session created successfully",
        sessionId: session.id,
        url: session.url,
      });

    } catch (error) {
      console.error(
        "Stripe Checkout Error:",
        error.message
      );

      // Best-effort cleanup of a newly created but unsaved session.
      if (createdSession?.id && stripe) {
        try {
          await stripe.checkout.sessions.expire(
            createdSession.id
          );
        } catch (expireError) {
          console.error(
            "Checkout cleanup error:",
            expireError.message
          );
        }
      }

      if (lockToken && isValidId(req.body?.appointmentId)) {
        await appointmentsCollection.updateOne(
          {
            _id: new ObjectId(req.body.appointmentId),
            checkoutLockToken: lockToken,
          },
          {
            $unset: {
              checkoutLockToken: "",
              checkoutLockExpiresAt: "",
            },
          }
        ).catch((cleanupError) => {
          console.error(
            "Checkout lock cleanup error:",
            cleanupError.message
          );
        });
      }

      res.status(500).json({
        message: "Failed to create checkout session",
      });
    }
  }
);

// ============================================
// 2. GET CUSTOMER TRANSACTIONS
// ============================================

router.get(
  "/my-transactions",
  verifyToken,
  verifyCustomer,
  async (req, res) => {
    try {
      const transactions = await transactionsCollection
        .find({
          customerId: new ObjectId(req.user.id),
        })
        .sort({ createdAt: -1 })
        .toArray();

      res.status(200).json(transactions);

    } catch (error) {
      console.error(
        "Customer transactions error:",
        error.message
      );

      res.status(500).json({
        message: "Failed to retrieve transactions",
      });
    }
  }
);

// ============================================
// 3. GET ALL TRANSACTIONS
// Admin Only
// ============================================

router.get(
  "/admin/transactions",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const transactions = await transactionsCollection
        .find({})
        .sort({ createdAt: -1 })
        .toArray();

      res.status(200).json(transactions);

    } catch (error) {
      console.error(
        "Admin transactions error:",
        error.message
      );

      res.status(500).json({
        message: "Failed to retrieve transactions",
      });
    }
  }
);

// ============================================
// 4. PROCESS SUCCESSFUL PAYMENT
// ============================================

const processPaidSession = async (event, session) => {
  const validation = await validateSessionMetadata(session);

  if (!validation.valid) {
    throw new Error(validation.message);
  }

  const appointment = validation.appointment;

  const expectedAmount = toMinorUnits(
    appointment.servicePrice
  );

  const amountMatches =
    session.amount_total === expectedAmount;

  const currencyMatches =
    session.currency === CURRENCY;

  const sessionLinked =
    appointment.stripeSessionId === session.id;

  const appointmentConfirmed =
    String(appointment.status).toLowerCase() === "confirmed";

  const reviewReasons = [];

  if (!amountMatches) {
    reviewReasons.push("Payment amount does not match appointment price");
  }

  if (!currencyMatches) {
    reviewReasons.push("Payment currency does not match configured currency");
  }

  if (!sessionLinked) {
    reviewReasons.push("Checkout Session is not linked to the current appointment");
  }

  if (!appointmentConfirmed) {
    reviewReasons.push("Appointment was not confirmed when payment completed");
  }

  const requiresReview = reviewReasons.length > 0;

  const refundRequired =
    String(appointment.status).toLowerCase() === "cancelled";

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || null;

  const transactionData = {
    appointmentId: appointment._id,
    customerId: appointment.customerId,
    userName: appointment.customerName,
    customerEmail: appointment.customerEmail,

    amount: fromMinorUnits(session.amount_total),
    currency: session.currency,

    stripeSessionId: session.id,
    stripePaymentIntentId: paymentIntentId,

    stripeEventId: event.id,

    status: "paid",

    requiresReview,
    reviewReason: reviewReasons.join("; ") || null,
    refundRequired,

    updatedAt: new Date(),
  };

  // Record the actual successful Stripe payment.
  // Unique session index makes repeated delivery idempotent.
  await savePaidTransaction(transactionData);

  // Update appointment payment state.
  // Even if the appointment was cancelled after checkout began,
  // record the money received and flag it for review/refund.
  const appointmentUpdate = await appointmentsCollection.updateOne(
    {
      _id: appointment._id,
      customerId: appointment.customerId,
    },
    {
      $set: {
        paymentStatus: "paid",
        paidAt: appointment.paidAt || new Date(),
        paidStripeSessionId: session.id,
        paymentReviewRequired: requiresReview,
        paymentReviewReason:
          reviewReasons.join("; ") || null,
        refundRequired,
        updatedAt: new Date(),
      },
    }
  );

  if (appointmentUpdate.matchedCount !== 1) {
    throw new Error("Unable to update the appointment payment status");
  }

  console.log(
    "Stripe payment recorded:",
    session.id,
    "Event:",
    event.id,
    "Review required:",
    requiresReview
  );
};

// ============================================
// ADMIN PAYMENT RECOVERY
// Temporary endpoint for recovering verified Stripe payments
// ============================================

router.post(
  "/admin/reconcile-payment",
  verifyToken,
  verifyAdmin,
  checkStripe,
  async (req, res) => {
    try {
      const { sessionId } = req.body;

      if (
        typeof sessionId !== "string" ||
        !sessionId.startsWith("cs_")
      ) {
        return res.status(400).json({
          message: "A valid Stripe Checkout Session ID is required",
        });
      }

      // Retrieve the actual Checkout Session directly from Stripe.
      const session = await stripe.checkout.sessions.retrieve(
        sessionId
      );

      // Never recover a payment that Stripe does not confirm as paid.
      if (
        session.status !== "complete" ||
        session.payment_status !== "paid"
      ) {
        return res.status(400).json({
          message: "Stripe has not confirmed this payment as paid",
          paymentStatus: session.payment_status,
        });
      }

      // Validate appointment/customer metadata and process payment.
      // The existing function also checks amount, currency and session link.
      await processPaidSession(
        {
          id: `manual_recovery_${session.id}`,
          type: "manual.reconciliation",
        },
        session
      );

      return res.status(200).json({
        success: true,
        message: "Payment successfully recovered",
        sessionId: session.id,
        paymentStatus: "paid",
      });

    } catch (error) {
      console.error(
        "Admin payment recovery error:",
        error.message
      );

      return res.status(500).json({
        message: error.message || "Payment recovery failed",
      });
    }
  }
);


// ============================================
// 5. PROCESS FAILED OR EXPIRED PAYMENT
// ============================================

const processFailedSession = async (event, session) => {
  const validation = await validateSessionMetadata(session);

  if (!validation.valid) {
    throw new Error(validation.message);
  }

  const appointment = validation.appointment;

  const transactionData = {
    appointmentId: appointment._id,
    customerId: appointment.customerId,
    userName: appointment.customerName,
    customerEmail: appointment.customerEmail,

    amount: session.amount_total !== null
      ? fromMinorUnits(session.amount_total)
      : Number(appointment.servicePrice),

    currency: session.currency || CURRENCY,

    stripeSessionId: session.id,

    stripePaymentIntentId:
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id || null,

    stripeEventId: event.id,

    requiresReview: false,
    refundRequired: false,
  };

  // Never replace an already-paid transaction with failed.
  await saveFailedTransaction(transactionData);

  // Clear only this expired/failed session.
  // Keep the appointment unpaid so customer can retry.
  await appointmentsCollection.updateOne(
    {
      _id: appointment._id,
      stripeSessionId: session.id,
      paymentStatus: { $ne: "paid" },
    },
    {
      $unset: {
        stripeSessionId: "",
        stripeSessionCreatedAt: "",
        checkoutLockToken: "",
        checkoutLockExpiresAt: "",
      },

      $set: {
        updatedAt: new Date(),
      },
    }
  );

  console.log(
    "Stripe failed/expired session recorded:",
    session.id,
    "Event:",
    event.id
  );
};

// ============================================
// 6. STRIPE WEBHOOK HANDLER
// Raw request body is required
// ============================================

const handleStripeWebhook = async (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).send(
      "Stripe webhook is not configured"
    );
  }

  if (!Buffer.isBuffer(req.body)) {
    return res.status(400).send(
      "Stripe webhook requires the raw request body"
    );
  }

  const signature = req.headers["stripe-signature"];

  if (!signature) {
    return res.status(400).send(
      "Stripe signature is missing"
    );
  }

  let event;

  // Verify signature before accessing payment information.
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );

  } catch (error) {
    console.error(
      "Webhook signature verification failed:",
      error.message
    );

    return res.status(400).send(
      "Invalid Stripe webhook signature"
    );
  }

  try {
    await ensurePaymentIndexes();

    const supportedEvents = [
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "checkout.session.expired",
      "checkout.session.async_payment_failed",
    ];

    // Ignore unrelated events.
    if (!supportedEvents.includes(event.type)) {
      return res.status(200).json({
        received: true,
        ignored: true,
      });
    }

    const sessionId = event.data?.object?.id;

    if (typeof sessionId !== "string" || !sessionId.startsWith("cs_")) {
      return res.status(400).send(
        "Invalid Checkout Session event"
      );
    }

    // Retrieve the latest authoritative Stripe Session state.
    const session = await stripe.checkout.sessions.retrieve(
      sessionId
    );

    const paidEvents = [
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
    ];

    const failedEvents = [
      "checkout.session.expired",
      "checkout.session.async_payment_failed",
    ];

    // Completed event can arrive before a delayed payment finishes.
    // Wait for async_payment_succeeded in that case.
    if (
      paidEvents.includes(event.type) &&
      session.payment_status !== "paid"
    ) {
      return res.status(200).json({
        received: true,
        message: "Payment is not completed yet",
      });
    }

    // An older failure/expiration event must not downgrade
    // a payment that Stripe now reports as paid.
    if (
      failedEvents.includes(event.type) &&
      session.payment_status === "paid"
    ) {
      await processPaidSession(event, session);

      return res.status(200).json({
        received: true,
        message: "Latest Stripe state is paid",
      });
    }

    if (paidEvents.includes(event.type)) {
      await processPaidSession(event, session);
    } else if (failedEvents.includes(event.type)) {
      await processFailedSession(event, session);
    }

    return res.status(200).json({
      received: true,
    });

  } catch (error) {
    console.error(
      "Webhook processing error:",
      error.message
    );

    return res.status(500).send(
      "Webhook processing failed"
    );
  }
};

module.exports = {
  router,
  handleStripeWebhook,
};
