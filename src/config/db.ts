import mongoose from 'mongoose';

export async function connectDb(uri: string) {
  // Give up after 5s if MongoDB is unreachable (the default is 30s, which feels like a hang)
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  console.log(`MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name}`);

  // After startup, Mongoose reconnects on its own; these logs just make outages visible
  mongoose.connection.on('disconnected', () => console.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => console.log('MongoDB reconnected'));
}

export async function disconnectDb() {
  await mongoose.disconnect();
}

export function isDbConnected() {
  return mongoose.connection.readyState === mongoose.ConnectionStates.connected;
}
