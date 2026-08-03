import type { Config } from 'jest';

/**
 * Unit-test configuration. Specs live next to the code they cover
 * (`*.spec.ts`); end-to-end specs are excluded and run via
 * `test/jest-e2e.config.ts`.
 */
const config: Config = {
  rootDir: '.',
  testEnvironment: 'node',
  // Decorator metadata is what class-validator and Nest's DI read at runtime;
  // without this polyfill any decorated class fails to even load.
  setupFiles: ['reflect-metadata'],
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: '.*\\.spec\\.ts$',
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '\\.e2e-spec\\.ts$'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.json',
        isolatedModules: false,
      },
    ],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@test/(.*)$': '<rootDir>/test/$1',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.module.ts',
    '!src/**/*.dto.ts',
    '!src/main.ts',
    '!src/**/index.ts',
  ],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      statements: 70,
      branches: 60,
      functions: 70,
      lines: 70,
    },
  },
  clearMocks: true,
  restoreMocks: true,
  verbose: true,
};

export default config;
