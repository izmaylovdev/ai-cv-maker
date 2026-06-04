export default {
  displayName: 'admin-api-e2e',
  preset: '../../jest.preset.js',
  globalSetup: '<rootDir>/e2e/support/global-setup.ts',
  globalTeardown: '<rootDir>/e2e/support/global-teardown.ts',
  setupFiles: ['<rootDir>/e2e/support/test-setup.ts'],
  testEnvironment: 'node',
  testMatch: ['<rootDir>/e2e/**/*.spec.ts'],
  transform: {
    '^.+\\.[tj]s$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
      },
    ],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/admin-api-e2e',
};
