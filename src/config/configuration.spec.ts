import {
  appConfig,
  databaseConfig,
  jwtConfig,
  loggerConfig,
  redisConfig,
  swaggerConfig,
  throttleConfig,
} from './index';
import { LogLevel, NodeEnv } from './env.validation';

/**
 * The namespace factories read `process.env` directly, so each case sets the
 * variables it cares about and restores the original environment afterwards.
 */
describe('configuration namespaces', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('appConfig', () => {
    it('derives environment flags from NODE_ENV', () => {
      process.env.NODE_ENV = NodeEnv.Production;

      const config = appConfig();

      expect(config.isProduction).toBe(true);
      expect(config.isTest).toBe(false);
    });

    it('treats "*" as allowing every CORS origin', () => {
      process.env.CORS_ORIGINS = '*';

      expect(appConfig().corsOrigins).toBe(true);
    });

    it('splits and trims a comma-separated origin list', () => {
      process.env.CORS_ORIGINS = 'https://a.pk, https://b.pk ,';

      // The trailing empty entry must be dropped, otherwise an empty-string
      // origin would be compared against and never match anything useful.
      expect(appConfig().corsOrigins).toEqual(['https://a.pk', 'https://b.pk']);
    });

    it('applies market defaults for Pakistan', () => {
      delete process.env.DEFAULT_COUNTRY_CODE;
      delete process.env.DEFAULT_TIMEZONE;
      delete process.env.DEFAULT_CURRENCY;

      const config = appConfig();

      expect(config.countryCode).toBe('+92');
      expect(config.timezone).toBe('Asia/Karachi');
      expect(config.currency).toBe('PKR');
    });

    it('coerces PORT to a number', () => {
      process.env.PORT = '8080';

      expect(appConfig().port).toBe(8080);
    });
  });

  describe('redisConfig', () => {
    it('treats an empty password as no authentication', () => {
      process.env.REDIS_PASSWORD = '';

      // Passing an empty string to ioredis would attempt AUTH with a blank
      // credential rather than skipping authentication.
      expect(redisConfig().password).toBeUndefined();
    });

    it('passes a real password through', () => {
      process.env.REDIS_PASSWORD = 's3cret';

      expect(redisConfig().password).toBe('s3cret');
    });

    it('falls back to local defaults', () => {
      delete process.env.REDIS_HOST;
      delete process.env.REDIS_PORT;

      const config = redisConfig();

      expect(config.host).toBe('localhost');
      expect(config.port).toBe(6379);
      expect(config.keyPrefix).toBe('zass:');
    });
  });

  describe('databaseConfig', () => {
    it('defaults query logging to off', () => {
      delete process.env.DB_LOG_QUERIES;

      expect(databaseConfig().logQueries).toBe(false);
    });

    it('enables query logging only for the exact string "true"', () => {
      process.env.DB_LOG_QUERIES = 'yes';
      expect(databaseConfig().logQueries).toBe(false);

      process.env.DB_LOG_QUERIES = 'true';
      expect(databaseConfig().logQueries).toBe(true);
    });

    it('applies the default slow-query threshold', () => {
      delete process.env.DB_SLOW_QUERY_MS;

      expect(databaseConfig().slowQueryThresholdMs).toBe(300);
    });
  });

  describe('jwtConfig', () => {
    it('exposes secrets and a fixed issuer/audience', () => {
      process.env.JWT_ACCESS_SECRET = 'a'.repeat(32);
      process.env.JWT_REFRESH_SECRET = 'b'.repeat(32);

      const config = jwtConfig();

      expect(config.accessSecret).toHaveLength(32);
      expect(config.issuer).toBe('zassdelivery');
      expect(config.audience).toBe('zassdelivery-api');
    });

    it('defaults the token lifetimes', () => {
      delete process.env.JWT_ACCESS_TTL;
      delete process.env.JWT_REFRESH_TTL;

      expect(jwtConfig().accessTtl).toBe('15m');
      expect(jwtConfig().refreshTtl).toBe('30d');
    });
  });

  describe('loggerConfig', () => {
    it('emits JSON and never pretty-prints in production', () => {
      process.env.NODE_ENV = NodeEnv.Production;

      const config = loggerConfig();

      expect(config.prettyPrint).toBe(false);
      expect(config.silent).toBe(false);
    });

    it('silences output under test', () => {
      process.env.NODE_ENV = NodeEnv.Test;

      expect(loggerConfig().silent).toBe(true);
    });

    it('pretty-prints in development', () => {
      process.env.NODE_ENV = NodeEnv.Development;

      expect(loggerConfig().prettyPrint).toBe(true);
    });

    it('redacts credentials and one-time codes by default', () => {
      expect(loggerConfig().redactKeys).toEqual(
        expect.arrayContaining(['password', 'otp', 'refreshToken', 'authorization']),
      );
    });

    it('defaults the level to info', () => {
      delete process.env.LOG_LEVEL;

      expect(loggerConfig().level).toBe(LogLevel.Info);
    });
  });

  describe('throttleConfig', () => {
    it('applies defaults', () => {
      delete process.env.THROTTLE_TTL;
      delete process.env.THROTTLE_LIMIT;

      expect(throttleConfig()).toEqual({ ttl: 60000, limit: 120 });
    });

    it('coerces values to numbers', () => {
      process.env.THROTTLE_TTL = '1000';
      process.env.THROTTLE_LIMIT = '5';

      expect(throttleConfig()).toEqual({ ttl: 1000, limit: 5 });
    });
  });

  describe('swaggerConfig', () => {
    it('is enabled unless explicitly disabled', () => {
      delete process.env.SWAGGER_ENABLED;
      expect(swaggerConfig().enabled).toBe(true);

      process.env.SWAGGER_ENABLED = 'false';
      expect(swaggerConfig().enabled).toBe(false);
    });

    it('defaults the docs path', () => {
      delete process.env.SWAGGER_PATH;

      expect(swaggerConfig().path).toBe('docs');
    });
  });
});
