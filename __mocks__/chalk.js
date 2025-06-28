/**
 * Manual Jest mock for chalk to avoid ESM import issues
 */
// Basic chalk mock: map all used stylers to identity functions
module.exports = {
  red: (s) => s,
  yellow: (s) => s,
  dim: (s) => s,
  green: (s) => s,
  blue: (s) => s,
  cyan: (s) => s,
  magenta: (s) => s,
  gray: (s) => s,
};