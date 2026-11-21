
require("dotenv").config();

const express = require("express");
const { ObjectId } = require("mongodb");
const { db } = require("../auth");
const { verifyToken } = require("../middlewares/auth");

const router = express.Router();

// Get logged-in user's profile
router.get("/", verifyToken, async (req, res) => {
  try {
    const user = await db.collection("user").findOne(
      { _id: new ObjectId(req.user.id) },
      {
        projection: {
          name: 1,
          email: 1,
          image: 1,
          phoneNumber: 1,
          role: 1,
          isBlocked: 1,
        },
      }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User profile not found",
      });
    }

    return res.status(200).json({
      success: true,
      profile: {
        id: user._id.toString(),
        name: user.name || "",
        email: user.email || "",
        image: user.image || "",
        phoneNumber: user.phoneNumber || "",
        role: user.role || "customer",
        isBlocked: user.isBlocked === true,
      },
    });
  } catch (error) {
    console.error("Get profile error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch profile",
    });
  }
});

// Update logged-in user's profile
router.patch("/", verifyToken, async (req, res) => {
  try {
    const { name, image, phoneNumber } = req.body;

    const updateData = {};

    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        return res.status(400).json({
          success: false,
          message: "Name is required",
        });
      }

      updateData.name = name.trim();
    }

    if (image !== undefined) {
      if (typeof image !== "string") {
        return res.status(400).json({
          success: false,
          message: "Invalid profile image",
        });
      }

      updateData.image = image.trim();
    }

    if (phoneNumber !== undefined) {
      if (typeof phoneNumber !== "string") {
        return res.status(400).json({
          success: false,
          message: "Invalid phone number",
        });
      }

      updateData.phoneNumber = phoneNumber.trim();
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No profile information provided",
      });
    }

    updateData.updatedAt = new Date();

    await db.collection("user").updateOne(
      { _id: new ObjectId(req.user.id) },
      { $set: updateData }
    );

    const updatedUser = await db.collection("user").findOne(
      { _id: new ObjectId(req.user.id) },
      {
        projection: {
          name: 1,
          email: 1,
          image: 1,
          phoneNumber: 1,
          role: 1,
          isBlocked: 1,
        },
      }
    );

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      profile: {
        id: updatedUser._id.toString(),
        name: updatedUser.name || "",
        email: updatedUser.email || "",
        image: updatedUser.image || "",
        phoneNumber: updatedUser.phoneNumber || "",
        role: updatedUser.role || "customer",
        isBlocked: updatedUser.isBlocked === true,
      },
    });
  } catch (error) {
    console.error("Update profile error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update profile",
    });
  }
});

module.exports = router;
