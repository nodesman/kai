/** Manual mock for inquirer to avoid loading ESM modules during tests */
const jestMock = require('jest-mock');
module.exports = {
  prompt: jestMock.fn(),
};