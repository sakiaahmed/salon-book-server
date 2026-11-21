
# SalonBook Server

Backend API for SalonBook, a full-stack salon appointment booking and management platform.

## Technologies Used

- Node.js
- Express.js
- MongoDB
- Better Auth
- JWT
- Stripe
- dotenv
- CORS

## Features

### Authentication and Authorization
- User authentication using Better Auth
- Email and password authentication
- Google authentication
- JWT-based API authentication
- Customer and admin role-based authorization
- Protected API routes
- Blocked user access prevention

### Service Management
- Get all active services
- Get service details
- Create new services
- Update existing services
- Delete services
- Activate and deactivate services
- Admin-only service management

### Appointment Management
- Create appointments
- Retrieve appointments
- Retrieve customer appointments
- Retrieve appointment details
- Dynamic available time slots
- Appointment date and time validation
- Duplicate appointment prevention
- Customer appointment cancellation
- Admin appointment confirmation
- Appointment status management
- Prevent booking inactive services
- Prevent booking past dates and times

### User Management
- Retrieve registered users
- Block customers
- Unblock customers
- Prevent blocking administrator accounts
- Admin-only user management

### Profile Management
- Retrieve authenticated user profile
- Update profile name
- Update phone number
- Update profile picture
- Protected profile endpoints

### Payment Management
- Stripe Checkout integration
- Create checkout sessions
- Payment verification through Stripe webhooks
- Transaction history
- Payment status management
- Duplicate webhook event prevention
- Protected payment endpoints

## Installation

### 1. Clone the Repository

```bash
git clone YOUR_SERVER_REPOSITORY_URL
```

### 2. Navigate to the Project Directory

```bash
cd salonbook-server
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Configure Environment Variables

Create a `.env` file in the root directory.

Configure the required environment variables:

```env
MONGODB_URI=your_mongodb_connection_string
BETTER_AUTH_SECRET=your_authentication_secret
BETTER_AUTH_URL=http://localhost:5000
SERVER_URL=http://localhost:5000
CLIENT_URL=http://localhost:3000
FRONTEND_URL=http://localhost:3000
STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret
```

Replace the placeholder values with your actual configuration.

Never commit your `.env` file or expose secret credentials.

### 5. Run the Server

```bash
npm start
```

The server will run at:

http://localhost:5000

## API Endpoints

### Authentication

Authentication is handled by Better Auth.

| Method | Endpoint | Description |
|---|---|---|
| ALL | `/api/auth/*` | Better Auth authentication endpoints |

### Services

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/services` | Get available services |
| GET | `/api/services/:id` | Get service details |
| POST | `/api/services` | Create a service |
| PATCH | `/api/services/:id` | Update a service |
| DELETE | `/api/services/:id` | Delete a service |

Service creation, updating, and deletion require administrator authorization.

### Appointments

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/appointments` | Get appointments |
| GET | `/api/appointments/my` | Get customer appointments |
| GET | `/api/appointments/available-slots` | Get available appointment slots |
| GET | `/api/appointments/:id` | Get appointment details |
| POST | `/api/appointments` | Create an appointment |
| PATCH | `/api/appointments/:id` | Update appointment status |
| DELETE | `/api/appointments/:id` | Cancel an appointment |

Appointment endpoints are protected by authentication and role-based authorization where required.

### Profile

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/profile` | Get authenticated user profile |
| PATCH | `/api/profile` | Update authenticated user profile |

Users can update their name, phone number, and profile image.

### Users

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/users` | Get registered users |
| PATCH | `/api/users/:id/block` | Block a customer |
| PATCH | `/api/users/:id/unblock` | Unblock a customer |

These endpoints require administrator authorization.

Administrator accounts cannot be blocked.

### Payments

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/payments/create-checkout-session` | Create Stripe Checkout session |
| POST | `/api/payments/webhook` | Handle Stripe webhook events |
| GET | `/api/payments/transactions` | Get transaction history |

Payment and transaction endpoints are protected where required.

## Authentication and Authorization

SalonBook uses Better Auth for authentication.

- Authentication is handled through Better Auth.
- JWT tokens are used to authenticate protected API requests.
- Protected routes require a valid Bearer token.
- Customer routes restrict access to authenticated customers.
- Admin routes restrict access to administrators.
- Blocked users cannot access protected application resources.

Protected requests use the following authorization header:

```http
Authorization: Bearer YOUR_JWT_TOKEN
```

## Appointment Booking Rules

The appointment system includes the following validation and security rules:

- Customers can book active salon services.
- Appointment dates and times are validated.
- Past dates and time slots cannot be booked.
- Available appointment slots are retrieved dynamically.
- Duplicate active bookings for the same time slot are prevented.
- Customers can cancel their own eligible appointments.
- Administrators can manage appointment statuses.
- Paid appointments cannot be cancelled without appropriate refund handling.
- Cancelled appointments release their reserved time slots.

## Stripe Payment Integration

SalonBook uses Stripe Checkout for online payments.

The payment system includes:

- Checkout session creation
- Stripe payment processing
- Webhook event handling
- Webhook signature verification
- Payment status updates
- Transaction records stored in MongoDB
- Duplicate webhook event prevention
- Customer transaction history
- Admin transaction management

Stripe webhook events are handled through:

```text
POST /api/payments/webhook
```

Stripe webhook signing secret must be configured using the environment variable:

```env
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret
```

## Environment Variables

| Variable | Description |
|---|---|
| `MONGODB_URI` | MongoDB connection string |
| `BETTER_AUTH_SECRET` | Better Auth secret |
| `BETTER_AUTH_URL` | Better Auth base URL |
| `SERVER_URL` | Backend server URL |
| `CLIENT_URL` | Frontend client URL |
| `FRONTEND_URL` | Frontend application URL |
| `STRIPE_SECRET_KEY` | Stripe secret API key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |

## Security

- Environment variables are used for sensitive credentials.
- Protected API routes require authentication.
- Role-based authorization restricts administrative operations.
- Blocked users are prevented from accessing protected resources.
- Appointment ownership is verified.
- Duplicate appointment bookings are prevented.
- Past appointment dates and times are rejected.
- Stripe webhook signatures are verified.
- Payment events are processed securely.
- Administrator accounts cannot be blocked through user management.

## Project Description

SalonBook is a salon appointment booking platform designed to simplify salon service management, appointment scheduling, customer management, and online payments.

The backend provides REST API endpoints for authentication, services, appointments, users, profiles, and payments.

## Project Structure

```text
salonbook-server/
├── routes/
│   ├── appointments.js
│   ├── payments.js
│   ├── profile.js
│   ├── services.js
│   └── users.js
├── middlewares/
│   └── auth.js
├── auth.js
├── index.js
├── .env
├── package.json
└── README.md
```

## Development

Start the backend server using:

```bash
npm start
```

The frontend application communicates with this backend API to perform authentication, service management, appointment booking, profile management, user management, and payment operations.
