
const express = require("express");
const { ObjectId } = require("mongodb");

const { db } = require("../auth");
const { verifyToken, verifyAdmin } = require("../middlewares/auth");

const router = express.Router();

const usersCollection = db.collection("user");

// 1. Get all users (Admin Only)
router.get("/", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const users = await usersCollection
      .find({})
      .project({
        _id: 1,
        name: 1,
        email: 1,
        image: 1,
        phoneNumber: 1,
        role: 1,
        isBlocked: 1,
        createdAt: 1,
      })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json(users);
  } catch (error) {
    console.error("Get users error:", error);

    res.status(500).json({
      message: "Failed to retrieve users",
    });
  }
});

// 2. Block user (Admin Only)
router.patch("/:id/block", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "Invalid user ID",
      });
    }

    const user = await usersCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    // Prevent blocking Admin accounts
    if (user.role === "admin") {
      return res.status(403).json({
        message: "Admin accounts cannot be blocked",
      });
    }

    if (user.isBlocked === true) {
      return res.status(400).json({
        message: "User is already blocked",
      });
    }

    const result = await usersCollection.updateOne(
      {
        _id: new ObjectId(id),
        role: { $ne: "admin" },
        isBlocked: { $ne: true },
      },
      {
        $set: {
          isBlocked: true,
          updatedAt: new Date(),
        },
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(409).json({
        message: "User status has already changed",
      });
    }

    res.status(200).json({
      message: "User blocked successfully",
    });
  } catch (error) {
    console.error("Block user error:", error);

    res.status(500).json({
      message: "Failed to block user",
    });
  }
});

// 3. Unblock user (Admin Only)
router.patch("/:id/unblock", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "Invalid user ID",
      });
    }

    const user = await usersCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (user.role === "admin") {
      return res.status(403).json({
        message: "Admin accounts cannot be modified",
      });
    }

    if (user.isBlocked !== true) {
      return res.status(400).json({
        message: "User is not blocked",
      });
    }

    const result = await usersCollection.updateOne(
      {
        _id: new ObjectId(id),
        role: { $ne: "admin" },
        isBlocked: true,
      },
      {
        $set: {
          isBlocked: false,
          updatedAt: new Date(),
        },
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(409).json({
        message: "User status has already changed",
      });
    }

    res.status(200).json({
      message: "User unblocked successfully",
    });
  } catch (error) {
    console.error("Unblock user error:", error);

    res.status(500).json({
      message: "Failed to unblock user",
    });
  }
});

module.exports = router;
