import type { Config } from 'jest';

/**
 * End-to-end configuration. These specs boot the real Nest application
 * against a live PostgreSQL and Redis, so they run serially
 * (`--runInBand`) to keep database state deterministic.
 */
const config: Config = {
  rootDir: '..',
  testEnvironment: 'node',
  setupFiles: ['reflect-metadata'],
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: '.*\\.e2e-spec\\.ts$',
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.json',
      },
    ],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@test/(.*)$': '<rootDir>/test/$1',
  },
  setupFilesAfterEnv: ['<rootDir>/test/setup-e2e.ts'],
  testTimeout: 30000,
  clearMocks: true,
  verbose: true,
};

export default config;
