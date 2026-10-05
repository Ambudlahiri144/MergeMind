import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createLogger } from './logger.js';

function captureLogger() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  const logger = createLogger({ name: 'test', level: 'info' }, destination);
  return { logger, lines };
}

describe('createLogger', () => {
  it('redacts secrets and auth headers', () => {
    const { logger, lines } = captureLogger();

    logger.info(
      {
        req: { headers: { authorization: 'Bearer abc', cookie: 'session=1' } },
        github: { privateKey: 'PEM', token: 'ghs_123' },
        groq: { apiKey: 'gsk_123' },
      },
      'request.received',
    );

    const line = lines.join('');
    expect(line).not.toMatch(/Bearer abc|session=1|PEM|ghs_123|gsk_123/);
    expect(line).toContain('[redacted]');
  });

  it('writes structured JSON with a string level and the event name', () => {
    const { logger, lines } = captureLogger();

    logger.info({ jobId: 'j1' }, 'review.completed');

    const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: 'info',
      name: 'test',
      jobId: 'j1',
      msg: 'review.completed',
    });
  });
});
