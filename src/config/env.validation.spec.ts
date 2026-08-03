import { LogLevel, NodeEnv, validateEnvironment } from './env.validation';

/** A minimal environment that satisfies every required variable. */
const validEnv = (): Record<string, unknown> => ({
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db?schema=public',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
});

describe('validateEnvironment', () => {
  it('accepts a minimal valid environment and applies defaults', () => {
    const result = validateEnvironment(validEnv());

    expect(result.NODE_ENV).toBe(NodeEnv.Development);
    expect(result.PORT).toBe(3000);
    expect(result.API_PREFIX).toBe('api');
    expect(result.LOG_LEVEL).toBe(LogLevel.Info);
    expect(result.DEFAULT_CURRENCY).toBe('PKR');
    expect(result.DEFAULT_COUNTRY_CODE).toBe('+92');
  });

  it('coerces numeric strings into numbers', () => {
    const result = validateEnvironment({ ...validEnv(), PORT: '8080', REDIS_DB: '3' });

    expect(result.PORT).toBe(8080);
    expect(typeof result.PORT).toBe('number');
    expect(result.REDIS_DB).toBe(3);
  });

  it('parses "false" as a boolean rather than a truthy string', () => {
    // A naive Boolean(value) cast would make the non-empty string "false" true,
    // silently enabling Swagger in production.
    const result = validateEnvironment({ ...validEnv(), SWAGGER_ENABLED: 'false' });

    expect(result.SWAGGER_ENABLED).toBe(false);
  });

  it.each(['true', '1', 'yes', 'on'])('parses "%s" as true', (value) => {
    expect(validateEnvironment({ ...validEnv(), SWAGGER_ENABLED: value }).SWAGGER_ENABLED).toBe(
      true,
    );
  });

  it('rejects a missing DATABASE_URL', () => {
    const env = validEnv();
    delete env.DATABASE_URL;

    expect(() => validateEnvironment(env)).toThrow(/DATABASE_URL/);
  });

  it('rejects a DATABASE_URL that is not a postgres connection string', () => {
    expect(() =>
      validateEnvironment({ ...validEnv(), DATABASE_URL: 'mysql://user@localhost/db' }),
    ).toThrow(/postgresql/);
  });

  it('rejects a JWT secret shorter than 32 characters', () => {
    expect(() => validateEnvironment({ ...validEnv(), JWT_ACCESS_SECRET: 'too-short' })).toThrow(
      /at least 32 characters/,
    );
  });

  it('rejects an out-of-range port', () => {
    expect(() => validateEnvironment({ ...validEnv(), PORT: '70000' })).toThrow(/PORT/);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => validateEnvironment({ ...validEnv(), NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('rejects a malformed JWT TTL', () => {
    expect(() => validateEnvironment({ ...validEnv(), JWT_ACCESS_TTL: '15 minutes' })).toThrow(
      /JWT_ACCESS_TTL/,
    );
  });

  it('reports every failure at once rather than stopping at the first', () => {
    const env = validEnv();
    delete env.DATABASE_URL;
    delete env.JWT_ACCESS_SECRET;

    // A deployment with several bad values should surface all of them in one
    // boot attempt instead of forcing an operator to fix them one by one.
    expect(() => validateEnvironment(env)).toThrow(/DATABASE_URL[\s\S]*JWT_ACCESS_SECRET/);
  });
});
