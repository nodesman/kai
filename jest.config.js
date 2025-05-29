// jest.config.js
module.exports = {
  preset: 'ts-jest', // Use ts-jest preset for TypeScript
  testEnvironment: 'node', // Specify the environment (Node.js for a CLI tool)
  roots: [ // Directories Jest should scan for tests and modules
    "<rootDir>/src",
    "/tmp" // Allow Jest to look in /tmp for tests specified by absolute path
  ],
  testMatch: [ // Patterns Jest uses to detect test files
    "**/src/**/*.test.ts", // Standard pattern for project tests
    "**/*.test.ts"         // Generic pattern that would match files in /tmp if absolute path is given
    // You could also use "**/__tests__/**/*.ts?(x)", "**/?(*.)+(spec|test).ts?(x)"
  ],
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1' // Use absolute path
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { isolatedModules: true }],
  },
  clearMocks: true, // Automatically clear mock calls and instances between every test
};