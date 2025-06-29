/**
 * Manual Jest mock for chalk to avoid ESM import issues
 * Correctly simulates an ESM default export.
 */
// Basic chalk mock: map all used stylers to identity functions
module.exports = {
  __esModule: true, // Mark this module as an ES Module
  default: { // The default export should be the object containing the mock functions
    red: (s) => s,
    yellow: (s) => s,
    dim: (s) => s,
    green: (s) => s,
    blue: (s) => s,
    cyan: (s) => s,
    magenta: (s) => s,
    gray: (s) => s,
  },
};