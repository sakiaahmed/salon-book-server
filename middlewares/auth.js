
require("dotenv").config();

const { jwtVerify, createRemoteJWKSet } = require("jose");
const { ObjectId } = require("mongodb");
const { db } = require("../auth");

const SERVER_URL = (
  process.env.SERVER_URL || "http://localhost:5000"
).replace(/\/+$/, "");

const JWKS = createRemoteJWKSet(
  new URL(`${SERVER_URL}/api/auth/jwks`)
);

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      message: "Unauthorized: No token provided",
    });
  }

  const token = authHeader.split(" ")[1];

  let payload;

  try {
    const result = await jwtVerify(token, JWKS, {
      issuer: SERVER_URL,
      audience: SERVER_URL,
    });

    payload = result.payload;
  } catch (error) {
    console.error("JWT verification failed:", error.message);

    return res.status(401).json({
      message: "Unauthorized: Invalid or expired token",
    });
  }

  try {
    const userId = payload.sub || payload.id;

    if (!userId || !ObjectId.isValid(userId)) {
      return res.status(401).json({
        message: "Unauthorized: Invalid user ID",
      });
    }

    const currentUser = await db.collection("user").findOne({
      _id: new ObjectId(userId),
    });

    if (!currentUser) {
      return res.status(401).json({
        message: "Unauthorized: User not found",
      });
    }

    if (currentUser.isBlocked === true) {
      return res.status(403).json({
        message: "Your account has been blocked",
      });
    }

    req.user = {
      id: currentUser._id.toString(),
      email: currentUser.email,
      name: currentUser.name,
      image: currentUser.image || "",
      phoneNumber: currentUser.phoneNumber || "",
      role: currentUser.role || "customer",
      isBlocked: currentUser.isBlocked === true,
    };

    next();
  } catch (error) {
    console.error("User verification failed:", error.message);

    return res.status(500).json({
      message: "Internal server error during authentication",
    });
  }
};

const verifyRole = (roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        message: "Forbidden: Access denied",
      });
    }

    next();
  };
};

const verifyAdmin = verifyRole(["admin"]);
const verifyCustomer = verifyRole(["customer"]);

module.exports = {
  verifyToken,
  verifyAdmin,
  verifyCustomer,
};
