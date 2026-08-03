import { utilities as nestWinstonUtilities } from 'nest-winston';
import { format, transports } from 'winston';
import type { WinstonModuleOptions } from 'nest-winston';

import { RequestContext } from '@/common/context/request-context';
import type { loggerConfig } from '@/config';
import type { ConfigType } from '@nestjs/config';

type LoggerConfig = ConfigType<typeof loggerConfig>;

const MASK = '[REDACTED]';

/**
 * Recursively masks sensitive values. Depth-limited so a cyclic or pathological
 * structure can never stall the logging pipeline.
 */
function redact(value: unknown, keys: readonly string[], depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, keys, depth + 1));
  }

  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(source)) {
    result[key] = keys.includes(key.toLowerCase()) ? MASK : redact(item, keys, depth + 1);
  }

  return result;
}

/**
 * Fields owned by Winston or by the formats above; they are structural rather
 * than user-supplied metadata, so redaction leaves them alone.
 */
const RESERVED_FIELDS = new Set(['level', 'message', 'timestamp', 'stack', 'context', 'ms']);

/**
 * Masks configured keys anywhere in the log metadata.
 *
 * The `info` object is mutated in place and returned, rather than rebuilt as a
 * new object literal. Winston tracks the effective level and the rendered line
 * on `info` under the symbol keys `Symbol.for('level')` and
 * `Symbol.for('message')`; spreading into a fresh object drops those symbols,
 * and `TransportStream` then reads an undefined level and silently discards
 * every record. Mutating preserves them.
 */
const redactionFormat = (keys: readonly string[]) =>
  format((info) => {
    const lowered = keys.map((key) => key.toLowerCase());

    for (const key of Object.keys(info)) {
      if (RESERVED_FIELDS.has(key)) {
        continue;
      }
      info[key] = lowered.includes(key.toLowerCase()) ? MASK : redact(info[key], lowered);
    }

    return info;
  })();

/** Stamps each line with the ambient correlation id and user, when present. */
const correlationFormat = format((info) => {
  const store = RequestContext.get();
  if (store) {
    info.requestId = store.requestId;
    if (store.userId) {
      info.userId = store.userId;
    }
  }
  return info;
});

/**
 * Builds the Winston options used as the application logger.
 *
 * Output always goes to stdout: in containers the runtime owns collection and
 * rotation, so writing log files inside the image would only risk filling the
 * container's writable layer.
 */
export function createWinstonOptions(config: LoggerConfig): WinstonModuleOptions {
  const baseFormats = [
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    format.errors({ stack: true }),
    correlationFormat(),
    redactionFormat(config.redactKeys),
  ];

  return {
    level: config.level,
    silent: config.silent,
    defaultMeta: { service: config.serviceName },
    format: config.prettyPrint
      ? format.combine(
          ...baseFormats,
          format.ms(),
          nestWinstonUtilities.format.nestLike('Zass', {
            colors: true,
            prettyPrint: true,
          }),
        )
      : format.combine(...baseFormats, format.json()),
    transports: [new transports.Console({ handleExceptions: true, handleRejections: true })],
    exitOnError: false,
  };
}
