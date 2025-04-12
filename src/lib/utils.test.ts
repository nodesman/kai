// File: src/lib/utils.test.ts
import { toSnakeCase, countTokens } from './utils';

// Describe block groups related tests
describe('Utility Functions', () => {

  // Test block for the toSnakeCase function
  describe('toSnakeCase', () => {

    // Individual test case
    test('should convert basic strings with spaces', () => {
      expect(toSnakeCase("Hello World")).toBe("hello_world");
    });

    test('should remove non-alphanumeric characters (except underscore)', () => {
      expect(toSnakeCase("Test!@#$%^&*()_+=-`~ Case 123")).toBe("test_case_123");
    });

    test('should handle already snake-cased strings', () => {
      expect(toSnakeCase("already_snake_case")).toBe("already_snake_case");
    });

    test('should handle leading/trailing spaces', () => {
      expect(toSnakeCase("  Trimmed String  ")).toBe("trimmed_string");
    });

    test('should handle empty strings', () => {
      expect(toSnakeCase("")).toBe("");
    });

    test('should handle strings with multiple spaces', () => {
      expect(toSnakeCase("Multiple   Spaces")).toBe("multiple_spaces");
    });
  });

  describe('countTokens', () => {
    test('should count tokens correctly for a simple word', () => {
       // Note: Token counts can be specific to the encoder version
       expect(countTokens("hello")).toBe(1);
    });

    test('should count tokens correctly for a simple sentence', () => {
      expect(countTokens("hello world")).toBe(2);
   });

    test('should count tokens correctly for an empty string', () => {
      expect(countTokens("")).toBe(0);
   });
  });
});