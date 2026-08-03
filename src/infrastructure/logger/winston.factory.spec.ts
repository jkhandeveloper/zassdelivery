import type { ConfigType } from '@nestjs/config';
import type { TransformableInfo } from 'logform';

import { LogLevel } from '@/config';
import type { loggerConfig } from '@/config';
import { RequestContext } from '@/common/context/request-context';

import { createWinstonOptions } from './winston.factory';

/** Winston's internal symbol keys, read by TransportStream when emitting. */
const LEVEL = Symbol.for('level');
const MESSAGE = Symbol.for('message');

const config = (
  overrides: Partial<ConfigType<typeof loggerConfig>> = {},
): ConfigType<typeof loggerConfig> => ({
  level: LogLevel.Info,
  prettyPrint: false,
  silent: false,
  serviceName: 'zassdelivery-api',
  redactKeys: ['password', 'otp', 'token', 'authorization'],
  ...overrides,
});

function transform(
  info: Record<string, unknown>,
  overrides: Partial<ConfigType<typeof loggerConfig>> = {},
): TransformableInfo | boolean {
  const options = createWinstonOptions(config(overrides));
  // `format` is always present on the options we build.
  return options.format!.transform(info as unknown as TransformableInfo);
}

describe('createWinstonOptions', () => {
  it("preserves Winston's level symbol through the format chain", () => {
    // Regression guard: a format that rebuilds `info` as a new object drops
    // these symbols, and TransportStream then discards every record — the
    // application logs nothing at all, with no error to show for it.
    const result = transform({
      level: 'info',
      message: 'hello',
      [LEVEL]: 'info',
      userId: 'usr_1',
    }) as TransformableInfo;

    expect(result[LEVEL]).toBe('info');
  });

  it('renders a message so the transport has something to write', () => {
    const result = transform({
      level: 'info',
      message: 'hello',
      [LEVEL]: 'info',
    }) as TransformableInfo;

    expect(result[MESSAGE]).toBeDefined();
  });

  it('masks configured sensitive keys in metadata', () => {
    const result = transform({
      level: 'info',
      message: 'login attempt',
      [LEVEL]: 'info',
      password: 'hunter2',
      otp: '123456',
    }) as TransformableInfo;

    expect(result.password).toBe('[REDACTED]');
    expect(result.otp).toBe('[REDACTED]');
  });

  it('masks sensitive keys nested inside objects', () => {
    const result = transform({
      level: 'info',
      message: 'request',
      [LEVEL]: 'info',
      body: { user: { name: 'Ahmad', password: 'hunter2' } },
    }) as TransformableInfo;

    const body = result.body as { user: { name: string; password: string } };
    expect(body.user.password).toBe('[REDACTED]');
    expect(body.user.name).toBe('Ahmad');
  });

  it('masks sensitive keys inside arrays', () => {
    const result = transform({
      level: 'info',
      message: 'batch',
      [LEVEL]: 'info',
      entries: [{ token: 'abc' }, { token: 'def' }],
    }) as TransformableInfo;

    expect(result.entries).toEqual([{ token: '[REDACTED]' }, { token: '[REDACTED]' }]);
  });

  it('leaves the log message itself untouched', () => {
    const result = transform({
      level: 'info',
      message: 'user logged in',
      [LEVEL]: 'info',
    }) as TransformableInfo;

    expect(result.message).toBe('user logged in');
  });

  it('is case-insensitive when matching redaction keys', () => {
    const result = transform({
      level: 'info',
      message: 'headers',
      [LEVEL]: 'info',
      Authorization: 'Bearer abc.def',
    }) as TransformableInfo;

    expect(result.Authorization).toBe('[REDACTED]');
  });

  it('stamps the ambient correlation id onto the record', () => {
    const result = RequestContext.run(
      { requestId: 'req-abc', userId: 'usr_7', startedAt: Date.now() },
      () =>
        transform({
          level: 'info',
          message: 'in request',
          [LEVEL]: 'info',
        }) as TransformableInfo,
    );

    expect(result.requestId).toBe('req-abc');
    expect(result.userId).toBe('usr_7');
  });

  it('omits the correlation id outside a request scope', () => {
    const result = transform({
      level: 'info',
      message: 'startup',
      [LEVEL]: 'info',
    }) as TransformableInfo;

    expect(result.requestId).toBeUndefined();
  });

  it('honours the configured level and silent flag', () => {
    const options = createWinstonOptions(config({ level: LogLevel.Debug, silent: true }));

    expect(options.level).toBe('debug');
    expect(options.silent).toBe(true);
  });

  it('builds a pretty-printed format without throwing', () => {
    const result = transform(
      { level: 'info', message: 'dev output', [LEVEL]: 'info' },
      { prettyPrint: true },
    ) as TransformableInfo;

    expect(result[LEVEL]).toBe('info');
  });
});
