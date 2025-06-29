/** Manual mock for inquirer to avoid loading ESM modules during tests */
const jestMock = require('jest-mock');
class Sep {}
module.exports = {
  prompt: jestMock.fn(),
  Separator: Sep,
};