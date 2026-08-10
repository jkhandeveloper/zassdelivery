import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

export enum LogLevel {
  Error = 'error',
  Warn = 'warn',
  Info = 'info',
  Debug = 'debug',
  Verbose = 'verbose',
}

/**
 * Env values arrive as strings. `"false"` is a non-empty string and would
 * coerce to `true` under implicit conversion, so booleans are parsed explicitly.
 */
const toBoolean = ({ value }: { value: unknown }): unknown => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalised = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalised)) {
      return true;
    }
    if (['false', '0', 'no', 'off', ''].includes(normalised)) {
      return false;
    }
  }
  return value;
};

/**
 * The complete contract between the process environment and the application.
 * Anything not declared here is invisible to the app by design.
 */
export class EnvironmentVariables {
  // ── Application ──
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsString()
  @IsNotEmpty()
  API_PREFIX: string = 'api';

  @IsString()
  @Matches(/^\d+$/, { message: 'API_VERSION must be a numeric string, e.g. "1"' })
  API_VERSION: string = '1';

  // ── Database ──
  @IsString()
  @Matches(/^postgres(ql)?:\/\//, {
    message: 'DATABASE_URL must be a postgresql:// connection string',
  })
  DATABASE_URL!: string;

  // ── Redis ──
  @IsString()
  @IsNotEmpty()
  REDIS_HOST: string = 'localhost';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  REDIS_PORT: number = 6379;

  @IsOptional()
  @IsString()
  REDIS_PASSWORD?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(15)
  REDIS_DB: number = 0;

  @IsString()
  REDIS_KEY_PREFIX: string = 'zass:';

  // ── JWT ──
  // Validated from Milestone 1 so a misconfigured deployment fails at boot
  // rather than on the first login attempt.
  @IsString()
  @MinLength(32, { message: 'JWT_ACCESS_SECRET must be at least 32 characters' })
  JWT_ACCESS_SECRET!: string;

  @IsString()
  @Matches(/^\d+(ms|s|m|h|d|w|y)$/, {
    message: 'JWT_ACCESS_TTL must be a duration such as "15m" or "3600s"',
  })
  JWT_ACCESS_TTL: string = '15m';

  @IsString()
  @MinLength(32, { message: 'JWT_REFRESH_SECRET must be at least 32 characters' })
  JWT_REFRESH_SECRET!: string;

  @IsString()
  @Matches(/^\d+(ms|s|m|h|d|w|y)$/, {
    message: 'JWT_REFRESH_TTL must be a duration such as "30d"',
  })
  JWT_REFRESH_TTL: string = '30d';

  // ── Logging ──
  @IsEnum(LogLevel)
  LOG_LEVEL: LogLevel = LogLevel.Info;

  // ── Rate limiting ──
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  THROTTLE_TTL: number = 60000;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  THROTTLE_LIMIT: number = 120;

  // ── CORS ──
  @IsString()
  CORS_ORIGINS: string = '*';

  // ── Swagger ──
  @Transform(toBoolean)
  @IsBoolean()
  SWAGGER_ENABLED: boolean = true;

  @IsString()
  @IsNotEmpty()
  SWAGGER_PATH: string = 'docs';

  // ── Payments ──
  // Gateway credentials are issued per merchant and are absent in development,
  // so every one of them is optional. An unconfigured gateway reports itself
  // unavailable at checkout; it never fails at the point of payment.
  @IsString()
  @Matches(/^https?:\/\//, { message: 'PUBLIC_BASE_URL must be an absolute http(s) URL' })
  PUBLIC_BASE_URL: string = 'http://localhost:3000';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  PAYMENT_CHECKOUT_TTL_MINUTES: number = 15;

  @IsOptional()
  @IsString()
  JAZZCASH_MERCHANT_ID?: string;

  @IsOptional()
  @IsString()
  JAZZCASH_PASSWORD?: string;

  @IsOptional()
  @IsString()
  JAZZCASH_INTEGRITY_SALT?: string;

  @IsOptional()
  @IsString()
  JAZZCASH_CHECKOUT_URL?: string;

  @IsOptional()
  @IsString()
  JAZZCASH_API_URL?: string;

  @IsOptional()
  @IsString()
  EASYPAISA_STORE_ID?: string;

  @IsOptional()
  @IsString()
  EASYPAISA_HASH_KEY?: string;

  @IsOptional()
  @IsString()
  EASYPAISA_CHECKOUT_URL?: string;

  @IsOptional()
  @IsString()
  EASYPAISA_API_URL?: string;

  // ── Notifications ──
  // Firebase credentials come from a service-account key and are absent in
  // development, so all three are optional: push reports itself unavailable
  // rather than failing at send time, and in-app notifications keep working.
  @IsOptional()
  @IsString()
  FCM_PROJECT_ID?: string;

  @IsOptional()
  @IsString()
  FCM_CLIENT_EMAIL?: string;

  @IsOptional()
  @IsString()
  FCM_PRIVATE_KEY?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  PUSH_CONCURRENCY: number = 25;

  @Type(() => Number)
  @IsInt()
  @Min(50)
  @Max(5000)
  BROADCAST_BATCH_SIZE: number = 500;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  PUSH_MAX_FAILURES: number = 5;

  // ── Market defaults ──
  @IsString()
  @Matches(/^\+\d{1,4}$/, { message: 'DEFAULT_COUNTRY_CODE must look like "+92"' })
  DEFAULT_COUNTRY_CODE: string = '+92';

  @IsString()
  @IsNotEmpty()
  DEFAULT_TIMEZONE: string = 'Asia/Karachi';

  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'DEFAULT_CURRENCY must be a 3-letter ISO 4217 code' })
  DEFAULT_CURRENCY: string = 'PKR';
}

/**
 * Fail-fast validator wired into `ConfigModule.forRoot({ validate })`.
 * A bad environment aborts the process before any port is bound.
 */
export function validateEnvironment(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: false,
    exposeDefaultValues: true,
    excludeExtraneousValues: false,
  });

  const errors = validateSync(validated, {
    skipMissingProperties: false,
    whitelist: false,
    forbidUnknownValues: false,
  });

  if (errors.length > 0) {
    const details = errors
      .map((error) => {
        const constraints = Object.values(error.constraints ?? {}).join('; ');
        return `  • ${error.property}: ${constraints || 'invalid value'}`;
      })
      .join('\n');

    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return validated;
}
