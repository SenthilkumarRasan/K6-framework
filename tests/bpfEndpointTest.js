import { check } from 'k6';
import { get, post, put, del } from '../utils/httpClient.js';
import { handleError } from '../utils/helpers.js';
import { workloadConfig } from '../config/workload.js';
import { userPayloads } from '../payloads/bpfUser.js';
import { handleSummary } from '../utils/handleSummary.js';

// get config file parameters
const testConfig = JSON.parse(open(`../env/${__ENV.STACK}.json`));
const baseURL = testConfig.baseURL;

// Select the desired workload configuration
const scenario = __ENV.SCENARIO || 'smoke';
const workloadJson = workloadConfig;

const selectedWorkload = scenario.split('.').reduce((obj, key) => obj[key], workloadJson);
export const options = {
  thresholds: {
    // to fail the test if any checks fail
    http_req_duration: ['p(95)<500'], // 95% of requests must complete below 500ms
    http_req_failed: ['rate<0.01'], // Less than 1% of requests should fail
  },
  stages: selectedWorkload,
};

export default function () {

  // // Create a new user
  // const newUser = generateRandomUser();
  // const createUserRes = post(`${baseURL}/users`, newUser);
  // check(createUserRes, { 'User created': (r) => r.status === 201 });

  // Get created user
  // const userId = createUserRes.json().id;
  // Get the user data
  const userId = userPayloads.userId;
  const params = userPayloads.params;
  const getUserRes = get(`${baseURL}/${userId}`, params);
  handleError(getUserRes, 200);
  check(getUserRes, { 'GET user response is 200': (r) => r.status === 200 });
  // console.log("Response code = " + getUserRes.status);

  // // Update the user
  // newUser.name = 'Updated Name';
  // const updateUserRes = put(`${baseURL}/users/${userId}`, newUser);
  // check(updateUserRes, { 'User updated': (r) => r.status === 200 });

  // // Delete the user
  // const deleteUserRes = del(`${baseURL}/users/${userId}`);
  // check(deleteUserRes, { 'User deleted': (r) => r.status === 204 });
}

//add this to get html summary. 
export { handleSummary };
