
const express = require("express");
const { ObjectId } = require("mongodb");
const { db } = require("../auth");

const {
  verifyToken,
  verifyAdmin,
  verifyCustomer,
} = require("../middlewares/auth");

const router = express.Router();

const appointmentsCollection = db.collection("appointments");
const servicesCollection = db.collection("services");

// Available appointment time slots
const AVAILABLE_TIME_SLOTS = [
  "10:00 AM",
  "11:00 AM",
  "12:00 PM",
  "01:00 PM",
  "02:00 PM",
  "03:00 PM",
  "04:00 PM",
  "05:00 PM",
  "06:00 PM",
  "07:00 PM",
];

// Unique index to prevent duplicate active bookings
let appointmentSlotIndexPromise;

const ensureAppointmentSlotIndex = () => {
  if (!appointmentSlotIndexPromise) {
    appointmentSlotIndexPromise =
      appointmentsCollection.createIndex(
        {
          appointmentDate: 1,
          timeSlot: 1,
        },
        {
          unique: true,
          partialFilterExpression: {
            status: {
              $in: [
                "pending",
                "confirmed",
                "Pending",
                "Confirmed",
              ],
            },
          },
          name: "unique_active_appointment_slot",
        }
      );
  }

  return appointmentSlotIndexPromise;
};

// Validate MongoDB ObjectId
const isValidId = (id) => {
  return (
    typeof id === "string" &&
    /^[a-fA-F0-9]{24}$/.test(id)
  );
};

// Validate appointment date
const isValidDate = (date) => {
  if (
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date)
  ) {
    return false;
  }

  const parsedDate = new Date(`${date}T00:00:00.000Z`);

  return (
    !Number.isNaN(parsedDate.getTime()) &&
    parsedDate.toISOString().slice(0, 10) === date
  );
};

// Get current date in Bangladesh timezone
const getToday = () => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find(
    (part) => part.type === "year"
  ).value;

  const month = parts.find(
    (part) => part.type === "month"
  ).value;

  const day = parts.find(
    (part) => part.type === "day"
  ).value;

  return `${year}-${month}-${day}`;
};

// Get current time in Bangladesh timezone (24-hour format)
const getCurrentTimeInDhaka = () => {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date());
};

// Convert appointment slot to 24-hour time
const convertSlotTo24Hour = (timeSlot) => {
  const [time, period] = timeSlot.split(" ");

  let [hours, minutes] = time.split(":").map(Number);

  if (period === "PM" && hours !== 12) {
    hours += 12;
  }

  if (period === "AM" && hours === 12) {
    hours = 0;
  }

  return `${String(hours).padStart(2, "0")}:${String(
    minutes
  ).padStart(2, "0")}`;
};

// Check whether selected slot is in the past
const isPastTimeSlot = (appointmentDate, timeSlot) => {
  // Future dates are always allowed
  if (appointmentDate > getToday()) {
    return false;
  }

  // Past dates are handled separately
  if (appointmentDate < getToday()) {
    return true;
  }

  const selectedTime = convertSlotTo24Hour(timeSlot);
  const currentTime = getCurrentTimeInDhaka();

  return selectedTime <= currentTime;
};

// Check whether a service is active
const isServiceActive = (service) => {
  const activeValue =
    service.isActive !== undefined
      ? service.isActive
      : service.status;

  return (
    activeValue === true ||
    String(activeValue).toLowerCase() === "active"
  );
};

// 1. Create appointment (Customer Only)
router.post("/", verifyToken, verifyCustomer, async (req, res) => {
  try {
    const {
      serviceId,
      appointmentDate,
      timeSlot,
      message = "",
    } = req.body;

    // Validate service ID
    if (!isValidId(serviceId)) {
      return res.status(400).json({
        message: "Invalid service ID",
      });
    }

    // Validate appointment date
    if (!isValidDate(appointmentDate)) {
      return res.status(400).json({
        message: "Please provide a valid appointment date",
      });
    }

    // Prevent booking past dates
    if (appointmentDate < getToday()) {
      return res.status(400).json({
        message: "Appointment date cannot be in the past",
      });
    }

    // Validate time slot
    if (!AVAILABLE_TIME_SLOTS.includes(timeSlot)) {
      return res.status(400).json({
        message: "Please select a valid appointment time slot",
        availableTimeSlots: AVAILABLE_TIME_SLOTS,
      });
    }

    // Prevent booking past time slots today
    if (isPastTimeSlot(appointmentDate, timeSlot)) {
      return res.status(400).json({
        message: "This appointment time slot has already passed",
      });
    }

    // Validate optional message
    if (
      typeof message !== "string" ||
      message.length > 500
    ) {
      return res.status(400).json({
        message: "Message must be 500 characters or less",
      });
    }

    // Find service
    const service = await servicesCollection.findOne({
      _id: new ObjectId(serviceId),
    });

    if (!service) {
      return res.status(404).json({
        message: "Service not found",
      });
    }

    // Prevent booking inactive service
    if (!isServiceActive(service)) {
      return res.status(400).json({
        message: "This service is currently unavailable",
      });
    }

    const servicePrice = Number(service.price);

    if (
      !Number.isFinite(servicePrice) ||
      servicePrice <= 0
    ) {
      return res.status(400).json({
        message: "Invalid service price",
      });
    }

    // Ensure unique booking index exists
    await ensureAppointmentSlotIndex();

    // Check existing active appointment
    const existingAppointment =
      await appointmentsCollection.findOne({
        appointmentDate,
        timeSlot,
        status: {
          $in: [
            "pending",
            "confirmed",
            "Pending",
            "Confirmed",
          ],
        },
      });

    if (existingAppointment) {
      return res.status(409).json({
        message: "This appointment time slot is already booked",
      });
    }

    // Create appointment
    const newAppointment = {
      serviceId: service._id,
      serviceName: service.serviceName || service.name,
      serviceImage: service.image || "",
      category: service.category,

      customerId: new ObjectId(req.user.id),
      customerName: req.user.name,
      customerEmail: req.user.email,

      appointmentDate,
      timeSlot,
      message: message.trim(),

      servicePrice,

      status: "pending",
      paymentStatus: "unpaid",

      createdAt: new Date(),
    };

    const result = await appointmentsCollection.insertOne(
      newAppointment
    );

    res.status(201).json({
      message: "Appointment request submitted successfully",
      insertedId: result.insertedId,
      appointment: newAppointment,
    });
  } catch (error) {
    // MongoDB duplicate key error
    if (error.code === 11000) {
      return res.status(409).json({
        message: "This appointment time slot is already booked",
      });
    }

    console.error("Create appointment error:", error);

    res.status(500).json({
      message: "Failed to create appointment",
    });
  }
});

// 2. Get available time slots for a date (Public)
router.get("/available-slots", async (req, res) => {
  try {
    const { date } = req.query;

    // Validate date
    if (!isValidDate(date)) {
      return res.status(400).json({
        message: "Please provide a valid date (YYYY-MM-DD)",
      });
    }

    // Find booked appointments for the selected date
    const bookedAppointments =
      await appointmentsCollection
        .find({
          appointmentDate: date,
          status: {
            $in: [
              "pending",
              "confirmed",
              "Pending",
              "Confirmed",
            ],
          },
        })
        .project({
          _id: 0,
          timeSlot: 1,
        })
        .toArray();

    // Extract booked slots
    const bookedTimeSlots = [
      ...new Set(
        bookedAppointments.map(
          (appointment) => appointment.timeSlot
        )
      ),
    ];

    // Filter available slots
    const availableTimeSlots =
      AVAILABLE_TIME_SLOTS.filter((slot) => {
        // Remove already booked slots
        if (bookedTimeSlots.includes(slot)) {
          return false;
        }

        // Remove past slots for today
        if (isPastTimeSlot(date, slot)) {
          return false;
        }

        return true;
      });

    res.status(200).json({
      date,
      availableTimeSlots,
      bookedTimeSlots,
      allTimeSlots: AVAILABLE_TIME_SLOTS,
    });
  } catch (error) {
    console.error("Get available slots error:", error);

    res.status(500).json({
      message: "Failed to retrieve available time slots",
    });
  }
});

// 3. Get logged-in customer's appointments
router.get("/my", verifyToken, verifyCustomer, async (req, res) => {
  try {
    const appointments = await appointmentsCollection
      .find({
        customerId: new ObjectId(req.user.id),
      })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json(appointments);
  } catch (error) {
    console.error("Get customer appointments error:", error);

    res.status(500).json({
      message: "Failed to retrieve appointments",
    });
  }
});

// 4. Get all appointments (Admin Only)
router.get("/", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const appointments = await appointmentsCollection
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json(appointments);
  } catch (error) {
    console.error("Get all appointments error:", error);

    res.status(500).json({
      message: "Failed to retrieve appointments",
    });
  }
});

// 5. Get appointment details
// Admin can view all; Customer can view only their own
router.get("/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({
        message: "Invalid appointment ID",
      });
    }

    const appointment = await appointmentsCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!appointment) {
      return res.status(404).json({
        message: "Appointment not found",
      });
    }

    if (req.user.role === "customer") {
      if (String(appointment.customerId) !== req.user.id) {
        return res.status(403).json({
          message: "You cannot access this appointment",
        });
      }
    } else if (req.user.role !== "admin") {
      return res.status(403).json({
        message: "Access denied",
      });
    }

    res.status(200).json(appointment);
  } catch (error) {
    console.error("Get appointment details error:", error);

    res.status(500).json({
      message: "Failed to retrieve appointment details",
    });
  }
});

// 6. Cancel own appointment (Customer Only)
router.patch(
  "/:id/cancel",
  verifyToken,
  verifyCustomer,
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!isValidId(id)) {
        return res.status(400).json({
          message: "Invalid appointment ID",
        });
      }

      const customerId = new ObjectId(req.user.id);

      const appointment = await appointmentsCollection.findOne({
        _id: new ObjectId(id),
        customerId,
      });

      if (!appointment) {
        return res.status(404).json({
          message: "Appointment not found",
        });
      }

      if (
        String(appointment.status).toLowerCase() !== "pending"
      ) {
        return res.status(400).json({
          message: "Only pending appointments can be cancelled",
        });
      }

      // Prevent cancelling paid appointments without refund
      if (
        String(appointment.paymentStatus).toLowerCase() === "paid"
      ) {
        return res.status(400).json({
          message: "This appointment has already been paid. Refund is required before cancellation.",
        });
      }

      const result = await appointmentsCollection.updateOne(
        {
          _id: appointment._id,
          customerId,
          status: appointment.status,
          paymentStatus: {
            $ne: "paid",
          },
        },
        {
          $set: {
            status: "cancelled",
            updatedAt: new Date(),
          },
        }
      );

      if (result.modifiedCount === 0) {
        return res.status(409).json({
          message: "Appointment status has already changed or payment has been completed",
        });
      }

      res.status(200).json({
        message: "Appointment cancelled successfully",
      });
    } catch (error) {
      console.error("Cancel appointment error:", error);

      res.status(500).json({
        message: "Failed to cancel appointment",
      });
    }
  }
);

// 7. Update appointment status (Admin Only)
router.patch(
  "/:id/status",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;

      const requestedStatus = String(
        req.body.status || ""
      ).toLowerCase();

      if (!isValidId(id)) {
        return res.status(400).json({
          message: "Invalid appointment ID",
        });
      }

      if (
        !["confirmed", "cancelled"].includes(requestedStatus)
      ) {
        return res.status(400).json({
          message: "Status must be confirmed or cancelled",
        });
      }

      const appointment = await appointmentsCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!appointment) {
        return res.status(404).json({
          message: "Appointment not found",
        });
      }

      const currentStatus = String(
        appointment.status
      ).toLowerCase();

      // Confirm only Pending appointments
      if (
        requestedStatus === "confirmed" &&
        currentStatus !== "pending"
      ) {
        return res.status(400).json({
          message: "Only pending appointments can be confirmed",
        });
      }

      // Cancel only Pending or Confirmed appointments
      if (
        requestedStatus === "cancelled" &&
        !["pending", "confirmed"].includes(currentStatus)
      ) {
        return res.status(400).json({
          message: "This appointment cannot be cancelled",
        });
      }

      // Prevent cancelling paid appointments without refund
      if (
        requestedStatus === "cancelled" &&
        String(appointment.paymentStatus).toLowerCase() === "paid"
      ) {
        return res.status(400).json({
          message: "This appointment has already been paid. Refund is required before cancellation.",
        });
      }

      const result = await appointmentsCollection.updateOne(
        {
          _id: appointment._id,
          status: appointment.status,
          paymentStatus: {
            $ne: "paid",
          },
        },
        {
          $set: {
            status: requestedStatus,
            updatedAt: new Date(),
          },
        }
      );

      if (result.modifiedCount === 0) {
        return res.status(409).json({
          message: "Appointment status has already changed or payment has been completed",
        });
      }

      res.status(200).json({
        message: `Appointment ${requestedStatus} successfully`,
      });
    } catch (error) {
      console.error("Update appointment status error:", error);

      res.status(500).json({
        message: "Failed to update appointment status",
      });
    }
  }
);

module.exports = router;
