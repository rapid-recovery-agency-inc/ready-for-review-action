/** Manual mock for @actions/github – used by Jest to avoid loading the ESM package. */
'use strict';

module.exports = {
  getOctokit: jest.fn(),
  context: {
    repo: { owner: '', repo: '' },
    payload: {},
  },
};
