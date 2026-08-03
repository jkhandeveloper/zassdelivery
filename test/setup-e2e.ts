/**
 * Global setup for end-to-end specs.
 *
 * These tests boot the real application against the Compose PostgreSQL and
 * Redis. `.env` itself is loaded by Nest's ConfigModule during module
 * initialisation, so only the test-specific overrides are set here — and they
 * are set before any module is imported.
 */
process.env.NODE_ENV = 'test';
// Silences Winston during test runs; assertions read HTTP responses, not logs.
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'error';
// A high limit keeps the throttler from interfering with rapid sequential specs.
process.env.THROTTLE_LIMIT = '10000';

jest.setTimeout(30000);
