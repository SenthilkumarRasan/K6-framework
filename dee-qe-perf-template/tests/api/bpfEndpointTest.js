import { check, group } from 'k6';
import { get } from '../../utils/httpClient.js';
import { handleError } from '../../utils/helpers.js';
import { handleSummary } from '../../utils/handleSummary.js';
import { createSession, getTokenFromSession } from '../../utils/apiToken.js';
import { scenarios, thresholds } from '../../config/scenario.js';
import { buildCustomScenario } from '../../utils/buildCustomScenario.js';
import { parseCsvWithHeaders, createCsvIterator } from '../../utils/csvReader.js';

const testConfig = JSON.parse(open(`../../env/${__ENV.ENVIRONMENT}.json`));
const userPayloads = JSON.parse(open('../../payloads/bpf.json'));

const csvFilename = __ENV.CSV_FILENAME || 'bpfuser.csv';

let baseURL, tokenBaseURL, apiKey, loginName, password;

try {
  // Extract the necessary values
  ({ baseURL, tokenBaseURL, apiKey, loginName, password } = testConfig.bpf);

  // Check if any of the required values are missing
  if (!baseURL || !tokenBaseURL || !apiKey || !loginName || !password) {
    throw new Error('Missing required configuration values in JSON file.');
  }
} catch (error) {
  console.error('Error reading configuration:', error.message);
  // Handle the error appropriately within the script
  throw error; // Re-throw the error to stop further execution
}


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
  insecureSkipTLSVerify: true,
};


// --- Global shared iterator for strict sequential extraction ---
// Read the CSV file directly in the test script to avoid path resolution issues
const csvFilePath = `../../testdata/${csvFilename}`;
let csvData;
try {
  const csvContent = open(csvFilePath);
  csvData = parseCsvWithHeaders(csvContent);
} catch (csvError) {
  console.error(`Error loading CSV file: ${csvError}`);
  csvData = []; // Ensure csvData is an empty array to prevent further errors
}
const urlIterator = createCsvIterator(csvData, { selectionMode: __ENV.SELECTION_MODE });


export default function () {
  group('User Tests', function () {
    let idToken = initializeSession();
    const user = urlIterator.next();

    if (!user) {
      console.warn('No user data available. Check if CSV file is properly loaded.');
      return;
    }
    console.log('SELECTION_MODE:', user.uuid);
    // Create a new user
    //const newUser = generateRandomUser();
    //const createUserRes = post(`${baseURL}/users`, newUser);
    // Check for 401 response and reinitialize session if needed
    // if (createUserRes.status === 401) {
    //   idToken = initializeSession();
    // }
    // check(createUserRes, { 'User created': (r) => r.status === 201 });


    // Add authorization header dynamically
    const getuser = userPayloads.getuser;
    getuser.params.headers['Authorization'] = `Bearer ${idToken}`;

    // Get created user
    // const userId = createUserRes.json().id;
    const userId = user.uuid;
    // Get the user data
    const params = getuser.params;
    const getUserRes = get(`${baseURL}/${userId}`, params);

    if (getUserRes.status === 401) {
      idToken = initializeSession();
    }
    handleError(getUserRes, 200);
    check(getUserRes, { 'GET user response is 200': (r) => r.status === 200 });

    // Parse the response body to access customerId
    const responseBody = JSON.parse(getUserRes.body);
    console.log(`Resulted customer ID: ${responseBody.customerId}`); // Log the customer ID for verification

    // Update the user
    // newUser.name = 'Updated Name';
    // const updateUserRes = put(`${baseURL}/users/${userId}`, newUser);
    // check(updateUserRes, { 'User updated': (r) => r.status === 200 });

    // // Delete the user
    // const deleteUserRes = del(`${baseURL}/users/${userId}`);
    // check(deleteUserRes, { 'User deleted': (r) => r.status === 204 });
  });
}

function initializeSession() {
  const credentials = {
    loginName: loginName,
    password: password,
  };

  const sessionUrl = `${tokenBaseURL}sessions`;
  const { sessionId } = createSession(sessionUrl, credentials, apiKey);

  const tokenUrl = `${tokenBaseURL}idptoken/openid-connect?client_id=d1platform_dev&replace_token=true`;
  const { idToken } = getTokenFromSession(tokenUrl, sessionId, apiKey);

  //console.log(`ID Token: ${idToken}`); // Log the id_token for verification

  return idToken;
}
// Add this to get HTML summary.
export { handleSummary };
