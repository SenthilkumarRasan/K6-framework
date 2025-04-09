import { check, group } from 'k6';
import { get } from '../../utils/httpClient.js';
import { handleError } from '../../utils/helpers.js';
import { handleSummary } from '../../utils/handleSummary.js';
import { scenarios, thresholds, buildCustomScenario } from '../../config/scenario.js';

const testConfig = JSON.parse(open(`../../env/${__ENV.ENVIRONMENT}.json`));
const base_URL = testConfig.baseURL;

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
        scenario: scenarioType,
        transaction: 'login_page',
      },
    },
  },
};

export default function () {
  group('Login Page Tests', function () {
    const response = get(base_URL, {
      tags: { transaction: 'login_page' },
    });

    handleError(response, 200);
    check(response, {
      'Login Page Response Status': (r) => r.status === 200,
    });
    check(response, {
      'Login Page Verification: Title': (r) => r.body.includes('Sign in to 840 Banking'),
    });
    check(response, {
      'Login Page Verification: Continue button': (r) => r.body.includes('Sign in to 840 Banking'),
    });
  });
}

// Add this to get HTML summary.
export { handleSummary };
