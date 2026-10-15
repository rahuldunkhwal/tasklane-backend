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

### Boards (all require login)

| Method | Path              | Description                                             |
| ------ | ----------------- | ------------------------------------------------------- |
| GET    | `/api/boards`     | `200 {boards}`: the current user's boards, oldest first |
| POST   | `/api/boards`     | Body `{title}` (1–100 chars) → `201 {board}`            |
| GET    | `/api/boards/:id` | `200 {board}`. `404 BOARD_NOT_FOUND`, `400 INVALID_ID`  |
| PATCH  | `/api/boards/:id` | Body `{title}` → `200 {board}` (rename)                 |
| DELETE | `/api/boards/:id` | `204`                                                   |

A board is `{id, title, role, ownerName?, createdAt, updatedAt}`. `role` is `owner` or `viewer`; `ownerName` is only
present on boards shared with the user. `GET /api/boards` returns the user's own boards first, then boards shared
with them. Deleting a board also deletes its tasks (and its shares).

### Sharing (view-only, by email)

| Method | Path                             | Description                                                                                                           |
| ------ | -------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/boards/:id/shares`         | Owner only → `200 {shares: [{userId, name, email}]}`                                                                  |
| POST   | `/api/boards/:id/shares`         | Owner only. Body `{email}` → `201 {shares}`. `404 USER_NOT_FOUND`, `409 ALREADY_SHARED`, `400 CANNOT_SHARE_WITH_SELF` |
| DELETE | `/api/boards/:id/shares/:userId` | Owner only → `204`. `404 SHARE_NOT_FOUND`                                                                             |

**Access rules** (one place: `getVisibleBoard` / `getOwnBoard` in `boards.service.ts`):

| Who                  | Sees the board and its tasks   | Any change (board, tasks, moves, shares) |
| -------------------- | ------------------------------ | ---------------------------------------- |
| Owner                | yes                            | yes                                      |
| Viewer (shared with) | yes (also in search/filters)   | `403 READ_ONLY`                          |
| Anyone else          | `404` (existence not revealed) | `404`                                    |

The dashboard (`/api/tasks/stats`) counts only the user's own boards.

### Tasks (all require login)

| Method | Path                  | Description                                                                                                   |
| ------ | --------------------- | ------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/tasks`          | `200 {tasks}`: every task in the user's boards (one request), by board then `order`                           |
| POST   | `/api/tasks`          | Body `{boardId, title, description?, priority?, dueDate?}` → `201 {task}` (added last)                        |
| PATCH  | `/api/tasks/:id`      | Any of `{title, description, priority, dueDate, completed}` → `200 {task}`                                    |
| DELETE | `/api/tasks/:id`      | `204`                                                                                                         |
| PATCH  | `/api/tasks/:id/move` | Body `{boardId, index}` → `200 {task}`: drag & drop to position `index` (0 = top) of any of the user's boards |

A task is `{id, boardId, title, description, priority, dueDate, completed, order, createdAt, updatedAt}`.

**Dashboard:** `GET /api/tasks/stats` → `200 {total, completed, overdue}` for the user's **own** boards (boards shared
with them don't count: that's someone else's work). Computed by one MongoDB aggregation (`$match` → `$group` with
`$sum`/`$cond`). Overdue = not completed **and** `dueDate` is a date **and** `dueDate < now` (MongoDB sorts `null`
below every date, so tasks without a due date are excluded explicitly).

- `priority`: `low` | `medium` | `high` (default `medium`). Title 1–200 chars, description up to 2000.
- `dueDate`: an ISO date-time or `null`. The frontend sends the **end of the chosen day in the user's time zone**, so
  a task is overdue when `!completed && dueDate < now`. Past dates are accepted.
- **Search & filters** on `GET /api/tasks` (all optional, combined with AND, always limited to the user's boards):

  | Query param        | Meaning                                                                    |
  | ------------------ | -------------------------------------------------------------------------- |
  | `search=milk`      | title contains the text, case-insensitive (special characters are escaped) |
  | `priority=high`    | `low` \| `medium` \| `high`                                                |
  | `dueFrom`, `dueTo` | ISO date-times: due between these moments (inclusive)                      |
  | `noDueDate=true`   | only tasks without a due date                                              |
  | `completed=false`  | `true` \| `false`                                                          |

  The client sends exact moments, e.g. overdue = `completed=false&dueTo=<now>`, due today = `dueFrom=<start of
today>&dueTo=<end of today>` in the user's time zone, so the server never needs the user's time zone.

- `order`: position in the board; new tasks get `last + 1000`, leaving gaps for drag & drop.
- **Moving** (`/move`): the client sends only the target board and position; the server computes the order from the
  neighbours in the database (between two tasks → their midpoint, top → first − 1000, bottom → last + 1000, empty
  board → 1000). Only the moved task is written. If two neighbours are too close to fit a task between them, that
  board is renumbered (1000, 2000, …) in one `bulkWrite` first.
- Tasks have no owner field: a task belongs to the owner of its board. Another user's task → `404 TASK_NOT_FOUND`,
  another user's board → `404 BOARD_NOT_FOUND`.

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
`INVALID_CREDENTIALS`, `UNAUTHORIZED`, `INVALID_RESET_TOKEN`, `BOARD_NOT_FOUND`, `TASK_NOT_FOUND`, `READ_ONLY`,
`USER_NOT_FOUND`, `ALREADY_SHARED`, `CANNOT_SHARE_WITH_SELF`, `SHARE_NOT_FOUND`, `INTERNAL_ERROR`.

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
