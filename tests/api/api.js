import { check, group, fail } from 'k6';
import { get } from '../../utils/httpClient.js';
import { handleError } from '../../utils/helpers.js';
import { handleSummary2 } from '../../utils/handleSummary.js';
import { scenarios, thresholds, buildCustomScenario } from '../../config/scenario.js';
import http from 'k6/http';

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
        scenario: scenarioType
      },
    },
  },
};

// Create a random string of given length
function randomString(length, charset = '') {
  if (!charset) charset = 'abcdefghijklmnopqrstuvwxyz';
  let res = '';
  while (length--) res += charset[(Math.random() * charset.length) | 0];
  return res;
}

const USERNAME = `${randomString(10)}@example.com`; // Set your own email or `${randomString(10)}@example.com`;
const PASSWORD = 'secret';

const BASE_URL = 'https://quickpizza.grafana.com';

// Register a new user and retrieve authentication token for subsequent API requests
export function setup() {
  const res = http.post(
    `${BASE_URL}/api/users`,
    JSON.stringify({
      username: USERNAME,
      password: PASSWORD,
    })
  );

  check(res, { 'created user': (r) => r.status === 201 });

  const loginRes = http.post(
    `${BASE_URL}/api/users/token/login`,
    JSON.stringify({
      username: USERNAME,
      password: PASSWORD,
    })
  );

  const authToken = loginRes.json('token');
  check(authToken, { 'logged in successfully': () => authToken.length > 0 });

  return authToken;
}

export default function (authToken) {
  // set the authorization header on the session for the subsequent requests
  const requestConfigWithTag = (tag) => ({
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
    tags: Object.assign(
      {},
      {
        name: 'PrivateRatings',
      },
      tag
    ),
  });

  let URL = `${BASE_URL}/api/ratings`;

  group('01. Create a new rating', () => {
    const payload = {
      stars: 2,
      pizza_id: 1, // Pizza ID 1 already exists in the database.
    };

    const res = http.post(URL, JSON.stringify(payload), requestConfigWithTag({ name: 'Create' }));

    if (check(res, { 'Rating created correctly': (r) => r.status === 201 })) {
      URL = `${URL}/${res.json('id')}`;
    } else {
      console.log(`Unable to create rating ${res.status} ${res.body}`);
      return;
    }
  });

  group('02. Fetch my ratings', () => {
    const res = http.get(`${BASE_URL}/api/ratings`, requestConfigWithTag({ name: 'Fetch' }));
    check(res, { 'retrieve ratings status': (r) => r.status === 200 });
    check(res.json(), { 'retrieved ratings list': (r) => r.ratings.length > 0 });
  });

  group('03. Update the rating', () => {
    const payload = { stars: 5 };
    const res = http.put(URL, JSON.stringify(payload), requestConfigWithTag({ name: 'Update' }));
    const isSuccessfulUpdate = check(res, {
      'Update worked': () => res.status === 200,
      'Updated stars number is correct': () => res.json('stars') === 5,
    });

    if (!isSuccessfulUpdate) {
      console.log(`Unable to update the rating ${res.status} ${res.body}`);
      return;
    }
  });

  group('04. Delete the rating', () => {
    const delRes = http.del(URL, null, requestConfigWithTag({ name: 'Delete' }));

    const isSuccessfulDelete = check(null, {
      'Rating was deleted correctly': () => delRes.status === 204,
    });

    if (!isSuccessfulDelete) {
      console.log('Rating was not deleted properly');
      return;
    }
  });
}

// Add this to get HTML summary.
export { handleSummary2 };
