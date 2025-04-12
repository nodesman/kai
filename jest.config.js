// jest.config.js
module.exports = {
  preset: 'ts-jest', // Use ts-jest preset for TypeScript
  testEnvironment: 'node', // Specify the environment (Node.js for a CLI tool)
  testMatch: [ // Patterns Jest uses to detect test files
    "**/src/**/*.test.ts" // Look for files ending in .test.ts within the src directory
    // You could also use "**/__tests__/**/*.ts?(x)", "**/?(*.)+(spec|test).ts?(x)"
  ],
  clearMocks: true, // Automatically clear mock calls and instances between every test
};