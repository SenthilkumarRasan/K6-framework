import { get } from '../utils/httpClient.js';
import { check } from 'k6';

let baseURL = 'https://beb-ready.ebanking-services.com/eAM/Credential/Index?brand=840_081203790&appId=CeB&FIORG=840&FIFID=081203790&orgId=840_081203790';

export default function () {
  const response = get(baseURL);
  check(response, {
    'Login Page Response Status': (r) => r.status === 200,
  });
}
