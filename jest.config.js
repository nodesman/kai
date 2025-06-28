// jest.config.js
module.exports = {
  preset: 'ts-jest', // Use ts-jest preset for TypeScript
  testEnvironment: 'node', // Specify the environment (Node.js for a CLI tool)
  testMatch: [ // Patterns Jest uses to detect test files
    "**/src/**/*.test.ts" // Look for files ending in .test.ts within the src directory
    // You could also use "**/__tests__/**/*.ts?(x)", "**/?(*.)+(spec|test).ts?(x)"
  ],
  clearMocks: true, // Automatically clear mock calls and instances between every test
  moduleNameMapper: {
    '^chalk$': '<rootDir>/__mocks__/chalk.js'
  },
  cacheDirectory: '<rootDir>/node_modules/.cache/jest', // Store Jest cache within project to avoid system temp permission issues
  // Allow transformation of certain ESM modules (chalk, ansi-styles, inquirer)
  transformIgnorePatterns: [
    '/node_modules/(?!(chalk|ansi-styles|inquirer)/)'
  ],
};