import { env } from './config/env.js';
import { connectDb, disconnectDb } from './config/db.js';
import { createApp } from './app.js';

async function main() {
  // Connect BEFORE listening: if the database is down, refuse to start
  // instead of accepting requests that would hang and then fail.
  await connectDb(env.MONGODB_URI);

  const app = createApp();
  const server = app.listen(env.PORT, (error) => {
    // Express 5 passes startup errors here, e.g. EADDRINUSE when the port is already taken
    if (error) {
      console.error(`Failed to start server: ${error.message}`);
      process.exit(1);
    }
    console.log(`API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  });

  // Graceful shutdown. SIGINT = Ctrl+C locally; SIGTERM = the host (Render, Docker) stopping us.
  const shutdown = (signal: NodeJS.Signals) => {
    console.log(`${signal} received: finishing in-flight requests, then closing...`);

    // Stop accepting new requests; the callback runs when current ones have finished
    server.close(() => {
      void disconnectDb().then(() => {
        console.log('Shutdown complete');
        process.exit(0);
      });
    });

    // Safety net: if a request hangs, don't wait forever
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

// A promise that failed with nobody handling it means the app is in an unknown state: log and exit
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
  process.exit(1);
});

main().catch((error: unknown) => {
  console.error('Failed to start:', error instanceof Error ? error.message : error);
  process.exit(1);
});
