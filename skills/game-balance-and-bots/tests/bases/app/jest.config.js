// jest.config.js (fixture excerpt): the unit project never runs bot sims.
module.exports = {
  projects: [
    {
      displayName: 'unit',
      testPathIgnorePatterns: ['/node_modules/', '\\.golden\\.test\\.', '\\.sim\\.test\\.'],
    },
  ],
};
