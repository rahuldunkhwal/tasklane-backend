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

| Variable        | Example                               | Notes                                    |
| --------------- | ------------------------------------- | ---------------------------------------- |
| `NODE_ENV`      | `development`                         | `development` \| `test` \| `production`  |
| `PORT`          | `4000`                                | Defaults to 4000                         |
| `MONGODB_URI`   | `mongodb://127.0.0.1:27017/taskboard` | Required. Atlas uses `mongodb+srv://...` |
| `CLIENT_ORIGIN` | `http://localhost:5173`               | Frontend origin allowed by CORS          |

## API

| Method | Path          | Description                                               |
| ------ | ------------- | --------------------------------------------------------- |
| GET    | `/api/health` | `200 {status:"ok", db:"up"}` or `503 {status:"degraded"}` |

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
`INTERNAL_ERROR`.

## Project structure

```
src/
├─ index.ts               entry: validate env → connect DB → listen → graceful shutdown
├─ app.ts                 builds the Express app (middleware + routes), no listen()
├─ config/                env validation, database connection
├─ routes/index.ts        mounts every feature router under /api
├─ modules/<feature>/     routes (later: controllers, schemas) per feature
├─ middleware/            notFound, errorHandler (later: auth, validation)
└─ utils/AppError.ts      error with HTTP status + stable code
```
