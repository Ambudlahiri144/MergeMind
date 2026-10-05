import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import type { TestProject } from 'vitest/node';

// Same images as docker-compose.yml so tests match local dev (Testing.md §2).
const MONGO_IMAGE = 'mongodb/mongodb-atlas-local:8.0';
const REDIS_IMAGE = 'redis:7-alpine';
const MONGO_PORT = 27017;
const REDIS_PORT = 6379;
const MONGO_STARTUP_TIMEOUT_MS = 150_000;

let containers: StartedTestContainer[] = [];

/** Starts one Mongo (atlas-local) and one Redis per test run; each test file uses its own DB. */
export async function setup(project: TestProject): Promise<void> {
  const [mongo, redis] = await Promise.all([
    new GenericContainer(MONGO_IMAGE)
      .withExposedPorts(MONGO_PORT)
      .withWaitStrategy(Wait.forHealthCheck())
      .withStartupTimeout(MONGO_STARTUP_TIMEOUT_MS)
      .start(),
    new GenericContainer(REDIS_IMAGE)
      .withExposedPorts(REDIS_PORT)
      .withCommand(['redis-server', '--maxmemory-policy', 'noeviction'])
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .start(),
  ]);
  containers = [mongo, redis];

  project.provide(
    'mongoUri',
    `mongodb://${mongo.getHost()}:${mongo.getMappedPort(MONGO_PORT)}/?directConnection=true`,
  );
  project.provide('redisUrl', `redis://${redis.getHost()}:${redis.getMappedPort(REDIS_PORT)}`);
}

export async function teardown(): Promise<void> {
  await Promise.all(containers.map((container) => container.stop()));
  containers = [];
}
