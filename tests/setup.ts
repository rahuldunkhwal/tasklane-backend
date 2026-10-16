import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, beforeEach, vi } from 'vitest';

// Never send real email from tests. Mocking the sender also lets a test read the email that WOULD
// have gone out (to grab a reset or invite link) — see sentEmails() in tests/helpers.ts.
vi.mock('../src/utils/email.js', () => ({ sendEmail: vi.fn(async () => undefined) }));

// src/config/env.ts validates process.env the moment it is imported, so everything the app needs
// must be in place BEFORE any src module loads. That is why src is imported dynamically below.
const mongod = await MongoMemoryServer.create();
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = mongod.getUri('tasklane-test');
process.env.JWT_SECRET = 'test-only-secret-that-is-at-least-32-characters';
process.env.SENDGRID_API_KEY = ''; // belt and braces: email.ts also refuses to send without a key
process.env.CLIENT_ORIGIN = 'http://localhost:5173';

const { connectDb, disconnectDb } = await import('../src/config/db.js');
await connectDb(process.env.MONGODB_URI);

// Load the app once so every model registers, then wait for their indexes to be built. Without
// this, a "duplicate email" test could pass or fail depending on whether the unique index exists yet.
await import('../src/app.js');
await Promise.all(Object.values(mongoose.models).map((model) => model.init()));

beforeEach(async () => {
  // A clean database for every test (deleteMany keeps the indexes; dropDatabase would not)
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB is not connected');
  const collections = await db.collections();
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
  vi.clearAllMocks(); // each test sees only the emails it sent
});

afterAll(async () => {
  await disconnectDb();
  await mongod.stop();
});
