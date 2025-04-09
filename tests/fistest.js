import http from 'k6/http';
import { check } from 'k6';
import { describe, expect } from 'https://jslib.k6.io/k6chaijs/4.3.4.3/index.js';
import { handleError } from '../utils/helpers.js';
import { userCreds } from '../payloads/cloudfis.js';

const testConfig = JSON.parse(open(`../env/${__ENV.STACK}.json`));
const base_URL = testConfig.baseURL;
const payload = JSON.stringify(userCreds);

export const options = {
  thresholds: {
    checks: ['rate == 1.00'],
    http_req_failed: ['rate == 0.00'],
  },
  stages: [
    { duration: '1.5m', target: 10 }, // ramp up to 10 users
    { duration: '5m', target: 20 }, // stay at 20 for 5 minutes
    { duration: '1m', target: 0 }, // scale down. (optional)
  ],
};

export default function () {
  describe('First test', () => {

    const params = {
      headers: {
        'X-SunGard-IdP-API-Key' : 'd1platform-dev-key',
        'Content-Type': 'application/json',
      },
    };

    const response = http.post(base_URL, payload, params);
    handleError(response, 200);

    expect(response.status, 'response status').to.equal(200);

    check (response, {
      'header contains cookies': response =>
        response.headers['Server'] === 'Unknown'
    });

    let my_Uuid = response.headers['Uuid'];
    console.log('======================');
    console.log('Extracted Uuid from response header = ' + my_Uuid);
    console.log('======================');

  });
}