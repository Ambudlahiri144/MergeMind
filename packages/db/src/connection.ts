import mongoose from 'mongoose';

/** Fail fast at boot instead of buffering queries forever (rules.md §6: every call has a timeout). */
const SERVER_SELECTION_TIMEOUT_MS = 5_000;
const PING_TIMEOUT_MS = 2_000;

export type MongoConnectOptions = {
  dbName?: string;
};

export async function connectMongo(
  uri: string,
  options: MongoConnectOptions = {},
): Promise<typeof mongoose> {
  return mongoose.connect(uri, {
    serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS,
    autoIndex: true,
    ...(options.dbName === undefined ? {} : { dbName: options.dbName }),
  });
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}

/** Readiness probe: resolves when the server answers `ping`, rejects otherwise. */
export async function pingMongo(): Promise<void> {
  const db = mongoose.connection.db;
  if (mongoose.connection.readyState !== mongoose.ConnectionStates.connected || !db) {
    throw new Error('MongoDB is not connected');
  }
  await db.admin().command({ ping: 1 }, { timeoutMS: PING_TIMEOUT_MS });
}
