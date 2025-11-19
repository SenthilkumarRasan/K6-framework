import { check, group } from 'k6';
import { handleSummary } from '../../utils/handleSummary.js';
import { scenarios, thresholds } from '../../config/scenario.js';
import { buildCustomScenario } from '../../utils/buildCustomScenario.js';
import http from 'k6/http';

// Determine if the test is for API or BROWSER
const testType = __ENV.TEST_TYPE || 'API'; // Default to API if not specified
const scenarioType = __ENV.SCENARIO_TYPE || 'smoke'; // Default to smoke if not specified

// Build scenario configuration based on the scenario type and test type
let scenarioConfig;
if (scenarioType === 'custom-tps' || scenarioType === 'custom-vus') {
  scenarioConfig = buildCustomScenario(scenarioType, __ENV.RAMPING_STAGES);
} else {
  scenarioConfig = scenarios[testType][scenarioType];
}

export const options = {
  thresholds: thresholds[testType],
  scenarios: {
    custom_scenario: {
      ...scenarioConfig,
      tags: {
        environment: __ENV.ENVIRONMENT,
        scenario: scenarioType
      },
    },
  },
};

const BASE_URL = 'https://quickpizza.grafana.com';

export default function () {
  group('Public Ping Endpoint', { transaction: 'PublicPing' }, () => {
    const req = {
      name: 'PublicPing',
      url: `${BASE_URL}/api/public/ping`,
      method: 'GET',
      expectedStatus: 200
    };
    const res = http.get(req.url, { tags: { transaction: 'PublicPing' } });
    check(res, {
      'status is 200': (r) => r.status === req.expectedStatus,
      'body is pong': (r) => r.body && r.body.toLowerCase().includes('pong'),
    });
  });
}

// Add this to get HTML summary.
export { handleSummary };
