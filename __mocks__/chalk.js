// __mocks__/chalk.js
const chalk = (str) => str;
chalk.red = (str) => str;
chalk.yellow = (str) => str;
chalk.dim = (str) => str;
chalk.green = (str) => str;
chalk.blue = (str) => str;
chalk.cyan = (str) => str;
chalk.magenta = (str) => str;
chalk.gray = (str) => str;
chalk.grey = (str) => str;

module.exports = {
  __esModule: true,
  default: chalk,
};
