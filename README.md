
# SalonBook Server

Backend API for SalonBook, a salon appointment booking and management application.

## Technologies Used

- Node.js
- Express.js
- MongoDB
- Better Auth
- Stripe
- JSON Web Token (JWT)
- dotenv

## Features

- User authentication and authorization
- Admin and customer role management
- Service management (CRUD)
- Appointment booking
- Dynamic available time slots
- Duplicate appointment prevention
- Appointment cancellation
- Admin appointment confirmation
- Stripe payment integration
- Payment transaction history
- Protected API routes
- Profile management

## Installation

1. Clone the repository:

```bash
git clone YOUR_SERVER_REPOSITORY_URL
```

2. Navigate to the server directory:

```bash
cd salonbook-server
```

3. Install dependencies:

```bash
npm install
```

4. Create a `.env` file in the root directory.

Add the following environment variables:

```env
MONGODB_URI=your_mongodb_connection_string
BETTER_AUTH_SECRET=your_auth_secret
BETTER_AUTH_URL=http://localhost:5000
STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret
```

Replace the placeholder values with your actual credentials.

## Run the Server

Start the development server:

```bash
npm start
```

The server will run at:

```text
http://localhost:5000
```

## API Endpoints

### Authentication

Authentication is handled by Better Auth.

### Services

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/services` | Get all services |
| GET | `/api/services/:id` | Get service details |
| POST | `/api/services` | Create a service |
| PATCH | `/api/services/:id` | Update a service |
| DELETE | `/api/services/:id` | Delete a service |

### Appointments

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/appointments` | Get appointments |
| GET | `/api/appointments/my` | Get customer's appointments |
| GET | `/api/appointments/available-slots` | Get available time slots |
| GET | `/api/appointments/:id` | Get appointment details |
| POST | `/api/appointments` | Create an appointment |
| PATCH | `/api/appointments/:id` | Update appointment status |
| DELETE | `/api/appointments/:id` | Cancel an appointment |

### Payments

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/payments/create-checkout-session` | Create Stripe checkout session |
| POST | `/api/payments/webhook` | Handle Stripe webhook events |
| GET | `/api/payments/transactions` | Get transaction history |

### Users

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/users` | Get users |
| PATCH | `/api/users/:id` | Update user information |

> Some endpoints require authentication and admin/customer role authorization.

## Environment Variables

| Variable | Description |
|---|---|
| `MONGODB_URI` | MongoDB connection string |
| `BETTER_AUTH_SECRET` | Authentication secret |
| `BETTER_AUTH_URL` | Backend authentication URL |
| `STRIPE_SECRET_KEY` | Stripe secret API key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |

## Security

- Environment variables are used for sensitive credentials.
- Protected routes require authentication.
- Role-based authorization restricts admin operations.
- Duplicate appointments are prevented.
- Past appointments cannot be booked.
- Payment status is verified through Stripe webhook events.

## Project

SalonBook is a full-stack salon appointment booking application designed to simplify salon service management, customer bookings, and online payments.

## Authentication and Authorization

SalonBook uses Better Auth for user authentication.

- Authentication is handled through the Better Auth server configuration.
- Protected API routes require a valid authenticated session.
- Customer-only routes restrict access to customer accounts.
- Admin-only routes restrict access to administrator accounts.
- Environment variables are used to protect authentication secrets and configuration.

