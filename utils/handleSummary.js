/* eslint-env node */
/* globals require module */
const { htmlReport } = require('../utils/bundle.js');

module.exports = {
  generateSummary: function(data) {
    return {
      'summary.html': htmlReport(data),
    };
  }
};