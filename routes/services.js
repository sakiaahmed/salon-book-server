
const express = require("express");
const { ObjectId } = require("mongodb");
const { db } = require("../auth");
const {
  verifyToken,
  verifyAdmin,
} = require("../middlewares/auth");

const router = express.Router();

const servicesCollection = db.collection("services");

// Validate MongoDB ObjectId
const isValidId = (id) => {
  return typeof id === "string" && /^[a-fA-F0-9]{24}$/.test(id);
};

// Normalize service status
const normalizeStatus = (status) => {
  const value = String(status).toLowerCase();

  if (value === "active") return "Active";
  if (value === "inactive") return "Inactive";

  return null;
};

// 1. Get all active services (Public)
// Supports search, category filter and price sorting
router.get("/", async (req, res) => {
  try {
    const { search, category, sort } = req.query;

    const query = {
      status: { $in: ["Active", "active"] },
    };

    if (search) {
      const safeSearch = String(search).replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );

      query.$or = [
        { serviceName: { $regex: safeSearch, $options: "i" } },
        { name: { $regex: safeSearch, $options: "i" } },
      ];
    }

    if (category) {
      query.category = {
        $regex: `^${String(category).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        $options: "i",
      };
    }

    let sortOption = { createdAt: -1 };

    if (sort === "price-asc") {
      sortOption = { price: 1 };
    } else if (sort === "price-desc") {
      sortOption = { price: -1 };
    }

    const services = await servicesCollection
      .find(query)
      .sort(sortOption)
      .toArray();

    res.status(200).json(services);
  } catch (error) {
    console.error("Get services error:", error);

    res.status(500).json({
      message: "Failed to retrieve services",
    });
  }
});

// 2. Get all services including inactive (Admin Only)
router.get("/admin/all", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const services = await servicesCollection
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json(services);
  } catch (error) {
    console.error("Admin get services error:", error);

    res.status(500).json({
      message: "Failed to retrieve services",
    });
  }
});

// 3. Get single service details (Authenticated Users)
router.get("/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({
        message: "Invalid service ID",
      });
    }

    const service = await servicesCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!service) {
      return res.status(404).json({
        message: "Service not found",
      });
    }

    // Customers cannot access inactive services
    if (
      req.user.role === "customer" &&
      !["Active", "active"].includes(service.status)
    ) {
      return res.status(404).json({
        message: "Service is not available",
      });
    }

    res.status(200).json(service);
  } catch (error) {
    console.error("Get service details error:", error);

    res.status(500).json({
      message: "Failed to retrieve service details",
    });
  }
});

// 4. Create service (Admin Only)
router.post("/", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const {
      serviceName,
      name,
      category,
      description,
      price,
      duration,
      estimatedDuration,
      image,
      imageUrl,
      status,
    } = req.body;

    const finalName = String(serviceName || name || "").trim();
    const finalCategory = String(category || "").trim();
    const finalDescription = String(description || "").trim();
    const finalImage = String(image || imageUrl || "").trim();

    const finalPrice = Number(price);
    const finalDuration = Number(duration ?? estimatedDuration);

    const finalStatus = normalizeStatus(status || "Active");

    if (
      !finalName ||
      !finalCategory ||
      !finalDescription ||
      !finalImage
    ) {
      return res.status(400).json({
        message: "All service fields are required",
      });
    }

    if (!Number.isFinite(finalPrice) || finalPrice <= 0) {
      return res.status(400).json({
        message: "Price must be a positive number",
      });
    }

    if (!Number.isFinite(finalDuration) || finalDuration <= 0) {
      return res.status(400).json({
        message: "Duration must be a positive number",
      });
    }

    if (!finalStatus) {
      return res.status(400).json({
        message: "Status must be Active or Inactive",
      });
    }

    const newService = {
      serviceName: finalName,
      category: finalCategory,
      description: finalDescription,
      price: finalPrice,
      duration: finalDuration,
      image: finalImage,
      status: finalStatus,
      createdAt: new Date(),
    };

    const result = await servicesCollection.insertOne(newService);

    res.status(201).json({
      message: "Service created successfully",
      insertedId: result.insertedId,
    });
  } catch (error) {
    console.error("Create service error:", error);

    res.status(500).json({
      message: "Failed to create service",
    });
  }
});

// 5. Update service (Admin Only)
router.patch("/:id", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({
        message: "Invalid service ID",
      });
    }

    const updateData = {};
    const body = req.body;

    // Service name
    if ("serviceName" in body || "name" in body) {
      const serviceName = String(
        body.serviceName ?? body.name ?? ""
      ).trim();

      if (!serviceName) {
        return res.status(400).json({
          message: "Service name cannot be empty",
        });
      }

      updateData.serviceName = serviceName;
    }

    // Category
    if ("category" in body) {
      const category = String(body.category).trim();

      if (!category) {
        return res.status(400).json({
          message: "Category cannot be empty",
        });
      }

      updateData.category = category;
    }

    // Description
    if ("description" in body) {
      const description = String(body.description).trim();

      if (!description) {
        return res.status(400).json({
          message: "Description cannot be empty",
        });
      }

      updateData.description = description;
    }

    // Price
    if ("price" in body) {
      const price = Number(body.price);

      if (!Number.isFinite(price) || price <= 0) {
        return res.status(400).json({
          message: "Price must be a positive number",
        });
      }

      updateData.price = price;
    }

    // Duration
    if ("duration" in body || "estimatedDuration" in body) {
      const duration = Number(
        body.duration ?? body.estimatedDuration
      );

      if (!Number.isFinite(duration) || duration <= 0) {
        return res.status(400).json({
          message: "Duration must be a positive number",
        });
      }

      updateData.duration = duration;
    }

    // Image
    if ("image" in body || "imageUrl" in body) {
      const image = String(
        body.image ?? body.imageUrl ?? ""
      ).trim();

      if (!image) {
        return res.status(400).json({
          message: "Service image cannot be empty",
        });
      }

      updateData.image = image;
    }

    // Status
    if ("status" in body) {
      const status = normalizeStatus(body.status);

      if (!status) {
        return res.status(400).json({
          message: "Status must be Active or Inactive",
        });
      }

      updateData.status = status;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        message: "No valid update fields provided",
      });
    }

    updateData.updatedAt = new Date();

    const result = await servicesCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        message: "Service not found",
      });
    }

    res.status(200).json({
      message: "Service updated successfully",
    });
  } catch (error) {
    console.error("Update service error:", error);

    res.status(500).json({
      message: "Failed to update service",
    });
  }
});

// 6. Delete service (Admin Only)
router.delete("/:id", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({
        message: "Invalid service ID",
      });
    }

    const result = await servicesCollection.deleteOne({
      _id: new ObjectId(id),
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        message: "Service not found",
      });
    }

    res.status(200).json({
      message: "Service deleted successfully",
    });
  } catch (error) {
    console.error("Delete service error:", error);

    res.status(500).json({
      message: "Failed to delete service",
    });
  }
});

module.exports = router;
