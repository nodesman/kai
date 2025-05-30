// jest.config.js
import os from 'os';

export default {
  preset: 'ts-jest', // Use ts-jest preset for TypeScript
  testEnvironment: 'node', // Specify the environment (Node.js for a CLI tool)
  roots: [ // Directories Jest should scan for tests and modules
    "<rootDir>/src",
    os.tmpdir() // Allow Jest to look in the system's temp directory
  ],
  testMatch: [ // Patterns Jest uses to detect test files
    "**/src/**/*.test.ts", // Standard pattern for project tests
    "**/*.test.ts"         // Generic pattern that would match files in temp dir if absolute path is given
    // You could also use "**/__tests__/**/*.ts?(x)", "**/?(*.)+(spec|test).ts?(x)"
  ],
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1' // Use absolute path
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { isolatedModules: true, tsconfig: '<rootDir>/tsconfig.json' }],
  },
  clearMocks: true, // Automatically clear mock calls and instances between every test
};