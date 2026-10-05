import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';

import { connectMongo, disconnectMongo, pingMongo } from '../../src/connection.js';

describe('MongoDB connection', () => {
  beforeAll(async () => {
    await connectMongo(inject('mongoUri'), { dbName: `test_${randomUUID()}` });
  });

  afterAll(async () => {
    await disconnectMongo();
  });

  it('answers ping when connected', async () => {
    await expect(pingMongo()).resolves.toBeUndefined();
  });

  it('rejects ping after disconnecting', async () => {
    await disconnectMongo();

    await expect(pingMongo()).rejects.toThrow('MongoDB is not connected');

    await connectMongo(inject('mongoUri'), { dbName: `test_${randomUUID()}` });
  });
});
