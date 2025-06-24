import http from 'k6/http';
import { check } from 'k6';

/**
 * Enhanced HTTP client wrapper for k6 with improved error handling and performance
 */

// Shared default headers to avoid recreating object multiple times
const DEFAULT_HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json'
};

// Default timeout in milliseconds
const DEFAULT_TIMEOUT = 30000;

/**
 * Helper function to merge headers and parameters with defaults
 * @param {Object} params - Request parameters
 * @returns {Object} - Merged parameters
 */
function mergeParams(params = {}) {
  return {
    timeout: DEFAULT_TIMEOUT,
    ...params,
    headers: {
      ...DEFAULT_HEADERS,
      ...params.headers
    }
  };
}

/**
 * Process response with optional validation and body length check
 * @param {Response} response - HTTP response object
 * @param {Object} options - Processing options
 * @returns {Response} - The original response
 */
function processResponse(response, options = {}) {
  const {
    validateStatus = true,
    checkBodyLength = true,
    name = 'HTTP Request',
    tags = {}
  } = options;

  if (validateStatus) {
    check(response, {
      [`${name} status is 2xx`]: (r) => r.status >= 200 && r.status < 300,
    }, tags);
  }

  if (checkBodyLength) {
    check(response, {
      [`${name} has body`]: (r) => r.body && r.body.length > 0,
    }, tags);
  }

  return response;
}

/**
 * Prepare request body based on content type
 * @param {*} body - Request body
 * @param {Object} params - Request parameters
 * @returns {string|Object} - Processed body
 */
function prepareBody(body, params = {}) {
  // If body is already a string, return it
  if (typeof body === 'string') return body;

  // If content type is form, return as is (for FormData)
  if (params.headers && params.headers['Content-Type'] === 'application/x-www-form-urlencoded') {
    return body;
  }

  // Otherwise, assume JSON
  return JSON.stringify(body);
}

// Make a GET request
export function get(url, params = {}, options = {}) {
  const tags = options.tags || params.tags || {};
  const mergedParams = { ...mergeParams(params), tags };
  return processResponse(
    http.get(url, mergedParams),
    { ...options, name: options.name || `GET ${url}`, tags }
  );
}

// Make a POST request
export function post(url, body, params = {}, options = {}) {
  const tags = options.tags || params.tags || {};
  const mergedParams = { ...mergeParams(params), tags };
  return processResponse(
    http.post(url, prepareBody(body, params), mergedParams),
    { ...options, name: options.name || `POST ${url}`, tags }
  );
}

// Make a PUT request
export function put(url, body, params = {}, options = {}) {
  const tags = options.tags || params.tags || {};
  const mergedParams = { ...mergeParams(params), tags };
  return processResponse(
    http.put(url, prepareBody(body, params), mergedParams),
    { ...options, name: options.name || `PUT ${url}`, tags }
  );
}

// Make a DELETE request
export function del(url, params = {}, options = {}) {
  const tags = options.tags || params.tags || {};
  const mergedParams = { ...mergeParams(params), tags };
  return processResponse(
    http.del(url, mergedParams),
    { ...options, name: options.name || `DELETE ${url}`, tags }
  );
}

// Make a PATCH request
export function patch(url, body, params = {}, options = {}) {
  const tags = options.tags || params.tags || {};
  const mergedParams = { ...mergeParams(params), tags };
  return processResponse(
    http.patch(url, prepareBody(body, params), mergedParams),
    { ...options, name: options.name || `PATCH ${url}`, tags }
  );
}

// Make a batch of requests in parallel
export function batch(requests = []) {
  // requests: [{ method, url, body, params, options }]
  const responses = {};
  requests.forEach(req => {
    const { method, url, body, params, options } = req;
    switch (method.toLowerCase()) {
    case 'get':
      responses[req.tag || url] = get(url, params, options);
      break;
    case 'post':
      responses[req.tag || url] = post(url, body, params, options);
      break;
    case 'put':
      responses[req.tag || url] = put(url, body, params, options);
      break;
    case 'del':
    case 'delete':
      responses[req.tag || url] = del(url, params, options);
      break;
    case 'patch':
      responses[req.tag || url] = patch(url, body, params, options);
      break;
    default:
      throw new Error(`Unsupported method: ${method}`);
    }
  });
  return responses;
}