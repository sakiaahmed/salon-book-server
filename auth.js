require("dotenv").config();

const { betterAuth } = require("better-auth");
const { mongodbAdapter } = require("better-auth/adapters/mongodb");
const { jwt } = require("better-auth/plugins");
const { MongoClient } = require("mongodb");

const client = new MongoClient(process.env.MONGODB_URI);
const db = client.db("salonbook");

const serverURL = process.env.SERVER_URL || "http://localhost:5000";

const auth = betterAuth({
  database: mongodbAdapter(db),

  baseURL: serverURL,

  trustedOrigins: [
    "http://localhost:3000",
    "https://salonbook-client-omega.vercel.app",
    process.env.CLIENT_URL,
  ].filter(Boolean),

  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 6,
  },

  user: {
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "customer",
        input: false,
      },

      isBlocked: {
        type: "boolean",
        defaultValue: false,
        input: false,
      },
    },
  },

  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          return {
            data: {
              ...user,
              role: "customer",
              isBlocked: false,
            },
          };
        },
      },
    },
  },

  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    },
  },

  plugins: [
    jwt({
      jwt: {
        expirationTime: "7d",
      },
    }),
  ],
});

module.exports = { auth, db, client };