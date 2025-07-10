import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

// Configuration
// Use JSONPlaceholder - a reliable public API for testing
const BASE_URL = __ENV.BASE_URL || 'https://jsonplaceholder.typicode.com';
const SCENARIO_TYPE = __ENV.SCENARIO_TYPE || 'smoke';

// Import scenario configurations
import { scenarios } from '../../config/scenario.js';

// Custom metrics for detailed reporting
const customMetrics = {
  failedRequests: new Counter('failed_requests')
};

// Define API endpoints with transaction names and expected statuses
// Using JSONPlaceholder endpoints that reliably return 200 OK responses
const endpoints = [
  {
    name: 'GetPosts',
    url: `${BASE_URL}/posts`,
    method: 'GET',
    tags: { transaction: 'GetPosts' },
    expectedStatus: 200
  },
  {
    name: 'GetUsers',
    url: `${BASE_URL}/users`,
    method: 'GET',
    tags: { transaction: 'GetUsers' },
    expectedStatus: 200
  },
  {
    name: 'GetComments',
    url: `${BASE_URL}/comments`,
    method: 'GET',
    tags: { transaction: 'GetComments' },
    expectedStatus: 200
  },
  {
    name: 'GetTodos',
    url: `${BASE_URL}/todos/1`,
    method: 'GET',
    tags: { transaction: 'GetTodos' },
    expectedStatus: 200
  },
  {
    name: 'GetAlbums',
    url: `${BASE_URL}/albums`,
    method: 'GET',
    tags: { transaction: 'GetAlbums' },
    expectedStatus: 200
  },
  {
    name: 'GetPhotos',
    url: `${BASE_URL}/photos/1`,
    method: 'GET',
    tags: { transaction: 'GetPhotos' },
    expectedStatus: 200
  },
  {
    name: 'PostData',
    url: `${BASE_URL}/posts`,
    method: 'POST',
    body: JSON.stringify({
      title: 'foo',
      body: 'bar',
      userId: 1,
    }),
    params: {
      headers: { 'Content-Type': 'application/json; charset=UTF-8' }
    },
    tags: { transaction: 'PostData' },
    expectedStatus: 201  // JSONPlaceholder returns 201 for POST /posts
  }
];

// Test configuration
export const options = {
  scenarios: {
    // Use the appropriate scenario based on the environment variable
    main: scenarios.API[SCENARIO_TYPE] || scenarios.API.smoke
  },
  thresholds: {
    http_req_failed: ['rate<0.01'], // Less than 1% of requests should fail
    http_req_duration: ['p(95)<1000'], // 95% of requests should be below 1000ms
  },
};

// Main test function
export default function() {
  // Execute each endpoint with proper tagging
  endpoints.forEach(endpoint => {
    let response;
    
    // Make the request with the appropriate method
    if (endpoint.method === 'GET') {
      response = http.get(endpoint.url, { tags: endpoint.tags });
    } else if (endpoint.method === 'POST') {
      response = http.post(endpoint.url, endpoint.body, { 
        ...endpoint.params,
        tags: endpoint.tags
      });
    }
    
    // Check if the request was successful against the expected status
    const success = check(response, {
      [`${endpoint.name} status is ${endpoint.expectedStatus}`]: (r) => r.status === endpoint.expectedStatus,
    }, endpoint.tags);
    
    // Add a check to verify we got a valid body response
    check(response, {
      [`${endpoint.name} has body`]: (r) => r.body.length > 0,
    }, endpoint.tags);
    
    // If the check failed, increment the custom metric
    if (!success) {
      customMetrics.failedRequests.add(1, endpoint.tags);
      console.log(`Request to ${endpoint.url} failed with status ${response.status}`);
    }
    
    // Add a small sleep to simulate user think time
    sleep(Math.random() * 0.3 + 0.2); // Sleep between 0.2s and 0.5s
  });
}
