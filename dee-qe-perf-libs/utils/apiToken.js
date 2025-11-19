import http from 'k6/http';
import { check } from 'k6';

export function createSession(url, credentials, apiKey) {
  const params = {
    headers: {
      'X-SunGard-IdP-API-Key': apiKey,
      'Content-Type': 'application/json',
      Accept: '*/*',
      'Accept-Encoding': 'gzip, deflate, br',
      Connection: 'keep-alive',
    },
    cookies: {},
  };

  const resp = http.post(url, JSON.stringify(credentials), params);

  check(resp, { 'status equals 200': (r) => r.status === 200 });

  const sessionId = resp.cookies.JSESSIONID[0].value; // Retrieve JSESSIONID cookie

  return { sessionId }; // Return sessionId
}

export function getTokenFromSession(url, sessionId, apiKey) {
  const params = {
    headers: {
      'X-SunGard-IdP-API-Key': apiKey,
      Authorization: `Bearer ${sessionId}`, // Assuming sessionId is used in Authorization header
    },
    cookies: {
      JSESSIONID: sessionId, // Pass the JSESSIONID cookie
    },
  };

  const resp = http.get(url, params);

  check(resp, { 'status equals 200': (r) => r.status === 200 });

  const idToken = resp.json().id_token; // Extract id_token from JSON response

  return { resp, idToken }; // Return the response and id_token
}

export function createJwtToken(url, payload, headers, options = {}) {
  // Only use the exact headers from the working curl command
  const defaultHeaders = {
    'Content-Type': 'application/json'
  };

  // Build the final headers object: defaults <- provided headers
  const requestHeaders = Object.assign({}, defaultHeaders, headers || {});

  // Ensure channel header (bulk script uses DIG_FLX_INT_MOB)
  if (!requestHeaders.channel) requestHeaders.channel = 'DIG_FLX_INT_MOB';
  
  // Ensure x-org-id header matches organization-id (bulk sets both)
  if (requestHeaders['organization-id'] && !requestHeaders['x-org-id']) {
    requestHeaders['x-org-id'] = requestHeaders['organization-id'];
  }

  // Ensure a valid uuid header is present - some auth servers validate this strictly
  try {
    const uuidVal = requestHeaders.uuid;
    const isUuidLike = uuidVal && typeof uuidVal === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuidVal);
    if (!isUuidLike || String(uuidVal).toLowerCase() === 'auto' || String(uuidVal).toLowerCase() === 'probe') {
      requestHeaders.uuid = generateUuidV4();
    }
  } catch {
    // ignore
  }

  // Build request options for k6 http call (preserve any options like tags passed by caller)
  const requestOptions = Object.assign({}, options, { headers: requestHeaders });

  // Execute the POST
  const res = http.post(url, payload, requestOptions);

  let jwToken = null;
  try {
    // Inspect content-type header to decide whether to attempt JSON parsing
    const headers = res && res.headers ? res.headers : {};
    const contentType = (headers['Content-Type'] || headers['content-type'] || '').toLowerCase();
    let body = null;

    if (contentType.includes('application/json')) {
      // Try to parse JSON using k6 helper first, then fallback to JSON.parse
      try {
        body = res.json();
      } catch {
        try {
          body = JSON.parse(res.body);
        } catch {
          body = null;
        }
      }
    } else {
      // Not JSON (HTML or other) - avoid parsing and treat as non-JSON response
      body = null;
    }

    // Support multiple possible token locations depending on upstream API
    if (body) {
      jwToken = body?.data?.jwToken || body?.data?.token || body?.data?.access_token || body?.jwToken || body?.token || body?.access_token || null;
      if (!jwToken && body?.data && typeof body.data === 'string') {
        // Some APIs return a stringified JSON in data field
        try {
          const parsedData = JSON.parse(body.data);
          jwToken = parsedData?.jwToken || parsedData?.token || parsedData?.access_token || null;
        } catch {
          // ignore
        }
      }
    }
  } catch (_e) {
    console.error('Failed to parse jwToken from response:', _e);
  }

  if (!jwToken) {
    // Improved debug logging for non-JSON or error responses
    try {
      const preview = (res && res.body) ? String(res.body).slice(0, 2000) : '<no body>';
      const hdrPreview = JSON.stringify(res && res.headers ? res.headers : {});
      if (res && res.status && res.status >= 400) {
        console.warn(`createJwtToken: jwToken not found. status=${res.status}, contentType=${(res.headers && (res.headers['Content-Type'] || res.headers['content-type'])) || '<unknown>'}`);
        console.warn(`createJwtToken: response headers=${hdrPreview}`);
        console.warn(`createJwtToken: bodyPreview=${preview}`);
        console.warn('createJwtToken: server returned a non-JSON or error page (e.g. HTML). Verify token endpoint, headers and payload.');
      } else {
        console.warn(`createJwtToken: jwToken not found in response. status=${res && res.status}, bodyPreview=${preview}`);
      }
    } catch {
      // swallow
    }
  }
  return { jwToken, res };
}

// Small RFC4122 v4 UUID generator (suitable for client-side usage in k6)
export function generateUuidV4() {
  // Use Math.random-based generation; good enough for request identifiers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.floor(Math.random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
