import http from 'k6/http';

// Custom HTTP client with default headers
export function get(url, params = {}) {
  return http.get(url, {
    headers: { 'Content-Type': 'application/json', ...params.headers },
    ...params,
  });
}

export function post(url, body, params = {}) {
  return http.post(url, JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json', ...params.headers },
    ...params,
  });
}

export function put(url, body, params = {}) {
  return http.put(url, JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json', ...params.headers },
    ...params,
  });
}

export function del(url, params = {}) {
  return http.del(url, {
    headers: { 'Content-Type': 'application/json', ...params.headers },
    ...params,
  });
}