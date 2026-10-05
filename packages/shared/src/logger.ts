import { pino, type Logger, type LoggerOptions } from 'pino';

export type { Logger } from 'pino';

/** Never log credentials (rules.md §5, Architecture.md §8). */
export const LOG_REDACT_PATHS = [
  'authorization',
  'cookie',
  '*.authorization',
  '*.cookie',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-hub-signature-256"]',
  '*.token',
  '*.privateKey',
  '*.apiKey',
  '*.secret',
];

export type CreateLoggerOptions = {
  name: string;
  level: LoggerOptions['level'];
};

export function createLogger(
  options: CreateLoggerOptions,
  destination?: pino.DestinationStream,
): Logger {
  const config: LoggerOptions = {
    name: options.name,
    level: options.level ?? 'info',
    redact: { paths: LOG_REDACT_PATHS, censor: '[redacted]' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
  };
  return destination ? pino(config, destination) : pino(config);
}
