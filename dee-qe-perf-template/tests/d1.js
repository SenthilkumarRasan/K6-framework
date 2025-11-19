import { check } from 'k6';
import { workloadConfig } from '../config/workload.js';
import { get } from '../utils/httpClient.js';
import { handleError } from '../utils/helpers.js';
import { handleSummary } from '../utils/handleSummary.js';

const testConfig = JSON.parse(open(`../env/${__ENV.ENVIRONMENT}.json`));
const base_URL = testConfig.baseURL;

const workload = __ENV.WORKLOAD || 'smoke';

// Select the desired workload configuration
const selectedWorkload = workloadConfig[workload];

export const options = {
  thresholds: { 
    // to fail the test if any checks fail
    checks: ['rate == 1.00'],
    http_req_failed: [{ threshold: 'rate == 0.00', abortOnFail: false }],
  },
  stages: selectedWorkload,
  insecureSkipTLSVerify: true,
};

export default function () {
  // describe('Simple test', () => {
  const response = get(base_URL);

  handleError(response, 200);
  check (response, {
    'Login Page Response Status': (r) => r.status ===200,
  });
  check(response, {
    'Login Page Verification: Title': (r) => r.body.includes('Sign in to 840 Banking'),
  });
  check(response, {
    'Login Page Verification: Continue button': (r) => r.body.includes('Sign in to 840 Banking'),
  });

  // });
}
export { handleSummary };
