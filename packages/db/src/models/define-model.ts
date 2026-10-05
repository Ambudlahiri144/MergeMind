import mongoose, { type Model, type Schema } from 'mongoose';

/** Reuses an already-compiled model so re-imports (watch mode, tests) never throw OverwriteModelError. */
export function defineModel<T>(name: string, schema: Schema<T>): Model<T> {
  const existing = mongoose.models[name] as Model<T> | undefined;
  return existing ?? mongoose.model<T>(name, schema);
}

const DUPLICATE_KEY_CODE = 11_000;

export function isDuplicateKeyError(error: unknown): boolean {
  return error instanceof mongoose.mongo.MongoServerError && error.code === DUPLICATE_KEY_CODE;
}
