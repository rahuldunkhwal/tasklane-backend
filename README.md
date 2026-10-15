# Task Board API (backend)

REST API for the Task Board app: Express 5, TypeScript, MongoDB (Mongoose).

> The frontend lives in a separate repository. This README grows with each phase.

## Prerequisites

- Node.js **22.22+** (see `.nvmrc`)
- Docker Desktop (runs the local MongoDB)

## Quick start

```bash
npm install
cp .env.example .env      # Windows PowerShell: Copy-Item .env.example .env
npm run db:up             # start MongoDB 8 in Docker
npm run dev               # API on http://localhost:4000
```

Check it works:

```bash
curl http://localhost:4000/api/health
# {"status":"ok","db":"up","uptimeSeconds":3}
```

## Scripts

| Script              | What it does                                 |
| ------------------- | -------------------------------------------- |
| `npm run dev`       | Start in watch mode (restarts on save)       |
| `npm run build`     | Compile TypeScript from `src/` to `dist/`    |
| `npm start`         | Run the compiled build (production)          |
| `npm run typecheck` | Type-check without emitting files            |
| `npm run lint`      | ESLint                                       |
| `npm run format`    | Format all files with Prettier               |
| `npm run db:up`     | Start the MongoDB container                  |
| `npm run db:down`   | Stop and remove the container (data is kept) |
| `npm run db:logs`   | Follow MongoDB logs                          |

## Environment variables

Validated at startup by `src/config/env.ts`: the server refuses to start if any value is missing or invalid.

| Variable         | Example                               | Notes                                                                                        |
| ---------------- | ------------------------------------- | -------------------------------------------------------------------------------------------- |
| `NODE_ENV`       | `development`                         | `development` \| `test` \| `production`                                                      |
| `PORT`           | `4000`                                | Defaults to 4000                                                                             |
| `MONGODB_URI`    | `mongodb://127.0.0.1:27017/taskboard` | Required. Atlas uses `mongodb+srv://...`                                                     |
| `CLIENT_ORIGIN`  | `http://localhost:5173`               | Frontend origin allowed by CORS                                                              |
| `JWT_SECRET`     | 96 random hex characters              | Required, min 32 chars. Signs login JWTs                                                     |
| `RESEND_API_KEY` | `re_...`                              | Optional in development (emails are printed in the terminal instead). Required in production |
| `MAIL_FROM`      | `Task Board <onboarding@resend.dev>`  | Sender address. Without a verified domain, Resend only delivers to your own account email    |

## API

| Method | Path                        | Description                                                                                                               |
| ------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/health`               | `200 {status:"ok", db:"up"}` or `503 {status:"degraded"}`                                                                 |
| POST   | `/api/auth/signup`          | Body `{name, email, password}` → `201 {user}` + auth cookie. `409 EMAIL_TAKEN`                                            |
| POST   | `/api/auth/login`           | Body `{email, password}` → `200 {user}` + auth cookie. `401 INVALID_CREDENTIALS`                                          |
| GET    | `/api/auth/me`              | Requires login → `200 {user}`. `401 UNAUTHORIZED`                                                                         |
| POST   | `/api/auth/logout`          | Ends the session and clears the cookie → `204` (also when already logged out)                                             |
| POST   | `/api/auth/forgot-password` | Body `{email}` → always `200 {message}` (same answer whether or not the account exists); emails a reset link valid 15 min |
| POST   | `/api/auth/reset-password`  | Body `{token, password}` → `200 {message}`, logs out all devices. `400 INVALID_RESET_TOKEN`                               |

**Authentication:** a JWT in an `httpOnly`, `SameSite=Lax` cookie named `token` (7 days, `Secure` in production).
The JWT holds the user id and a session id. Each login creates a document in the `sessions` collection; logout
deletes it, so a token stops working immediately. A TTL index removes expired sessions automatically.

**Password rules:** 8–72 characters, at least one letter and one number.

**Password reset:** the emailed link points to the frontend (`CLIENT_ORIGIN/reset-password?token=...`). Only a
SHA-256 hash of the token is stored; it expires after 15 minutes, works once, and a newer request replaces it.

### Error format

Every error has the same shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request data",
    "details": [{ "path": "email", "message": "Invalid email address" }]
  }
}
```

`details` is only present for validation errors. Codes so far: `NOT_FOUND`, `VALIDATION_ERROR`,
`INVALID_ID`, `INVALID_JSON`, `INVALID_BODY`, `PAYLOAD_TOO_LARGE`, `CONFLICT`, `EMAIL_TAKEN`,
`INVALID_CREDENTIALS`, `UNAUTHORIZED`, `INVALID_RESET_TOKEN`, `INTERNAL_ERROR`.

## Project structure

```
src/
├─ index.ts               entry: validate env → connect DB → listen → graceful shutdown
├─ app.ts                 builds the Express app (middleware + routes), no listen()
├─ config/                env validation, database connection
├─ routes/index.ts        mounts every feature router under /api
├─ modules/<feature>/     one folder per feature (health, auth, users, ...)
├─ middleware/            notFound, errorHandler, validate, requireAuth
├─ types/express.d.ts     adds req.user / req.sessionId to Express's Request type
└─ utils/                 AppError (HTTP status + stable code), password (bcrypt), email (Resend)

modules/<feature>/
├─ <feature>.routes.ts      URL → middleware → controller
├─ <feature>.controller.ts  HTTP only: read req, call service, send res
├─ <feature>.service.ts     business logic, throws AppError, never touches req/res
├─ <feature>.schema.ts      zod input rules
└─ <entity>.model.ts        Mongoose schema
```
