/** Manual mock for @actions/core – used by Jest to avoid loading the ESM package. */
'use strict';

module.exports = {
  getInput: jest.fn(),
  setFailed: jest.fn(),
  setOutput: jest.fn(),
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  notice: jest.fn(),
};
