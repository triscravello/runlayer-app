import winston from 'winston';

const { combine, timestamp, json, colorize, printf } = winston.format;

// Development format: colorized, human-readable output
const devFormat = combine(
  colorize(),
  timestamp({ format: 'HH:mm:ss' }),
  printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} ${level}: ${message}${metaStr}`;
  })
);

// Production format: structured JSON for log aggregators
const prodFormat = combine(
  timestamp(),
  json()
);

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: process.env.NODE_ENV === 'production' ? prodFormat : devFormat,
  defaultMeta: { service: 'runlayer' },
  transports: [
    new winston.transports.Console(),
  ],
});

// Creates a child logger with request context bound to every log line
export function createRequestLogger(requestId: string, route: string, method: string) {
  return logger.child({ requestId, route, method });
}