/* global __ITER */
/* eslint-disable no-empty, indent, brace-style, no-unused-vars */

import { check, group, sleep } from 'k6';
import http from 'k6/http';
import { handleError, TransactionDistributionManager, buildDynatraceHeader } from '../../utils/helpers.js';
import { scenarios, thresholds } from '../../config/scenario.js';
import { buildCustomScenario } from '../../utils/buildCustomScenario.js';
import { createCsvIterator, parseCsvWithHeaders } from '../../utils/csvReader.js';
import { createJwtToken, generateUuidV4 } from '../../utils/apiToken.js';
import { SharedArray } from 'k6/data'; // For CSV data sharing across VUs

// Local token cache for VU-level token storage (seeded from setupData.tokens)
let localTokenCache = {};

// Token refresh state per cache key to prevent refresh thrashing
// Structure: { [cacheKey]: { lastRefreshMs: number, windowStartMs: number, refreshCount: number } }
const tokenRefreshState = {};

// Refresh policy defaults (can be overridden via env)
const REFRESH_COOLDOWN_MS = parseInt(__ENV.REFRESH_COOLDOWN_MS || '5000', 10); // default 5s
const REFRESH_MAX_PER_WINDOW = parseInt(__ENV.REFRESH_MAX_PER_WINDOW || '10', 10); // default 10 refreshes
const REFRESH_WINDOW_MS = parseInt(__ENV.REFRESH_WINDOW_MS || '60000', 10); // default 60s window

function canRefreshToken(cacheKey) {
  try {
    if (!cacheKey) return false;
    const now = Date.now();
    const state = tokenRefreshState[cacheKey] || { lastRefreshMs: 0, windowStartMs: now, refreshCount: 0 };

    // Enforce cooldown
    if (state.lastRefreshMs && now - state.lastRefreshMs < REFRESH_COOLDOWN_MS) {
      if (String(__ENV.DEBUG).toLowerCase() === 'true') console.log(`[TOKEN REFRESH BLOCKED] Cooldown active for ${cacheKey} (${now - state.lastRefreshMs}ms < ${REFRESH_COOLDOWN_MS}ms)`);
      try { refreshSuppressed.add(1); } catch (e) {}
      return false;
    }

    // Enforce max-per-window
    if (!state.windowStartMs || now - state.windowStartMs > REFRESH_WINDOW_MS) {
      // reset window
      state.windowStartMs = now;
      state.refreshCount = 0;
    }

    if (state.refreshCount >= REFRESH_MAX_PER_WINDOW) {
      if (String(__ENV.DEBUG).toLowerCase() === 'true') console.log(`[TOKEN REFRESH BLOCKED] Max refreshes (${REFRESH_MAX_PER_WINDOW}) in window reached for ${cacheKey}`);
      tokenRefreshState[cacheKey] = state;
      // Metric: suppressed due to max-per-window
      try { refreshSuppressed.add(1); } catch (e) {}
      return false;
    }

    // Allowed
    return true;
  } catch (e) {
    return true; // fail open to avoid blocking critical auth flows
  }
}

function recordRefresh(cacheKey) {
  try {
    if (!cacheKey) return;
    const now = Date.now();
    const state = tokenRefreshState[cacheKey] || { lastRefreshMs: 0, windowStartMs: now, refreshCount: 0 };
    if (!state.windowStartMs || now - state.windowStartMs > REFRESH_WINDOW_MS) {
      state.windowStartMs = now;
      state.refreshCount = 1;
    } else {
      state.refreshCount = (state.refreshCount || 0) + 1;
    }
    state.lastRefreshMs = now;
    tokenRefreshState[cacheKey] = state;
    if (String(__ENV.DEBUG).toLowerCase() === 'true') console.log(`[TOKEN REFRESH] Recorded refresh for ${cacheKey} (count=${state.refreshCount})`);
    // Metric: a refresh was recorded (attempted)
    try { refreshAttempts.add(1); } catch (e) {}
  } catch (e) { /* ignore */ }
}

// One-time flag to log the token request details (setup runs in init)
import { Counter } from 'k6/metrics';

// k6 custom metrics for token refresh visibility
const refreshAttempts = new Counter('refresh_attempts_total');
const refreshSucceeded = new Counter('refresh_succeeded_total');
const refreshSuppressed = new Counter('refresh_suppressed_total');
const refreshFailed = new Counter('refresh_failed_total');

let TOKEN_REQUEST_LOGGED = false;

// Lightweight debug helpers so we can run quietly when DEBUG is not enabled
const DEBUG_ENABLED = String(__ENV.DEBUG).toLowerCase() === 'true';
function dlog(...args) { if (DEBUG_ENABLED) console.log(...args); }
function dwarn(...args) { if (DEBUG_ENABLED) console.warn(...args); }

// Helper to compute a consistent cache key for an account
// Format: <fiIdentifier>::<username>::<accountid>  (accountid ALWAYS included)
function getCacheKey(account) {
  if (!account || !account.fiIdentifier) return null;
  const usernameKey = account && (account.username || account.userName) ? (account.username || account.userName) : '';
  // CRITICAL FIX: ALWAYS include accountid in the cache key to prevent token sharing between different accounts
  // Even when accountid is missing, add a placeholder to ensure keys don't collide
  const acctIdPart = account && account.accountid ? `::${account.accountid}` : '::unknown-acct';
  const key = `${account.fiIdentifier}::${usernameKey}${acctIdPart}`;
  if (String(__ENV.DEBUG).toLowerCase() === 'true') console.log(`[TOKEN KEY] Generated cache key: ${key}`);
  return key;
}

// Function to check if a token is available globally
function getGlobalToken(account) {
  const now = Date.now();
  
  // Get user information for better logging
  const username = account && (account.username || account.userName) ? (account.username || account.userName) : 'unknown-user';
  const accountId = account && account.accountid ? account.accountid : 'unknown-acct';
  const orgId = account && account.fiIdentifier ? account.fiIdentifier : 'unknown-org';
  
  // Use a composite cache key per account so tokens are reused per CSV account
  const cacheKey = getCacheKey(account);
  
  // Debug token cache check
  const tokenCacheDebug = String(__ENV.DEBUG_TOKEN_CACHING).toLowerCase() === 'true';
  if (String(__ENV.DEBUG_SINGLE).toLowerCase() === 'true') {
    console.log(`[DEBUG_SINGLE] Looking for token for user ${username} (account ${accountId}, org ${orgId})`);
    console.log(`[DEBUG_SINGLE] Using cache key: ${cacheKey}`);
  } else if (String(__ENV.DEBUG).toLowerCase() === 'true') {
    console.log(`[TOKEN CHECK] Looking for token for user ${username} (account ${accountId}, org ${orgId})`);
    console.log(`[TOKEN CHECK] Using cache key: ${cacheKey}`);
  } else if (tokenCacheDebug) {
    console.log(`[TOKEN CACHE DEBUG] Looking for token with key: ${cacheKey}`);
    console.log(`[TOKEN CACHE DEBUG] localTokenCache has ${Object.keys(localTokenCache).length} entries`);
    if (localTokenCache[cacheKey]) {
      console.log(`[TOKEN CACHE DEBUG] Found token in localTokenCache for ${cacheKey}`);
    } else {
      console.log(`[TOKEN CACHE DEBUG] No token in localTokenCache for ${cacheKey}`);
    }
  }
  
  // Check localTokenCache first, which contains tokens loaded from setup phase
  if (localTokenCache[cacheKey] && localTokenCache[cacheKey].jwToken) {
    // For DEBUG_SINGLE, return the token without validation to simplify debugging
    if (String(__ENV.DEBUG_SINGLE).toLowerCase() === 'true' || tokenCacheDebug) {
      console.log(`[TOKEN CACHE DEBUG] Found cached token for ${cacheKey}! Returning it.`);
      return localTokenCache[cacheKey];
    }
    
    // Simple age-based validation - refresh only when token is older than REFRESH_INTERVAL_MS
    try {
      const nowMs = Date.now();
      const refreshIntervalMs = parseInt(__ENV.REFRESH_INTERVAL_MS || '600000', 10); // default 10 min
      
      // CRITICAL: Use SHARED tokenRefreshState timestamp if available for age calculation
      // This ensures all VUs use the SAME reference timestamp (the last actual refresh time)
      // instead of each VU using its own per-VU cache timestamp which may be stale
      const refreshState = tokenRefreshState[cacheKey];
      const effectiveTimestamp = (refreshState && refreshState.lastRefreshMs) 
        ? refreshState.lastRefreshMs 
        : (localTokenCache[cacheKey].timestamp || 0);
      
      const tokenAgeMs = nowMs - effectiveTimestamp;
      
      // Check if token needs refresh based on age
      if (tokenAgeMs > refreshIntervalMs) {
        // Age threshold exceeded - but check if another VU is already refreshing
        // (enforce cooldown to prevent simultaneous refreshes)
        if (refreshState && refreshState.lastRefreshMs) {
          const timeSinceLastRefreshMs = nowMs - refreshState.lastRefreshMs;
          
          if (timeSinceLastRefreshMs < REFRESH_COOLDOWN_MS) {
            // Another VU refreshed very recently - use existing token
            if (String(__ENV.DEBUG).toLowerCase() === 'true') {
              console.log(`[TOKEN THROTTLE] Token for ${username} aged ${Math.round(tokenAgeMs/1000)}s but refreshed ${Math.round(timeSinceLastRefreshMs/1000)}s ago - cooling down (${REFRESH_COOLDOWN_MS/1000}s)`);
            }
            // Sync our per-VU cache with shared timestamp to prevent re-checking
            localTokenCache[cacheKey].timestamp = refreshState.lastRefreshMs;
            return localTokenCache[cacheKey];
          }
        }
        
        // OK to refresh - trigger it
        if (String(__ENV.DEBUG).toLowerCase() === 'true') {
          console.log(`[TOKEN REFRESH] Token for user ${username} (account ${accountId}, key ${cacheKey}) is too old (${Math.round(tokenAgeMs/1000)}s > ${Math.round(refreshIntervalMs/1000)}s). Triggering refresh.`);
        }
        return null; // signal to caller to refresh token
      }
      
      // Token is still fresh - return it
      if (String(__ENV.DEBUG).toLowerCase() === 'true') {
        console.log(`[TOKEN CACHE] Returning cached token for user ${username} (account ${accountId}, key ${cacheKey}) - age: ${Math.round(tokenAgeMs/1000)}s`);
      }
      
      return localTokenCache[cacheKey];
    } catch (e) {
      // If parsing fails, force a refresh so we don't keep using potentially
      // malformed or expired-looking tokens. Returning null prompts callers
      // to obtain a fresh token immediately.
      console.error(`[TOKEN PARSE] Failed to parse token expiry for ${username} (account ${accountId}); forcing refresh: ${e.message}`);
      return null;
    }
  }
  
  // If we reached here, there's a cache miss - caller will generate a fresh token
  if (String(__ENV.DEBUG_SINGLE).toLowerCase() === 'true') {
    console.warn(`[DEBUG_SINGLE] Token was NOT found in cache for ${cacheKey} - this might indicate a caching issue`);
  } else if (String(__ENV.DEBUG).toLowerCase() === 'true') {
    console.log(`[TOKEN MISS] No cached token found for user ${username} (account ${accountId}, key ${cacheKey})`);
  } else if (tokenCacheDebug) {
    console.warn(`[TOKEN CACHE MISS] No token in cache for ${username} (account ${accountId}) - unexpected!`);
  }

  // Helpful debug: list available cache keys when a miss happens so we can spot key mismatches
  if ((String(__ENV.DEBUG).toLowerCase() === 'true' || tokenCacheDebug) && localTokenCache && typeof localTokenCache === 'object') {
    try {
      console.log(`[TOKEN CACHE DEBUG] Available cache keys (${Object.keys(localTokenCache).length}): ${Object.keys(localTokenCache).join(', ')}`);
    } catch (e) { /* ignore debug failures */ }
  }
  return null;
}

// Function to update the global token cache (via local cache)
// Small helper to parse JWT 'exp' claim (in seconds) and return expiry time in ms
function parseJwtExpiryMs(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = parts[1];
    // JWTs are base64url encoded. Convert to base64 and add padding if necessary
    let b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4;
    if (pad) b64 += '='.repeat(4 - pad);
    const decoded = atob(b64);
    const obj = JSON.parse(decoded);
    if (obj && obj.exp) {
      // Ensure exp is a number (seconds since epoch)
      const expNum = typeof obj.exp === 'number' ? obj.exp : parseInt(obj.exp, 10);
      if (isNaN(expNum)) return null;
      return expNum * 1000; // convert to ms
    }
  } catch (e) {
    // return null on parse errors
  }
  return null;
}

// Parse common JWT numeric timestamp claims (exp, iat) and return ms values
function parseJwtClaims(token) {
  if (!token || typeof token !== 'string') return { expMs: null, iatMs: null };
  try {
    const parts = token.split('.');
    if (parts.length < 2) return { expMs: null, iatMs: null };
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4;
    if (pad) b64 += '='.repeat(4 - pad);
    const decoded = atob(b64);
    const obj = JSON.parse(decoded);
    const expMs = obj && obj.exp ? (typeof obj.exp === 'number' ? obj.exp * 1000 : (isNaN(parseInt(obj.exp, 10)) ? null : parseInt(obj.exp, 10) * 1000)) : null;
    const iatMs = obj && obj.iat ? (typeof obj.iat === 'number' ? obj.iat * 1000 : (isNaN(parseInt(obj.iat, 10)) ? null : parseInt(obj.iat, 10) * 1000)) : null;
    return { expMs, iatMs };
  } catch (e) {
    return { expMs: null, iatMs: null };
  }
}

const testConfig = JSON.parse(open(`../../env/${__ENV.ENVIRONMENT}.json`));


// Determine if the test is for API or BROWSER
const testType = __ENV.TEST_TYPE || 'API'; // Default to API if not specified
const scenarioType = __ENV.SCENARIO_TYPE || 'smoke'; // Default to smoke if not specified

// Gateway selection: allow selecting 'kong' via __ENV.GATEWAY=kong or legacy __ENV.USE_KONG=true
const useKong = __ENV.USE_KONG === 'true' || __ENV.USE_KONG === true;
const rawGateway = __ENV.GATEWAY || (useKong ? 'kong' : 'default');
const GATEWAY = rawGateway === 'kong' ? 'kong' : 'default';

// Select configuration key based on gateway
let baseURL, tokenBaseURL, tokenURL, organizationId;
try {
  const configKey = GATEWAY === 'kong' ? 'd1flex_kong' : 'd1flex';
  console.log(`[GATEWAY CONFIG] USE_KONG=${__ENV.USE_KONG}, GATEWAY=${GATEWAY}, configKey=${configKey}`);
  const cfg = testConfig[configKey];
  if (!cfg) throw new Error(`Missing configuration object '${configKey}' in env/${__ENV.ENVIRONMENT}.json`);

  tokenBaseURL = cfg.tokenBaseURL;
  tokenURL = cfg.tokenURL;
  organizationId = cfg.organizationId;
  baseURL = cfg.baseURL;
  console.log(`[GATEWAY CONFIG] tokenBaseURL=${tokenBaseURL}, baseURL=${baseURL}`);

  if (!baseURL) {
    throw new Error(`Missing baseURL in env/${__ENV.ENVIRONMENT}.json for ${configKey}`);
  }
  if (!tokenBaseURL || !tokenURL || !organizationId) {
    throw new Error(`Missing required token configuration values in env/${__ENV.ENVIRONMENT}.json for ${configKey}`);
  }

  // Default headers to inject for the selected gateway (e.g. Kong expects x-org-id)
  var DEFAULT_GATEWAY_HEADERS = {};
  // Always add x-org-id for Kong compatibility (match bulk_token_check.sh behavior)
  DEFAULT_GATEWAY_HEADERS['x-org-id'] = organizationId;

  // Minimal config logging (only show when DEBUG=true)
  if (String(__ENV.DEBUG).toLowerCase() === 'true') {
    console.log(`[CONFIG] Using config key: ${configKey}`);
    console.log(`[CONFIG] Token URL: ${tokenURL}`);
    console.log(`[CONFIG] API base URL: ${baseURL}`);
    console.log(`[CONFIG] Injecting gateway headers: ${JSON.stringify(DEFAULT_GATEWAY_HEADERS)}`);
  }
} catch (error) {
  console.error('Error reading configuration:', error.message);
  throw error;
}
// Build scenario configuration based on the scenario type and test type
let scenarioConfig;
if (scenarioType === 'custom-tps' || scenarioType === 'custom-vus') {
  scenarioConfig = buildCustomScenario(scenarioType, __ENV.RAMPING_STAGES);
} else {
  scenarioConfig = scenarios[testType][scenarioType];
}

// Allow disabling thresholds for quick DEBUG_SINGLE runs to avoid non-zero exit codes
const effectiveThresholds = (String(__ENV.DEBUG_SINGLE).toLowerCase() === 'true') ? {} : thresholds[testType];

export const options = {
  thresholds: effectiveThresholds,
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


// --- CSV Data Setup (SharedArray for VUs) ---
const csvFilename = __ENV.CSV_FILENAME || 'd1flexapi_perf.csv';

// Build a set of candidate paths to try when opening the CSV. This makes the
// script more flexible: users can pass a simple basename that lives in
// testdata/, or pass a relative path like "../tests/api/valid_tokens_for_k6.csv".
const csvFileCandidates = [];
// If user passed an absolute path, try it first
if (csvFilename && csvFilename.startsWith('/')) csvFileCandidates.push(csvFilename);
// Common default (file under testdata/)
csvFileCandidates.push(`../../testdata/${csvFilename}`);
// If the CSV actually lives under tests/api/ (like tests/api/valid_tokens_for_k6.csv), try that too
csvFileCandidates.push(`../../tests/api/${csvFilename}`);
// Try a path relative to the repo root
csvFileCandidates.push(`../../${csvFilename}`);
// As a last resort try the filename as-is (useful if caller already provided a relative path)
csvFileCandidates.push(csvFilename);

// Default CSV data to use if the file can't be read
const defaultCsvData = 'fiIdentifier,username,password,accountid,customerid\nP111111118,Psql122249642,Password#1,25521,56249';

const parsedCsvData = new SharedArray('shared array', function () {
  try {
    let csvContent = null;
    let lastErr = null;
    for (const candidate of csvFileCandidates) {
      try {
        csvContent = open(candidate);
        if (String(__ENV.DEBUG).toLowerCase() === 'true') console.log(`[k6] Successfully loaded CSV from ${candidate}`);
        break;
      } catch (readError) {
        lastErr = readError;
        if (String(__ENV.DEBUG).toLowerCase() === 'true') console.log(`[k6] Could not read CSV candidate ${candidate}: ${readError}`);
        // try next candidate
      }
    }

    if (!csvContent) {
      if (String(__ENV.DEBUG).toLowerCase() === 'true') console.log(`[k6] Could not read any CSV candidate. Using default data. lastErr=${lastErr}`);
      csvContent = defaultCsvData;
    }

    const result = parseCsvWithHeaders(csvContent);
    if (!result || !Array.isArray(result) || result.length === 0) {
      if (String(__ENV.DEBUG).toLowerCase() === 'true') console.log('[k6] CSV parsing returned empty result, using default data instead');
      return parseCsvWithHeaders(defaultCsvData);
    }
    return result;
  } catch (err) {
    if (String(__ENV.DEBUG).toLowerCase() === 'true') console.error('[k6] Error initializing SharedArray for CSV:', err.message);
    // Fallback to default data on any error
    return parseCsvWithHeaders(defaultCsvData);
  }
});
// Create an iterator for VUs to consume CSV rows
const userIterator = createCsvIterator(parsedCsvData, { selectionMode: __ENV.SELECTION_MODE });
const _firstAccount = parsedCsvData && parsedCsvData.length > 0 ? parsedCsvData[0] : null;

function resolvePassword(account) {
  const raw = account && account.password ? account.password : '';
  const isPlaceholder = /^(REDACTED|PLACEHOLDER|\*{3,})$/i.test(raw) || raw === '';
  if (!isPlaceholder && raw) return raw;
  if (__ENV.TEST_USER_PASSWORD) return __ENV.TEST_USER_PASSWORD;
  if (__ENV.K6_TEST_USER_PASSWORD) return __ENV.K6_TEST_USER_PASSWORD;
  return raw; // may still be placeholder/empty if no override provided
}

if (!_firstAccount || !(_firstAccount.username || _firstAccount.userName)) {
  throw new Error('Startup validation failed: CSV first row must include username.');
}
if (!resolvePassword(_firstAccount)) {
  console.warn('[STARTUP] First account password is missing/placeholder. Provide TEST_USER_PASSWORD env to enable auth.');
}
const commonHeaders = {
  'Accept': 'application/json',
  'security-token': 'SPARC_Flex@071925334',
  'channel': 'Platform',
};

// Define transaction distribution
const transactionDefinitions = [
  { name: 'HistoryTransactions', weight: 45 },
  { name: 'Accounts', weight: 33 },
  { name: 'AccountsContextMenu', weight: 0 },
  { name: 'ConfigurationSignonsecattr', weight: 22 },
  { name: 'ConfigurationArtifacts', weight: 0 }
];

// Transaction executors will be defined after the function declarations


// Setup: Generate tokens for all users upfront to reduce login requests during test
export function setup() {
  const totalUsers = parsedCsvData.length;
  console.log('\n========================================');
  console.log(`[SETUP] Starting token generation for ${totalUsers} CSV users`);
  console.log('[SETUP] This will avoid per-iteration login requests during test execution');
  console.log('========================================\n');
  
  // Create tokens object to be returned and loaded into each VU's localTokenCache
  const tokens = {};
  
  let successCount = 0;
  let failureCount = 0;
  const failedUsers = [];
  
  for (let i = 0; i < parsedCsvData.length; i++) {
    const account = parsedCsvData[i];
    const username = account.username || account.userName || `user-${i}`;
    const accountId = account.accountid || 'no-acct';
    
    try {
      const tokenResult = generateJWTtoken(account);
      if (tokenResult && tokenResult.jwToken) {
        const cacheKey = getCacheKey(account);
        
        if (cacheKey) {
          const tokenTimestamp = Date.now();
          // Add token to our tokens object
          tokens[cacheKey] = {
            jwToken: tokenResult.jwToken,
            timestamp: tokenTimestamp,
            lastRefreshTimestamp: tokenTimestamp, // Initial creation is also the first "refresh"
            // Store normalized cookies (name->value) to ensure serialization is stable
            cookies: normalizeCookiesForStorage(tokenResult.cookies || {}),
            // Add metadata for easier debugging
            username: username,
            accountId: accountId,
            orgId: account.fiIdentifier
          };
          
          // Initialize shared tokenRefreshState for cross-VU coordination
          tokenRefreshState[cacheKey] = {
            lastRefreshMs: tokenTimestamp,
            windowStartMs: tokenTimestamp,
            refreshCount: 1
          };
          
          successCount++;
          
          // Log token generation in setup when DEBUG or DEBUG_SINGLE is enabled
          if (String(__ENV.DEBUG).toLowerCase() === 'true' || String(__ENV.DEBUG_SINGLE).toLowerCase() === 'true') {
            console.log(`[SETUP] ✓ Generated token ${successCount}/${totalUsers} for user ${username} (account ${accountId}), cache key: ${cacheKey}`);
          }
        } else {
          console.error(`[SETUP] ✗ Failed to generate cache key for user ${username} (account ${accountId})`);
          failureCount++;
          failedUsers.push(`${username} (no cache key)`);
        }
      } else {
        console.error(`[SETUP] ✗ Failed to get token for user ${username} (account ${accountId}) - tokenResult: ${tokenResult ? 'no jwToken' : 'null'}`);
        failureCount++;
        failedUsers.push(`${username} (${accountId})`);
      }
    } catch (e) {
      console.error(`[SETUP] ✗ Exception generating token for user ${username} (account ${accountId}): ${e.message}`);
      failureCount++;
      failedUsers.push(`${username} (${accountId}): ${e.message}`);
    }
  }
  
  console.log('\n========================================');
  console.log('[SETUP] Token generation complete:');
  console.log(`[SETUP]   ✓ Success: ${successCount}/${totalUsers}`);
  console.log(`[SETUP]   ✗ Failed:  ${failureCount}/${totalUsers}`);
  console.log(`[SETUP]   📦 Tokens in cache: ${Object.keys(tokens).length}`);
  
  if (failureCount > 0) {
    console.error(`[SETUP] ⚠️  WARNING: ${failureCount} token generation failures detected!`);
    console.error(`[SETUP] Failed users: ${failedUsers.slice(0, 5).join(', ')}${failedUsers.length > 5 ? ` ... and ${failedUsers.length - 5} more` : ''}`);
  }
  
  console.log('========================================\n');
  
  // Return the tokens object which will be passed to the default function
  return { tokens };
}

// Function to log token and retry configuration for debugging
function logTokenConfig() {
  if (String(__ENV.DEBUG).toLowerCase() === 'true') {
    dlog('\n[TOKEN CONFIG] Current token and retry settings:');
  dlog(`- TOKEN_MAX_RETRIES: ${__ENV.TOKEN_MAX_RETRIES || '2'} (default: 2)`);
    dlog(`- TOKEN_RETRY_DELAY_MS: ${__ENV.TOKEN_RETRY_DELAY_MS || '500'} (default: 500ms)`);
    dlog(`- API_RETRY_COUNT: ${__ENV.API_RETRY_COUNT || '3'} (default: 3)`);
  dlog(`- REFRESH_INTERVAL_MS: ${__ENV.REFRESH_INTERVAL_MS || '600000'} (default: 10min)`);
    dlog(`- BYPASS_DEVICE_AUTH: ${__ENV.BYPASS_DEVICE_AUTH || 'false'}`);
    dlog('- FALLBACK features are disabled in this configuration');
    dlog(`- USE_KONG: ${__ENV.USE_KONG || 'true'}\n`);
  }
}

// Simple function to run a token generation and history transaction in the most straightforward way
function runSimpleFlow(account) {
  console.log('[SIMPLE] Starting simple flow with direct token generation and transaction');
  
  try {
    // Step 1: Generate token with direct response access
    console.log('[SIMPLE] Step 1: Generating token for', account.username || account.userName);
    const tokenResult = generateJWTtoken(account);
    const token = tokenResult.jwToken;
    const cookies = tokenResult.cookies;
    
    if (!token) {
      console.error('[SIMPLE] Failed to obtain token');
      return;
    }
    
    console.log('[SIMPLE] Token obtained:', token.substring(0, 20) + '...');
    console.log('[SIMPLE] Cookies captured:', Object.keys(cookies || {}).join(', '));
    
    // Step 2: Run history transaction using direct token and cookies
    console.log('[SIMPLE] Step 2: Running history transaction');
    
    const url = `${baseURL}/cuflex/ExternalApp/Authentication/AcctTransactionHistoryInqSVC`;
    const payload = {
      _credentials: {
        _deviceToken: 'MglCcm93c2VyCTIJdW5rbm93bgkyCTEJMmU0YWFmM2VhMjM2M2JmY2M0ZmFhZWFkYjVjOGNjMWMJZGlnaXRhbEJBTktJTkctMS4wLjAuMAkJMjAyNS0wNi0wNlQwNjoxNjo1OC43NTNaCQlBY2N0VHJhbnNhY3Rpb25IaXN0b3J5SW5xU1ZDCQllbgk3MGRhN2FlZC1mYTkzLTRhMmEtOWQ2NS1mNGJjZDY0MWU2ZGQ='
      },
      _p: `${account.accountid},DD,${account.fiIdentifier},${account.customerid}`,
      _operation: 'GET',
      _op: '&status=Both',
      businessContext: null,
      _lang: 'en'
    };
    
    // Build simple headers with all cookies
    const headers = { 
      'authorization': `Bearer ${token}`,
      'authenticationType': 'JWT',
      'channel': 'mobile',
      'Content-Type': 'application/json',
      'organization-id': account.fiIdentifier || organizationId
    };
    
    // Add all cookies directly
    let cookieHeader = '';
    for (const [name, arr] of Object.entries(cookies)) {
      if (Array.isArray(arr) && arr.length > 0 && arr[0].value) {
        if (cookieHeader) cookieHeader += '; ';
        cookieHeader += `${name}=${arr[0].value}`;
      }
    }
    
    if (cookieHeader) {
      headers['Cookie'] = cookieHeader;
      console.log('[SIMPLE] Cookie header:', cookieHeader);
    }
    
    console.log('[SIMPLE] Sending request to:', url);
    const res = http.post(url, JSON.stringify(payload), { headers });
    
    console.log('[SIMPLE] Response status:', res.status);
    try {
      const body = res.json ? res.json() : (res.body ? JSON.parse(res.body) : null);
      const statusCode = body && body.status && body.status.code !== undefined ? body.status.code : 
                        (body && body.statusCode !== undefined ? body.statusCode : null);
      console.log('[SIMPLE] Business status code:', statusCode);
      
      if (statusCode === 0 || statusCode === 300) {
        console.log('[SIMPLE] SUCCESS! Transaction completed with business status:', statusCode);
      } else {
        console.error('[SIMPLE] ERROR: Transaction failed with business status:', statusCode);
      }
    } catch (e) {
      console.error('[SIMPLE] Error parsing response:', e.message);
      console.log('[SIMPLE] Raw response body:', res.body ? res.body.substring(0, 200) + '...' : '<no body>');
    }
    
  } catch (e) {
    console.error('[SIMPLE] Error in simple flow:', e.message);
  }
}

export default function (setupData) {
  // CRITICAL FIX: Load tokens from setup phase into localTokenCache FIRST (before any code uses getGlobalToken)
  // This MUST run before any token lookups happen to avoid cache misses on first iteration
  if (__ITER === 0) {
    // Validate setupData was passed correctly
    if (!setupData) {
      console.error(`[TOKEN LOAD ERROR] setupData is undefined/null for VU ${__VU}! Setup phase may have failed or not returned data.`);
    } else if (!setupData.tokens) {
      console.error(`[TOKEN LOAD ERROR] setupData.tokens is missing for VU ${__VU}! Setup returned: ${JSON.stringify(Object.keys(setupData))}`);
    } else if (Object.keys(setupData.tokens).length === 0) {
      console.error(`[TOKEN LOAD ERROR] setupData.tokens is empty for VU ${__VU}! Setup generated 0 tokens.`);
    } else {
      // Setup data is valid - load tokens into this VU's localTokenCache
      const tokenCount = Object.keys(setupData.tokens).length;
      
      // Always log token loading for first iteration to confirm it happened
      if (String(__ENV.DEBUG).toLowerCase() === 'true' || String(__ENV.DEBUG_SINGLE).toLowerCase() === 'true' || String(__ENV.DEBUG_TOKEN_CACHING).toLowerCase() === 'true') {
        console.log(`[TOKEN LOAD] VU ${__VU} loading ${tokenCount} tokens from setup into localTokenCache`);
      }
      
      // Copy all tokens from setupData directly into localTokenCache
      // Use Object.assign to merge (preserving any existing tokens, though there shouldn't be any on first iteration)
      localTokenCache = Object.assign({}, setupData.tokens);
      
      // Verify the copy succeeded
      const loadedCount = Object.keys(localTokenCache).length;
      if (loadedCount !== tokenCount) {
        console.error(`[TOKEN LOAD ERROR] VU ${__VU} token copy failed! Expected ${tokenCount} tokens, got ${loadedCount} in localTokenCache`);
      } else if (String(__ENV.DEBUG).toLowerCase() === 'true' || String(__ENV.DEBUG_SINGLE).toLowerCase() === 'true') {
        console.log(`[TOKEN LOAD] VU ${__VU} successfully loaded ${loadedCount} tokens into localTokenCache`);
      }
    }
  }
  
  // Now get the account for this iteration (after tokens are loaded)
  const account = userIterator.next();
  if (!account) { 
    dwarn('No account data available. Check if CSV file is properly loaded.'); 
    return; 
  }
  
  // Log the account info for debugging
  if (String(__ENV.DEBUG).toLowerCase() === 'true' || String(__ENV.DEBUG_SINGLE).toLowerCase() === 'true') {
    const username = account && (account.username || account.userName) ? (account.username || account.userName) : 'unknown-user';
    const accountId = account && account.accountid ? account.accountid : 'unknown-acct';
    const orgId = account && account.fiIdentifier ? account.fiIdentifier : 'unknown-org';
    const cacheKey = getCacheKey(account);
    
    console.log(`[VU ${__VU}] Processing account: user=${username}, accountId=${accountId}, org=${orgId}`);
    console.log(`[VU ${__VU}] Using cache key: ${cacheKey}`);
  }
  
  // First VU logs the token configuration
  if (__VU === 1 && __ITER === 0) {
    logTokenConfig();
  }
  
  // If SIMPLE_FLOW=true, run the simplest possible token+transaction flow
  if (String(__ENV.SIMPLE_FLOW).toLowerCase() === 'true') {
    console.log('[SIMPLE_FLOW] Running simple token+transaction flow with direct access');
    try {
      runSimpleFlow(account);
    } catch (e) {
      console.error('[SIMPLE_FLOW] Error during simple flow:', e.message);
    }
    return;
  }
  
  // Log environment and configuration information only when DEBUG=true and only for first VU/iteration
  if (String(__ENV.DEBUG).toLowerCase() === 'true' && __VU === 1 && __ITER === 0) {
    dlog(`[CONFIG] Environment: ${__ENV.ENVIRONMENT}, Scenario: ${__ENV.SCENARIO_TYPE || 'smoke'}, Script: ${__ENV.SCRIPT_NAME || 'd1flexKongAPI'}`);
    dlog('[DYNATRACE] Adding correlation headers for Dynatrace monitoring');
  }
  
  // If DEBUG_SINGLE is set, run a single token call and a single History_Transactions call
  if (String(__ENV.DEBUG_SINGLE).toLowerCase() === 'true') {
    console.log('[DEBUG_SINGLE] Running debug single flow with cache check first');
    
    const cacheKey = getCacheKey(account);
    const username = account && (account.username || account.userName) ? (account.username || account.userName) : 'unknown-user';
    const accountId = account && account.accountid ? account.accountid : 'unknown-acct';
    
    // First, check if a token exists in the cache from setup phase
    console.log(`[DEBUG_SINGLE] Checking if token exists in cache for ${cacheKey}`);
    
    // Try to get a token from the cache (will sync from global cache if needed)
    const cachedToken = getGlobalToken(account);
    
    if (cachedToken && cachedToken.jwToken) {
      console.log(`[DEBUG_SINGLE] SUCCESS! Found token in cache for ${username} (account ${accountId})`);
      console.log('[DEBUG_SINGLE] Using cached token for History transaction...');
      
      try {
        // Use cached token for history transaction
        executeHistoryTransactions(account);
      } catch (e) {
        console.error(`[DEBUG_SINGLE] Error executing History_Transactions with cached token: ${e.message}`);
      }
    } else {
      console.warn(`[DEBUG_SINGLE] No token found in cache for ${username} (account ${accountId})`);
      console.log('[DEBUG_SINGLE] Generating fresh token and running History transaction...');
      
      try {
        runDebugSingle(account);
      } catch (e) {
        console.error(`[DEBUG_SINGLE] Error during debug single flow: ${e.message}`);
      }
    }
    return;
  }

  transactionManager.selectAndExecuteTransaction(account);
};


// Helper function to parse all cookies from Set-Cookie header
function parseSetCookieHeader(headers) {
  const cookies = {};
  if (!headers || typeof headers !== 'object') return cookies;

  // Accept both 'Set-Cookie' and 'set-cookie' (k6 may present headers in lowercase)
  let setCookieHeader = headers['Set-Cookie'] || headers['set-cookie'] || headers['set_cookie'] || null;

  // Debug the headers
  if (String(__ENV.DEBUG).toLowerCase() === 'true') {
    console.log(`[COOKIE PARSE] Examining headers: ${Object.keys(headers).join(', ')}`);
    if (setCookieHeader) {
      console.log(`[COOKIE PARSE] Found Set-Cookie header: ${typeof setCookieHeader} type`);
    } else {
      console.log('[COOKIE PARSE] No Set-Cookie header found in response headers');
    }
  }

  // k6 may expose multiple Set-Cookie headers as an array or a single string
  const cookieHeaderValues = [];
  if (Array.isArray(setCookieHeader)) {
    cookieHeaderValues.push(...setCookieHeader);
    if (String(__ENV.DEBUG).toLowerCase() === 'true') {
      console.log(`[COOKIE PARSE] Found ${setCookieHeader.length} Set-Cookie headers as array`);
    }
  } else if (typeof setCookieHeader === 'string') {
    // Sometimes multiple cookies are concatenated into a single header string
    // Split by comma only when it separates cookie-name=value pairs
    const parts = setCookieHeader.split(/,\s*(?=[a-zA-Z0-9_-]+=)/);
    cookieHeaderValues.push(...parts);
    if (String(__ENV.DEBUG).toLowerCase() === 'true') {
      console.log(`[COOKIE PARSE] Split Set-Cookie header into ${parts.length} parts`);
    }
  }

  // Look through all headers for cookie headers - sometimes they're not under Set-Cookie
  for (const [headerName, headerValue] of Object.entries(headers)) {
    if (headerName.toLowerCase().includes('cookie') && 
        headerName.toLowerCase() !== 'set-cookie' && 
        headerName.toLowerCase() !== 'cookie') {
      if (String(__ENV.DEBUG).toLowerCase() === 'true') {
        console.log(`[COOKIE PARSE] Found additional cookie header: ${headerName}`);
      }
      
      if (typeof headerValue === 'string') {
        cookieHeaderValues.push(headerValue);
      } else if (Array.isArray(headerValue)) {
        cookieHeaderValues.push(...headerValue);
      }
    }
  }

  if (String(__ENV.DEBUG).toLowerCase() === 'true') {
    console.log(`[COOKIE PARSE] Processing ${cookieHeaderValues.length} cookie header values`);
  }

  for (const cookieString of cookieHeaderValues) {
    if (!cookieString || typeof cookieString !== 'string') continue;
    try {
      const parts = cookieString.trim().split(';');
      const nameValue = parts[0].split('=');
      if (nameValue.length >= 2) {
        const name = nameValue[0].trim();
        const value = nameValue.slice(1).join('=').trim(); // Handle values containing =

        // Extract cookie attributes from the string
        let path = '/';
        let domain = '';
        let maxAge = null;
        let expires = null;
        let secure = false;
        let httpOnly = false;
        
        for (let i = 1; i < parts.length; i++) {
          const partTrim = parts[i].trim().toLowerCase();
          if (partTrim.startsWith('path=')) {
            path = parts[i].trim().substring(5).trim();
          } else if (partTrim.startsWith('domain=')) {
            domain = parts[i].trim().substring(7).trim();
          } else if (partTrim.startsWith('max-age=')) {
            maxAge = parseInt(parts[i].trim().substring(8).trim(), 10);
          } else if (partTrim.startsWith('expires=')) {
            expires = parts[i].trim().substring(8).trim();
          } else if (partTrim === 'secure') {
            secure = true;
          } else if (partTrim === 'httponly') {
            httpOnly = true;
          }
        }

        // Store the cookie in k6-compatible format
        cookies[name] = [{
          name: name,
          value: value,
          domain: domain,
          path: path || '/',
          secure: secure || cookieString.toLowerCase().includes('secure'),
          http_only: httpOnly || cookieString.toLowerCase().includes('httponly'),
          max_age: maxAge || 0,
          expires: expires ? Date.parse(expires) : -6795364578871
        }];
        
        if (String(__ENV.DEBUG).toLowerCase() === 'true') {
          console.log(`[COOKIE PARSE] Parsed cookie: ${name}=${value.substring(0, Math.min(10, value.length))}... path=${path} domain=${domain || 'none'}`);
        }
      }
    } catch (e) {
      if (String(__ENV.DEBUG).toLowerCase() === 'true') {
        console.error(`[COOKIE PARSE] Error parsing cookie: ${e.message}`);
      }
    }
  }

  if (String(__ENV.DEBUG).toLowerCase() === 'true') {
    console.log(`[COOKIE PARSE] Parsed ${Object.keys(cookies).length} cookies total`);
    if (Object.keys(cookies).length > 0) {
      console.log(`[COOKIE PARSE] Cookie names: ${Object.keys(cookies).join(', ')}`);
    }
  }

  return cookies;
}

// Normalize cookies into a simple name->value map for safe storage/serialization
// Accepts k6-style cookies (name -> [{ name, value, ... }]) or header-parsed objects
function normalizeCookiesForStorage(rawCookies) {
  const normalized = {};
  try {
    if (!rawCookies || typeof rawCookies !== 'object') return normalized;

    for (const name of Object.keys(rawCookies)) {
      const entry = rawCookies[name];
      if (!entry) continue;

      // k6 format: array of cookie objects
      if (Array.isArray(entry) && entry.length > 0) {
        const first = entry[0];
        if (first && typeof first === 'object') {
          if (typeof first.value === 'string') normalized[name] = first.value;
          else if (typeof first.val === 'string') normalized[name] = first.val;
          else if (typeof first === 'string') normalized[name] = first;
        } else if (typeof entry[0] === 'string') {
          normalized[name] = entry[0];
        }
      } else if (typeof entry === 'string') {
        // Already a simple string value
        normalized[name] = entry;
      } else if (typeof entry === 'object') {
        // Might be a parsed Set-Cookie entry or single cookie object
        if (typeof entry.value === 'string') normalized[name] = entry.value;
        else if (Array.isArray(entry) && entry.length > 0 && typeof entry[0] === 'string') normalized[name] = entry[0];
      }
    }
  } catch (e) {
    if (String(__ENV.DEBUG).toLowerCase() === 'true') console.error(`[COOKIE NORMALIZE] Error normalizing cookies: ${e.message}`);
  }
  return normalized;
}

// JWT token generation function
function generateJWTtoken(account) {
  try {
    const orgKeyLog = account && account.fiIdentifier ? account.fiIdentifier : 'unknown-org';
    if (DEBUG_ENABLED) dlog(`[TOKEN] generateJWTtoken called by VU ${typeof __VU !== 'undefined' ? __VU : '?'} for org ${orgKeyLog}`);
    // Get the user and account identifiers for better logging
    const username = account && (account.username || account.userName) ? (account.username || account.userName) : 'unknown-user';
    const accountId = account && account.accountid ? account.accountid : 'unknown-acct';
    const cacheKey = getCacheKey(account);
    
    // Use the selected tokenURL from configuration (respects gateway selection)
    const url = tokenURL;
    
    // Prepare the payload
    // Use only values from the CSV account object. Accept either `username` or `userName` header.
    const password = resolvePassword(account);

    if (!username) {
      throw new Error('Missing username on account object from CSV.');
    }
    if (!password) {
      throw new Error('Missing password (placeholder and no override). Set TEST_USER_PASSWORD env.');
    }

    // Generate a unique session ID for this request
    const sessionId = `CID=${randomString(32)};tmSessionId=TMX;webSessionId=${randomString(24)};deviceId=${generateUuidV4()};`;
    
    function randomString(length) {
      const chars = '0123456789abcdef';
      let result = '';
      for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return result;
    }

    const payload = JSON.stringify({
      data: {
        password: password,
        userName: username,
        sessionId: sessionId
      }
    });
    
    // Build headers with Dynatrace correlation
    const scenarioType = __ENV.SCENARIO_TYPE || 'smoke';
    const scriptName = __ENV.SCRIPT_NAME || 'd1flexKongAPI';
    const dynatraceHeader = buildDynatraceHeader('Login', scriptName, scenarioType);
    
    // Build headers to match working simple_token_history.js headers
    // Start with base headers and gateway defaults
    const headers = {
      'Content-Type': 'application/json',
      'channel': 'DIG_FLX_INT_MOB', // Token endpoint uses DIG_FLX_INT_MOB
      'uuid': generateUuidV4(),
      ...dynatraceHeader  // Include Dynatrace header on login
    };
    
    // Merge any additional gateway-specific headers if configured
    if (typeof DEFAULT_GATEWAY_HEADERS !== 'undefined' && DEFAULT_GATEWAY_HEADERS) {
      Object.assign(headers, DEFAULT_GATEWAY_HEADERS);
    }
    
    // CSV-based org ID takes precedence over environment config
    // Set these AFTER merging DEFAULT_GATEWAY_HEADERS to ensure CSV values win
    const effectiveOrgId = account.fiIdentifier || organizationId;
    headers['organization-id'] = effectiveOrgId;
    headers['x-org-id'] = effectiveOrgId;
    
    if (String(__ENV.DEBUG).toLowerCase() === 'true') console.log(`[TOKEN] Token request for ${username} (account ${accountId}, org ${effectiveOrgId})`);

    // One-time debug: log the token request details only when DEBUG=true
    if (!TOKEN_REQUEST_LOGGED && String(__ENV.DEBUG).toLowerCase() === 'true') {
      try {
        dlog('[TOKEN REQUEST DEBUG] URL:', url);
        dlog('[TOKEN REQUEST DEBUG] HEADERS:', JSON.stringify(headers));
        dlog('[TOKEN REQUEST DEBUG] PAYLOAD:', payload);
      } catch (e) {
        // ignore logging errors
      }
      TOKEN_REQUEST_LOGGED = true;
    }
    
    // Add transaction tag for Login and allow a small retry loop for transient errors
    const retryCount = parseInt(__ENV.TOKEN_MAX_RETRIES || '2', 10); // Default to 2
    const retryDelayMs = parseInt(__ENV.TOKEN_RETRY_DELAY_MS || '500', 10); // Default to 500ms
    let jwToken = null;
    let res = null;
    let cookies = {};
    let lastErrorMsg = null;
    
    // No preset/fallback tokens allowed: require real tokens from the auth API
    
    // First step: Initial login attempt with multiple retries
    for (let attempt = 0; attempt < Math.max(1, retryCount); attempt++) {
      if (attempt > 0) {
        dlog(`[JWT TOKEN][RETRY] Attempt ${attempt + 1}/${retryCount} for username ${username}`);
      }
      
      try {
        // Don't use transaction tag during setup() phase, only during actual user iterations
        // This ensures we don't count setup token generation in Login metrics
        const options = { isTokenGeneration: true };
        
        // Only add the 'Login' transaction tag during actual test execution, not during setup
        // AND only when we're not inside the setup() function
        // Check for __VU being defined AND check if we're not inside a setup context
        if (typeof __VU !== 'undefined' && typeof __ITER !== 'undefined') {
          console.log(`[TOKEN] Adding Login transaction tag for ${username} (actual API call during test)`);
          options.tags = { transaction: 'Login' };
        } else {
          // If in setup or not in a test VU context, don't add the transaction tag
          console.log(`[TOKEN] Not adding Login transaction tag for ${username} (setup context)`);
        }
        
        const result = createJwtToken(url, payload, headers, options);
        jwToken = result.jwToken;
        res = result.res;
        
        // Extract cookies from login response - they ARE required for maintaining session context
        if (res && res.cookies) {
          cookies = res.cookies;
          if (String(__ENV.DEBUG).toLowerCase() === 'true') console.log(`[TOKEN] Extracted ${Object.keys(cookies).length} cookies from login response for ${username}`);
        }
        
        // Minimal extraction: if createJwtToken didn't return jwToken, try the simple path
        // expected by collectors: response.data.jwToken
        if (!jwToken && res) {
          try {
            const body = res.json ? res.json() : (res.body ? JSON.parse(res.body) : null);
            if (body && body.data && body.data.jwToken) {
              jwToken = body.data.jwToken;
              if (String(__ENV.DEBUG).toLowerCase() === 'true') console.log(`[TOKEN] Extracted jwToken from response.data.jwToken for ${username}`);
            }
          } catch (e) {
            // ignore parse errors - we'll continue retry/backoff logic
          }
        }
        
        if (jwToken) {
          // Success - we got a token directly
          if (String(__ENV.DEBUG).toLowerCase() === 'true') console.log(`[TOKEN] Successfully obtained JWT token for ${username} (account ${accountId}) on attempt ${attempt + 1}`);
          break;
        }
        
        // If we got a 200 but no jwToken, check if it's a multi-step auth flow
        if (res && res.status === 200) {
          try {
            const body = res.json ? res.json() : null;
            
            // COOKIES REMOVED: Testing confirmed cookies are NOT required
            
            // Check if we need to complete a device validation step
            if (body && body.data && body.data.authenticationSteps && 
                body.data.authenticationSteps.nextstep && 
                body.data.authenticationSteps.nextstep.id === 'devices') {
              
              if (String(__ENV.DEBUG).toLowerCase() === 'true') console.warn('[JWT CHALLENGE] Login response requires next step: devices. Not implemented: this authentication flow requires multi-step authentication including device selection.');
              
              // BYPASS_DEVICE_AUTH is enabled: we won't synthesize tokens here. Return failure so caller can skip.
              if (__ENV.BYPASS_DEVICE_AUTH && __ENV.BYPASS_DEVICE_AUTH.toLowerCase() === 'true') {
                if (String(__ENV.DEBUG).toLowerCase() === 'true') console.log('[TOKEN] BYPASS_DEVICE_AUTH enabled but bypass tokens are disallowed in strict mode; returning null');
                return { jwToken: null, res };
              }
            }
          } catch (e) {
            lastErrorMsg = e.message;
            console.error(`[TOKEN] Error parsing authentication response: ${e.message}`);
          }
        }
      } catch (reqError) {
        // Handle network errors or other exceptions during the request
        lastErrorMsg = reqError.message;
        console.error(`[TOKEN] Error during token request (attempt ${attempt + 1}): ${reqError.message}`);
      }
      
      // If not found or multi-step auth required, wait before retrying with increasing backoff
      if (attempt + 1 < retryCount) {
        const backoffDelay = retryDelayMs * Math.pow(1.5, attempt); // exponential backoff
        const cappedDelay = Math.min(backoffDelay, 5000); // cap at 5 seconds
        try { 
          sleep(cappedDelay / 1000); 
        } catch (e) { /* no-op in init */ }
      }
    }
    
    // Check for fallback token if all retries failed
    if (!jwToken) {
      // If we got a 200 but no jwToken, log a helpful message when the response indicates a device challenge
      try {
        if (res && res.status === 200) {
          const body = res.json ? res.json() : null;
          if (body && body.data && body.data.authenticationSteps && body.data.authenticationSteps.nextstep && body.data.authenticationSteps.nextstep.id) {
            if (String(__ENV.DEBUG).toLowerCase() === 'true') {
              console.warn(`[JWT CHALLENGE] Login response requires next step: ${body.data.authenticationSteps.nextstep.id}`);
              console.warn(`[JWT TOKEN][MAX RETRIES] Failed after ${retryCount} attempts for username ${username}`);
            }
          }
        } else if (res) {
          if (String(__ENV.DEBUG).toLowerCase() === 'true') console.warn(`[TOKEN ERROR] Failed to generate token for ${username} after ${retryCount} attempts - status: ${res.status}`);
        } else {
          if (String(__ENV.DEBUG).toLowerCase() === 'true') console.warn(`[TOKEN ERROR] Failed to generate token for ${username} after ${retryCount} attempts - no response`);
        }
        
        // No fallback: if retries exhausted, we'll return null to indicate failure
      } catch (e) {
        console.warn(`[TOKEN ERROR] Failed to process token response: ${e.message}`);
      }
    }
    
    return { jwToken, res, cookies };
  } catch (error) {
    const username = account && (account.username || account.userName);
    if (String(__ENV.DEBUG).toLowerCase() === 'true') console.error(`[JWT ERROR] Error generating JWT token for ${username}: ${error.message}`);
    
    // No fallback on error: return null result so caller must handle missing token
    return { jwToken: null, res: null, cookies: {} };
  }
}

// Helper to run a single token request and then a History_Transactions call for debugging
function runDebugSingle(account) {
  // Get user information for better logging
  const username = account && (account.username || account.userName) ? (account.username || account.userName) : 'unknown-user';
  const accountId = account && account.accountid ? account.accountid : 'unknown-acct';
  const orgId = account && account.fiIdentifier ? account.fiIdentifier : 'unknown-org';
  const cacheKey = getCacheKey(account);
  
  // Force verbose logging
  try {
    console.log(`[DEBUG_SINGLE] Starting token request for user ${username} (account ${accountId}, org ${orgId})`);
    console.log(`[DEBUG_SINGLE] Using cache key: ${cacheKey}`);
    
    // First check localTokenCache which should have been seeded from setup
    console.log('[DEBUG_SINGLE] Checking if token exists in localTokenCache first...');
    if (localTokenCache && Object.keys(localTokenCache).length > 0) {
      if (localTokenCache[cacheKey]) {
        console.log(`[DEBUG_SINGLE] Found token in LOCAL cache for ${cacheKey}!`);
      } else {
        console.log(`[DEBUG_SINGLE] Token NOT found in LOCAL cache for ${cacheKey}`);
      }
      // List local cache keys for debugging
      console.log(`[DEBUG_SINGLE] Local cache contains ${Object.keys(localTokenCache).length} tokens`);
      console.log(`[DEBUG_SINGLE] Local cache keys: ${Object.keys(localTokenCache).join(', ')}`);
    }
    
    // Check local cache too
    if (localTokenCache[cacheKey]) {
      console.log(`[DEBUG_SINGLE] Found token in LOCAL cache for ${cacheKey}!`);
    } else {
      console.log(`[DEBUG_SINGLE] Token NOT found in LOCAL cache for ${cacheKey}`);
    }
    
    // Log what's in local cache
    console.log(`[DEBUG_SINGLE] Local cache contains ${Object.keys(localTokenCache).length} tokens`);
    if (Object.keys(localTokenCache).length > 0) {
      console.log(`[DEBUG_SINGLE] Local cache keys: ${Object.keys(localTokenCache).join(', ')}`);
    }
  } catch (e) { /* ignore */ }
  
  // Generate a fresh token
  console.log(`[DEBUG_SINGLE] Generating fresh token for ${username}`);
  const tokenResult = generateJWTtoken(account);
  
  try {
    if (tokenResult && tokenResult.res) {
      console.log('[DEBUG_SINGLE] Token response status:', tokenResult.res.status);
      try { console.log('[DEBUG_SINGLE] Token response headers:', JSON.stringify(tokenResult.res.headers)); } catch (e) {}
      try { console.log('[DEBUG_SINGLE] Token response body:', tokenResult.res.body ? tokenResult.res.body : '<no-body>'); } catch (e) {}
      // Force a detailed dump for token responses in debug-single mode to retain full context
      dumpResponse(tokenResult.res, 'Token_Response', true);
    }
    
    if (tokenResult && tokenResult.jwToken) {
      console.log('[DEBUG_SINGLE] Obtained jwToken length:', tokenResult.jwToken.length);
      
      // Update the token in the cache directly
      const username = account && (account.username || account.userName) ? (account.username || account.userName) : 'unknown-user';
      const accountId = account && account.accountid ? account.accountid : 'unknown-acct';
      const refreshTimestamp = Date.now();
      localTokenCache[cacheKey] = {
        jwToken: tokenResult.jwToken,
        timestamp: refreshTimestamp,
        lastRefreshTimestamp: refreshTimestamp, // Track when token was last refreshed (per-VU)
        username: username,
        accountId: accountId,
        orgId: account.fiIdentifier,
        cookies: normalizeCookiesForStorage(tokenResult.cookies || {})
      };
      
      // Update shared tokenRefreshState for cross-VU coordination
      if (!tokenRefreshState[cacheKey]) {
        tokenRefreshState[cacheKey] = { lastRefreshMs: 0, windowStartMs: refreshTimestamp, refreshCount: 0 };
      }
      tokenRefreshState[cacheKey].lastRefreshMs = refreshTimestamp;
      tokenRefreshState[cacheKey].refreshCount = (tokenRefreshState[cacheKey].refreshCount || 0) + 1;
      
      console.log(`[DEBUG_SINGLE] Updated token in cache for ${cacheKey}`);
      
      // Check if the token was stored in the cache
      const cachedToken = getGlobalToken(account);
      if (cachedToken) {
        console.log(`[DEBUG_SINGLE] Token was properly stored in cache for ${cacheKey}`);
      } else {
        console.warn(`[DEBUG_SINGLE] Token was STILL NOT found in cache for ${cacheKey} - this indicates a severe caching issue`);
      }
    } else {
      console.warn('[DEBUG_SINGLE] No jwToken obtained from token request');
    }
  } catch (e) {
    console.error('[DEBUG_SINGLE] Error logging token result:', e.message);
  }

  // Now run the history transaction (it will itself log the request/response when DEBUG=true)
  try {
    console.log('[DEBUG_SINGLE] Now executing History_Transactions with the fresh token');
    executeHistoryTransactions(account);
  } catch (e) {
    console.error('[DEBUG_SINGLE] Error executing History_Transactions:', e.message);
  }
}

// Debug helper: call History_Transactions with a provided token but no cookies to validate server behavior
// runDebugHardcodedHistory removed - hardcoded-token experiments are deprecated in favour of real token flow

// Function to get or refresh a JWT token - Use cached token until it expires or gets 401
function getOrRefreshJWT(account, forceRefresh = false) {
  const cacheKey = getCacheKey(account);
  
  // Get user information for better logging
  const username = account && (account.username || account.userName) ? (account.username || account.userName) : 'unknown-user';
  const accountId = account && account.accountid ? account.accountid : 'unknown-acct';
  const orgId = account && account.fiIdentifier ? account.fiIdentifier : 'unknown-org';
  
  if (!cacheKey) {
    console.error(`[TOKEN ERROR] Invalid account object, cannot generate cache key for ${username}`);
    return null;
  }
  
  // Enable token cache debugging with DEBUG_TOKEN_CACHING=true
  const tokenCacheDebug = String(__ENV.DEBUG_TOKEN_CACHING).toLowerCase() === 'true';
  
  // IMPORTANT: First check if this is the first test iteration for this VU
  // If so, we should be using the tokens from setup phase to avoid generating new ones
  if (!forceRefresh) {
    // Check for cached token from setup phase first
    const cachedToken = getGlobalToken(account);
    if (cachedToken) {
      if (DEBUG_ENABLED || tokenCacheDebug) {
        console.log(`[TOKEN CACHE HIT] Using cached token for ${username} (account ${accountId}, org ${orgId})`);
      }
      return cachedToken;
    }
    
    // No need to generate new token in normal test flow - this should rarely happen
    // since tokens should have been generated in setup
    if (DEBUG_ENABLED || tokenCacheDebug) {
      console.warn(`[TOKEN CACHE MISS] No token in cache for ${username} (account ${accountId}) - unexpected!`);
    }
  } else if (DEBUG_ENABLED || tokenCacheDebug) {
    console.log(`[TOKEN] Force refresh explicitly requested for ${username} (account ${accountId}, key ${cacheKey})`);
  }
  
  // Generate fresh token only when explicitly forced or when cache is empty
  if (DEBUG_ENABLED || tokenCacheDebug) console.log(`[TOKEN] Generating fresh token for ${username} (account ${accountId}) ${forceRefresh ? '(forced refresh)' : '(cache miss/expired)'}`);
  
  let newToken = null;
  let newCookies = {};
  try {
    // When generating a token during the actual test execution (not setup),
    // make sure we mark this as a real token generation call
    // This will ensure it gets tagged with the 'Login' transaction
    const tokenResult = generateJWTtoken(account);
    newToken = tokenResult && tokenResult.jwToken ? tokenResult.jwToken : null;
    newCookies = tokenResult && tokenResult.cookies ? tokenResult.cookies : {};
    
    if (newToken) {
      // Store token and cookies in localTokenCache (normalize cookies for safe storage)
      const refreshTimestamp = Date.now();
      localTokenCache[cacheKey] = {
        jwToken: newToken,
        timestamp: refreshTimestamp,
        lastRefreshTimestamp: refreshTimestamp, // Track when token was last refreshed (per-VU)
        username: username,
        accountId: accountId,
        orgId: account.fiIdentifier,
        cookies: normalizeCookiesForStorage(newCookies || {})
      };
      
      // CRITICAL: Update SHARED tokenRefreshState to coordinate across ALL VUs
      // This prevents multiple VUs from refreshing the same token simultaneously
      if (!tokenRefreshState[cacheKey]) {
        tokenRefreshState[cacheKey] = { lastRefreshMs: 0, windowStartMs: refreshTimestamp, refreshCount: 0 };
      }
      tokenRefreshState[cacheKey].lastRefreshMs = refreshTimestamp;
      tokenRefreshState[cacheKey].refreshCount = (tokenRefreshState[cacheKey].refreshCount || 0) + 1;
      
      if (DEBUG_ENABLED || tokenCacheDebug) {
        console.log(`[TOKEN] Generated fresh token for ${username} (account ${accountId}) - cached with key: ${cacheKey}, shared refresh state updated`);
      }
    } else {
      console.warn(`[TOKEN WARNING] Failed to generate new token for ${username} (account ${accountId}, key ${cacheKey})`);
    }
  } catch (e) {
    console.error(`[TOKEN ERROR] Error generating token for ${username} (account ${accountId}, key ${cacheKey}): ${e.message}`);
  }
  
  // Return token data including cookies (normalize for consistent shape)
  if (newToken) {
    return {
      jwToken: newToken,
      timestamp: Date.now(),
      cookies: normalizeCookiesForStorage(newCookies || {})
    };
  }
  return null;
}

// Common check for status code in response data
// Robust status code extractor to handle multiple possible response shapes
function extractStatusCode(res) {
  try {
    const json = res && res.json ? res.json() : null;
    if (!json) return null;

    // Common shapes to handle:
    // { data: { status: { code: 0 } } }
    // { data: '{"status":{"code":0}}' }
    // { status: { code: 0 } }
    // { statusCode: 0 }

    if (json.status && typeof json.status.code !== 'undefined') return json.status.code;
    if (typeof json.statusCode !== 'undefined') return json.statusCode;
    if (json.data && typeof json.data === 'object' && json.data.status && typeof json.data.status.code !== 'undefined') return json.data.status.code;
    if (json.data && typeof json.data === 'string') {
      try {
        const parsed = JSON.parse(json.data);
        if (parsed && parsed.status && typeof parsed.status.code !== 'undefined') return parsed.status.code;
      } catch (e) {
        // ignore parse error
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

// Treat business success codes 0 and 300 as valid. Return true for success.
function isSuccessfulBizCode(code) {
  return code === 0 || code === 300;
}

// Common check for status code in response data
// Returns the business status code from the response or null if not found
function checkstatsucode(res, groupName) {
  const statusCode = extractStatusCode(res);
  if (statusCode === null) {
    console.warn(`[${groupName} WARN] Could not extract business status code from response; response shape may differ.`);
  }
  
  // Check if it's a 401 business code (auth failure within a 200 HTTP response)
  const isBusinessAuth401 = statusCode === 401;
  if (isBusinessAuth401 && String(__ENV.DEBUG).toLowerCase() === 'true') {
    console.warn(`[${groupName} AUTH ERROR] Business status code 401 detected in HTTP 200 response`);
  }
  
  check(res, {
    [`${groupName} API Response Status`]: (r) => r.status === 200,
    [`${groupName} status code is 0 or 300`]: (r) => {
      try {
        const c = extractStatusCode(r);
        return isSuccessfulBizCode(c);
      } catch (e) { return false; }
    },
    [`${groupName} Valid JSON`]: (r) => {
      try {
        const json = r.json();
        return json !== null;
      } catch (e) {
        console.error(`[${groupName} ERROR] Response is not valid JSON: ${e.message}`);
        return false;
      }
    }
  });
  
  return statusCode; // Return the business status code for the caller to use
}

// Debug helper to dump full response details (status, business code, headers, body)
// Controlled by DEBUG=true or FULL_RESPONSE_LOG=true to avoid noisy output in normal runs
// Dump full response details only for failures (non-200, business-code failures, or invalid JSON)
// Callers can pass forceDump=true to unconditionally dump (rare)
function dumpResponse(res, groupName, forceDump = false) {
  try {
    if (!res) {
      if (forceDump) console.log(`[${groupName} FULL RESPONSE] No response object to dump`);
      return;
    }

    // Determine business status and JSON validity
    let bizCode = null;
    let jsonOk = true;
    let bodyStr = '';
    try {
      // Try to read JSON body (may throw for non-json responses)
      const json = res.json ? res.json() : null;
      if (json !== null) {
        bodyStr = JSON.stringify(json);
      } else if (typeof res.body === 'string') {
        bodyStr = res.body;
      } else {
        bodyStr = String(res.body || '');
      }
    } catch (e) {
      jsonOk = false;
      try { bodyStr = typeof res.body === 'string' ? res.body : JSON.stringify(res.body); } catch (e2) { bodyStr = `[unserializable body: ${e.message}]`; }
    }

    try { bizCode = extractStatusCode(res); } catch (e) { bizCode = null; }

    // Failure conditions: HTTP non-200, invalid JSON body, or explicit business-code failure
    const bizFailure = (bizCode !== null && !isSuccessfulBizCode(bizCode));
    const httpFailure = res.status !== 200;
    const shouldDump = forceDump || httpFailure || !jsonOk || bizFailure;

    if (!shouldDump) {
      // Quiet success path
      return;
    }

    // Prepare displayed body (truncate to reasonable length)
    const maxLen = parseInt(__ENV.FULL_RESPONSE_MAX_CHARS || '20000', 10);
    const displayed = bodyStr && bodyStr.length > maxLen ? bodyStr.substring(0, maxLen) + `... [truncated ${bodyStr.length - maxLen} chars]` : bodyStr;

    // Emit detailed dump for failures
    console.log(`[${groupName} FULL RESPONSE] httpStatus=${res.status}, businessStatus=${bizCode}, headers=${JSON.stringify(res.headers || {})}, bodyLength=${bodyStr.length}`);
    console.log(`[${groupName} FULL RESPONSE BODY] ${displayed}`);
  } catch (err) {
    console.error(`[${groupName} FULL RESPONSE] Error while dumping response: ${err.message}`);
  }
}

// Build headers with JWT token, cookies, and transaction tracking
function buildHeaders(token, transactionName, extraHeaders = {}) {
  try {
    // Use scenarioType and scriptName from the environment/config
    const scenarioType = __ENV.SCENARIO_TYPE || 'smoke';
    const scriptName = __ENV.SCRIPT_NAME || 'd1flexKongAPI';
    
    // Don't use 'Login' transaction tag for normal API calls that are just using a token
    // Only actual token generation calls should be tagged as 'Login'
    let dynatraceHeader = {};
    
    // Set the transaction tag only for:
    // 1. Non-Login transactions (History_Transactions, Accounts, etc.)
    // 2. Token generation calls specifically marked as isTokenGeneration
    if (transactionName !== 'Login' || (extraHeaders && extraHeaders.isTokenGeneration)) {
      dynatraceHeader = buildDynatraceHeader(transactionName, scriptName, scenarioType);
    } else {
      // For Login transactions that are just using a token and not generating one,
      // we'll set the transaction to the actual API call being made
      if (extraHeaders && extraHeaders.originalTransaction) {
        dynatraceHeader = buildDynatraceHeader(extraHeaders.originalTransaction, scriptName, scenarioType);
      }
    }
    
    // Create a deep copy to avoid modifying the original extraHeaders
    const mergedExtra = JSON.parse(JSON.stringify(Object.assign({}, DEFAULT_GATEWAY_HEADERS || {}, extraHeaders || {})));
    
    // Get user info from extraHeaders for better debugging
    const username = mergedExtra.username || 'unknown-user';
    const accountId = mergedExtra.accountId || 'unknown-acct';
    
    // Ensure a uuid header is present for all transactions (some auth gateways require it)
    if (!mergedExtra.uuid) {
      try {
        mergedExtra.uuid = generateUuidV4();
        if (String(__ENV.DEBUG).toLowerCase() === 'true') {
          console.log(`[HEADERS] Generated uuid for ${transactionName} (user ${username}): ${mergedExtra.uuid}`);
        }
      } catch (e) {
        // Fall back silently if uuid generation fails
      }
    }
    
    // If organization-id is present but x-org-id missing, add it (curl scripts set both)
    if (mergedExtra['organization-id'] && !mergedExtra['x-org-id']) {
      mergedExtra['x-org-id'] = mergedExtra['organization-id'];
    }
    // If x-org-id is present but organization-id missing, add it too
    if (mergedExtra['x-org-id'] && !mergedExtra['organization-id']) {
      mergedExtra['organization-id'] = mergedExtra['x-org-id'];
    }
    
    // Extract and build Cookie header from token object if present.
    // Support both k6-style cookies (name -> [{ value }]) and normalized maps (name -> value string).
    let cookieHeader = '';
    let ngaSessionId = null; // Extract nga-session-id for x-session-id header
    if (token && typeof token === 'object' && token.cookies) {
      const cookiePairs = [];
      for (const name in token.cookies) {
        const entry = token.cookies[name];
        if (entry === null || typeof entry === 'undefined') continue;

        let cookieValue = null;
        
        // If entry is an array (k6 style), extract first.value
        if (Array.isArray(entry) && entry.length > 0) {
          const first = entry[0];
          if (first && typeof first === 'object' && typeof first.value === 'string') {
            cookieValue = first.value;
          } else if (typeof entry[0] === 'string') {
            cookieValue = entry[0];
          }
        }
        // If entry is a simple string (normalized storage), use it directly
        else if (typeof entry === 'string') {
          cookieValue = entry;
        }
        // If entry is an object with a value property
        else if (typeof entry === 'object' && typeof entry.value === 'string') {
          cookieValue = entry.value;
        }
        
        if (cookieValue) {
          cookiePairs.push(`${name}=${cookieValue}`);
          // CRITICAL: Extract nga-session-id for x-session-id header (required by backend)
          if (name === 'nga-session-id') {
            ngaSessionId = cookieValue;
          }
        }
      }
      if (cookiePairs.length > 0) {
        cookieHeader = cookiePairs.join('; ');
        if (String(__ENV.DEBUG).toLowerCase() === 'true') {
          console.log(`[HEADERS] Built Cookie header with ${cookiePairs.length} cookies for ${transactionName}`);
          if (ngaSessionId) {
            console.log(`[HEADERS] Extracted nga-session-id for x-session-id header: ${ngaSessionId}`);
          }
        }
      }
    }
    
    // Normalize token input: callers sometimes pass the full token object (with jwToken)
    // or a raw string. Ensure we always send a string in the Authorization header.
    const tokenStr = (typeof token === 'string')
      ? token
      : (token && typeof token === 'object' && token.jwToken)
        ? token.jwToken
        : '';

    if (!tokenStr && (String(__ENV.DEBUG).toLowerCase() === 'true' || String(__ENV.DEBUG_TOKEN_CACHING).toLowerCase() === 'true')) {
      console.warn('[HEADERS WARN] buildHeaders received empty or invalid token; Authorization header will be blank or invalid');
    }

    const finalHeaders = {
      'authorization': `Bearer ${tokenStr}`,
      'authenticationtype': 'JWT',
      'channel': 'DIG_FLX_INT_MOB',
      'Content-Type': 'application/json',
      ...dynatraceHeader,
      ...mergedExtra
    };
    
    // CRITICAL: Add x-session-id header with the nga-session-id value (required by backend per NeoLoad)
    if (ngaSessionId) {
      finalHeaders['x-session-id'] = ngaSessionId;
    }
    
    // NO Cookie header - removed per user request to match NeoLoad configuration
    
    // Debug: log final headers being sent
    if (String(__ENV.DEBUG).toLowerCase() === 'true') {
      console.log(`[HEADERS DEBUG] Final headers for ${transactionName}:`, JSON.stringify(finalHeaders, null, 2));
    }
    
    return finalHeaders;
  } catch (error) {
    console.error(`[HEADERS ERROR] Failed to build headers: ${error.message}`);
    // Return headers without Dynatrace info if there's an error
    const fallbackToken = (typeof token === 'string') ? token : (token && token.jwToken ? token.jwToken : '');
    return {
      'authorization': `Bearer ${fallbackToken}`,
      'authenticationtype': 'JWT',
      'channel': 'DIG_FLX_INT_MOB',
      'x-channel-id': 'DIG_FLX_INT_MOB',
      'Content-Type': 'application/json',
      ...extraHeaders
    };
  }
}

// Implementation of the transaction group functions

// 1. History Transactions
function executeHistoryTransactions(account) {
  group('History_Transactions', () => {
    try {
      // Get user information for better logging
      const username = account && (account.username || account.userName) ? (account.username || account.userName) : 'unknown-user';
      const accountId = account && account.accountid ? account.accountid : 'unknown-acct';
      const orgId = account && account.fiIdentifier ? account.fiIdentifier : 'unknown-org';
      
      // Compute cacheKey for this account to access localTokenCache entries safely
      const cacheKey = getCacheKey(account);
      
      if (String(__ENV.DEBUG).toLowerCase() === 'true') {
        console.log(`[HISTORY] Executing history transactions for user ${username} (account ${accountId}, org ${orgId})`);
        console.log(`[HISTORY] Using cache key: ${cacheKey}`);
      }
      
      // Get token data including the JWT and cookies
      const tokenData = getOrRefreshJWT(account);
      
      // Enforce presence of a real token: skip if missing
      if (!tokenData) {
        console.error(`[HISTORY] No JWT token available for user ${username} (account ${accountId}) - skipping transaction`);
        return;
      }
      
      // Handle both cases: tokenData as object with jwToken or direct string token
      let jwToken = typeof tokenData === 'object' && tokenData.jwToken ? tokenData.jwToken : tokenData;
      
      // CRITICAL: Verify the token's account matches the transaction account
      if (typeof tokenData === 'object' && tokenData.accountId && tokenData.accountId !== accountId) {
        console.error(`[HISTORY ACCOUNT MISMATCH] Token is for account ${tokenData.accountId} but transaction is for account ${accountId}!`);
        console.error(`[HISTORY ACCOUNT MISMATCH] Token username: ${tokenData.username}, Transaction username: ${username}`);
        console.error(`[HISTORY ACCOUNT MISMATCH] Cache key used: ${cacheKey}`);
        
        // CRITICAL FIX: Always regenerate a fresh token for this account
        console.log(`[HISTORY ACCOUNT MISMATCH] Forcing token refresh for account ${accountId}`);
        
        // Force regenerate token with explicit force refresh flag
        const freshTokenData = getOrRefreshJWT(account, true);
        if (freshTokenData && freshTokenData.jwToken) {
          jwToken = freshTokenData.jwToken;
          console.log(`[HISTORY ACCOUNT MISMATCH] Successfully generated fresh token for account ${accountId}`);
          
          // Verify the fresh token has the correct account
          if (freshTokenData.accountId && freshTokenData.accountId !== accountId) {
            console.error(`[HISTORY ACCOUNT MISMATCH] Critical error: Even fresh token has wrong account ID: ${freshTokenData.accountId} vs ${accountId}`);
            console.error('[HISTORY ACCOUNT MISMATCH] This indicates a serious issue with the account identification mechanism');
            return; // Skip transaction to avoid corruption
          }
        } else {
          console.error('[HISTORY ACCOUNT MISMATCH] Failed to regenerate token - skipping transaction');
          return;
        }
      }
      
      // Build headers with token data (includes cookies if present)
      // Pass the full tokenData object so buildHeaders can extract cookies
      let headers = buildHeaders(tokenData, 'History_Transactions', { 
        'organization-id': account.fiIdentifier || organizationId, 
        'username': username,
        'accountId': accountId
      });
      const url = `${baseURL}/cuflex/ExternalApp/Authentication/AcctTransactionHistoryInqSVC`;
      const payload = {
        _credentials: {
          _deviceToken: 'MglCcm93c2VyCTIJdW5rbm93bgkyCTEJMmU0YWFmM2VhMjM2M2JmY2M0ZmFhZWFkYjVjOGNjMWMJZGlnaXRhbEJBTktJTkctMS4wLjAuMAkJMjAyNS0wNi0wNlQwNjoxNjo1OC43NTNaCQlBY2N0VHJhbnNhY3Rpb25IaXN0b3J5SW5xU1ZDCQllbgk3MGRhN2FlZC1mYTkzLTRhMmEtOWQ2NS1mNGJjZDY0MWU2ZGQ='
        },
        _p: `${account.accountid},DD,${account.fiIdentifier},${account.customerid}`,
        _operation: 'GET',
        _op: '&status=Both',
        businessContext: null,
        _lang: 'en'
      };
      
      // Single attempt for the transaction. On auth failures (HTTP 401 or
      // business status 401/403) attempt a single token refresh and one retry.
      let res = null;
      try {
        // Debug: log the outgoing request
        if (String(__ENV.DEBUG).toLowerCase() === 'true' && typeof __VU !== 'undefined' && typeof __ITER !== 'undefined' && __VU === 1 && __ITER === 0) {
          try {
            console.log('[REQUEST DEBUG] Transaction: History_Transactions');
            console.log(`[REQUEST DEBUG] URL: ${url}`);
            console.log(`[REQUEST DEBUG] HEADERS: ${JSON.stringify(headers)}`);
            try { console.log(`[REQUEST DEBUG] PAYLOAD: ${JSON.stringify(payload)}`); } catch (e) { console.log('[REQUEST DEBUG] PAYLOAD: <unserializable>'); }
          } catch (e) { /* ignore debug errors */ }
        }

        res = http.post(url, JSON.stringify(payload), { headers, tags: { transaction: 'History_Transactions' } });

        // If HTTP-level 401, refresh token and retry once
        if (res && res.status === 401) {
          if (String(__ENV.DEBUG).toLowerCase() === 'true') console.log('[HISTORY] HTTP 401 received - refreshing token and retrying once');
          const refreshedTokenData = getOrRefreshJWT(account, true);
          if (!refreshedTokenData || !refreshedTokenData.jwToken) {
            console.error(`[HISTORY] No JWT token available after HTTP 401 refresh for ${username} - skipping transaction`);
            return;
          }
          headers = buildHeaders(refreshedTokenData, 'History_Transactions', { 'organization-id': account.fiIdentifier || organizationId, username, accountId });
          res = http.post(url, JSON.stringify(payload), { headers, tags: { transaction: 'History_Transactions' } });
        }

        // If HTTP 200, check business status and if it's an auth-related code
        // (401 or 403) attempt one token refresh + retry. Do not perform
        // additional retries for other business failures.
        if (res && res.status === 200) {
          try {
            const statusCode = extractStatusCode(res);
            // Only treat business 401 as an auth failure that warrants a forced refresh.
            // Business 403 (Access Denied) often indicates permission issues and
            // should not automatically trigger token regeneration.
            if (statusCode === 401) {
              if (String(__ENV.DEBUG).toLowerCase() === 'true') console.log(`[HISTORY] Business status ${statusCode} - attempting token refresh and retry once`);
              // Respect refresh cooldowns to avoid refresh thrashing
              const cacheKeyLocal = getCacheKey(account);
              if (!canRefreshToken(cacheKeyLocal)) {
                console.warn(`[HISTORY] Refresh suppressed by cooldown/max-policy for ${cacheKeyLocal}`);
              } else {
                const refreshedTokenData = getOrRefreshJWT(account, true);
                // record the refresh attempt even if it fails to avoid loops
                recordRefresh(cacheKeyLocal);
                if (refreshedTokenData && refreshedTokenData.jwToken) {
                  headers = buildHeaders(refreshedTokenData, 'History_Transactions', { 'organization-id': account.fiIdentifier || organizationId, username, accountId });
                  res = http.post(url, JSON.stringify(payload), { headers, tags: { transaction: 'History_Transactions' } });
                } else {
                  console.error(`[HISTORY] No JWT token available after business auth refresh for ${username} - skipping transaction`);
                  return;
                }
              }
            }
          } catch (e) {
            console.error(`[HISTORY] Error during business-status check: ${e.message}`);
          }
        }
      } catch (reqError) {
        console.error(`[HISTORY] Request error: ${reqError.message}`);
      }

      if (res) {
        dumpResponse(res, 'History_Transactions');
        if (String(__ENV.DEBUG).toLowerCase() === 'true') console.log(`[HISTORY DEBUG] Response status: ${res.status}`);
        const bizStatusCode = checkstatsucode(res, 'History Transactions');
        if (bizStatusCode === 401) {
          // If business 401 persists despite a refresh attempt, warn once.
          if (String(__ENV.DEBUG).toLowerCase() === 'true') console.warn('[HISTORY WARN] Business status 401 persists after token refresh.');
        }
      } else {
        console.error('[HISTORY ERROR] No response received for History_Transactions');
      }
    } catch (error) {
      console.error(`[HISTORY ERROR] ${error.message}`);
      handleError(error, 'AcctTransactionHistoryInqSVC API');
    }
  });
}

// 2. Accounts
function executeAccounts(account) {
  group('Accounts', () => {
    try {
      // Get user information for better logging
      const username = account && (account.username || account.userName) ? (account.username || account.userName) : 'unknown-user';
      const accountId = account && account.accountid ? account.accountid : 'unknown-acct';
      const orgId = account && account.fiIdentifier ? account.fiIdentifier : 'unknown-org';
      
      // Compute cacheKey for this account using the proper function to ensure account ID is included
      const cacheKey = getCacheKey(account);
      
      if (String(__ENV.DEBUG).toLowerCase() === 'true') {
        console.log(`[ACCOUNTS] Using cache key for user ${username} (account ${accountId}): ${cacheKey}`);
      }
      
      // Get token data including the JWT and cookies
      const tokenData = getOrRefreshJWT(account);
      
      // Enforce presence of a real token: skip if missing
      if (!tokenData) {
        console.error(`[ACCOUNTS] No JWT token available for user ${username} (account ${accountId}) - skipping transaction`);
        return;
      }
      
      // Handle both cases: tokenData as object with jwToken or direct string token
      let jwToken = typeof tokenData === 'object' && tokenData.jwToken ? tokenData.jwToken : tokenData;
      
      // CRITICAL: Verify the token's account matches the transaction account
      if (typeof tokenData === 'object' && tokenData.accountId && tokenData.accountId !== accountId) {
        console.error(`[ACCOUNTS ACCOUNT MISMATCH] Token is for account ${tokenData.accountId} but transaction is for account ${accountId}!`);
        console.error(`[ACCOUNTS ACCOUNT MISMATCH] Token username: ${tokenData.username}, Transaction username: ${username}`);
        console.error(`[ACCOUNTS ACCOUNT MISMATCH] Cache key used: ${cacheKey}`);
        
        // CRITICAL FIX: Always regenerate a fresh token for this account
        console.log(`[ACCOUNTS ACCOUNT MISMATCH] Forcing token refresh for account ${accountId}`);
        
        // Force regenerate token with explicit force refresh flag
        const freshTokenData = getOrRefreshJWT(account, true);
        if (freshTokenData && freshTokenData.jwToken) {
          jwToken = freshTokenData.jwToken;
          console.log(`[ACCOUNTS ACCOUNT MISMATCH] Successfully generated fresh token for account ${accountId}`);
        } else {
          console.error('[ACCOUNTS ACCOUNT MISMATCH] Failed to regenerate token - skipping transaction');
          return;
        }
      }
      
      // Build headers with token data (includes cookies if present)
      // Use same simple headers as History and Configuration transactions
      let headers = buildHeaders(tokenData, 'Accounts', { 
        'organization-id': account.fiIdentifier || organizationId, 
        'username': username,
        'accountId': accountId
      });

      const url = `${baseURL}/cuflex/ExternalApp/Authentication/OverviewDisplayAccountListInqSVC`;
      const payload = {
        _credentials: {
          _deviceToken: 'MglCcm93c2VyCTIJdW5rbm93bgkyCTEJMmU0YWFmM2VhMjM2M2JmY2M0ZmFhZWFkYjVjOGNjMWMJZGlnaXRhbEJBTktJTkctMS4wLjAuMAkJMjAyNS0wNi0wNlQwNjowNDo0MS4zNTdaCQlPdmVydmlld0Rpc3BsYXlBY2NvdW50TGlzdElucVNWQwkJZW4JNzBkYTdhZWQtZmE5My00YTJhLTlkNjUtZjRiY2Q2NDFlNmRk'
        },
        _p: `${account.customerid},Person,${account.fiIdentifier}`,
        _op: '&showHidden=true&entitledFor=Overview&entriesToReturnMaximumCount=-1',
        businessContext: null,
        _lang: 'en'
      };
      
      // Single attempt for Accounts transaction, with at most one token-refresh retry
      let res = null;
      try {
        res = http.post(url, JSON.stringify(payload), { headers, tags: { transaction: 'Accounts' } });

        // If HTTP-level 401, refresh token and retry once
        if (res && res.status === 401) {
          if (String(__ENV.DEBUG).toLowerCase() === 'true') console.log('[ACCOUNTS] HTTP 401 received - refreshing token and retrying once');
          const refreshedTokenData = getOrRefreshJWT(account, true);
          if (!refreshedTokenData || !refreshedTokenData.jwToken) {
            console.error('[ACCOUNTS] No JWT token available after HTTP 401 refresh - skipping transaction');
            return;
          }
          headers = buildHeaders(refreshedTokenData, 'Accounts', { 'organization-id': account.fiIdentifier || organizationId });
          res = http.post(url, JSON.stringify(payload), { headers, tags: { transaction: 'Accounts' } });
        }

        // If HTTP 200, check business status; on business auth failures (401/403)
        // refresh token and retry once. Do not perform multiple retries.
        if (res && res.status === 200) {
          try {
            const statusCode = extractStatusCode(res);
            // Only force refresh on business 401 (auth failure). Do not auto-refresh on 403.
              if (statusCode === 401) {
                if (String(__ENV.DEBUG).toLowerCase() === 'true') console.log(`[ACCOUNTS] Business status ${statusCode} - attempting token refresh and retry once`);
                const cacheKeyLocal = getCacheKey(account);
                if (!canRefreshToken(cacheKeyLocal)) {
                  console.warn(`[ACCOUNTS] Refresh suppressed by cooldown/max-policy for ${cacheKeyLocal}`);
                  try { refreshSuppressed.add(1); } catch (e) {}
                } else {
                  // Record refresh attempt and then try to generate a new token
                  recordRefresh(cacheKeyLocal);
                  let refreshedTokenData = null;
                  try {
                    refreshedTokenData = getOrRefreshJWT(account, true);
                  } catch (e) {
                    // Count as failed refresh
                    try { refreshFailed.add(1); } catch (err) {}
                  }
                  if (refreshedTokenData && refreshedTokenData.jwToken) {
                    // Success metrics
                    try { refreshSucceeded.add(1); } catch (e) {}
                    headers = buildHeaders(refreshedTokenData, 'Accounts', { 'organization-id': account.fiIdentifier || organizationId });
                    res = http.post(url, JSON.stringify(payload), { headers, tags: { transaction: 'Accounts' } });
                  } else {
                    console.error('[ACCOUNTS] No JWT token available after business auth refresh - skipping transaction');
                    try { refreshFailed.add(1); } catch (e) {}
                    return;
                  }
                }
              }
          } catch (e) {
            console.error(`[ACCOUNTS] Error during business-status check: ${e.message}`);
          }
        }
      } catch (reqError) {
        console.error(`[ACCOUNTS] Request error: ${reqError.message}`);
      }

      // Final dump and business status check
      dumpResponse(res, 'Accounts');
      if (res) {
        if (String(__ENV.DEBUG).toLowerCase() === 'true') console.log(`[ACCOUNTS DEBUG] Response status: ${res.status}`);
        const bizStatusCode = extractStatusCode(res);
        // Require explicit success code 0 for Accounts (curl validation expects status = 0)
        if (bizStatusCode !== 0) {
          console.error(`[ACCOUNTS ERROR] Business status expected 0 but got ${bizStatusCode} for user ${username} account ${accountId}`);
          // Provide more context for triage
          try {
            const body = res.json ? res.json() : (res.body ? JSON.parse(res.body) : null);
            console.error('[ACCOUNTS ERROR] Response body:', JSON.stringify(body));
          } catch (e) {
            console.error('[ACCOUNTS ERROR] Could not parse response body for detailed logging:', e.message);
          }
        } else {
          // Standard checks pass via checkstatsucode for dashboards
          checkstatsucode(res, 'Accounts');
        }
      }
    } catch (error) {
      // Defensive: if the caught value looks like an HTTP response (has status/body),
      // pass it to handleError for consistent logging and throwing. Otherwise log the
      // error and continue to avoid noisy stack traces caused by trying to access
      // properties of non-HTTP Error objects.
      try {
        if (error && (typeof error.status !== 'undefined' || typeof error.body !== 'undefined')) {
          // It's likely an HTTP response-like object
          handleError(error, 'OverviewDisplayAccountListInqSVC API');
        } else {
          // Non-HTTP error (Error instance or empty object) - log details and move on
          try {
            if (error && typeof error === 'object') {
              console.error('[ACCOUNTS ERROR] Non-HTTP error caught:', JSON.stringify(error));
            } else {
              console.error('[ACCOUNTS ERROR] Non-HTTP error caught:', String(error));
            }
          } catch (e) {
            console.error('[ACCOUNTS ERROR] Error while serializing non-HTTP error:', e.message);
          }
          // Do not re-throw; allow the VU to continue other transactions
          return;
        }
      } catch (outerErr) {
        // If something unexpected happened while handling the error, log and continue
        console.error('[ACCOUNTS ERROR] Unexpected error while processing catch block:', outerErr.message);
        return;
      }
    }
  });
}

// 3. Accounts Context Menu
function executeAccountsContextMenu(account) {
  group('Accounts_Context_Menu', () => {
    try {
      // Get user information for better logging
      const username = account && (account.username || account.userName) ? (account.username || account.userName) : 'unknown-user';
      const accountId = account && account.accountid ? account.accountid : 'unknown-acct';
      const orgId = account && account.fiIdentifier ? account.fiIdentifier : 'unknown-org';
      
      // Compute cacheKey for this account using the proper function to ensure account ID is included
      const cacheKey = getCacheKey(account);
      
      if (String(__ENV.DEBUG).toLowerCase() === 'true') {
        console.log(`[CONTEXT_MENU] Using cache key for user ${username} (account ${accountId}): ${cacheKey}`);
      }
      
      // Get token data including the JWT and cookies
      const tokenData = getOrRefreshJWT(account);
      
      // Enforce presence of a real token: skip if missing
      if (!tokenData) {
        console.error(`[CONTEXT_MENU] No JWT token available for user ${username} (account ${accountId}) - skipping transaction`);
        return;
      }
      
      // Handle both cases: tokenData as object with jwToken or direct string token
      let jwToken = typeof tokenData === 'object' && tokenData.jwToken ? tokenData.jwToken : tokenData;
      
      // CRITICAL: Verify the token's account matches the transaction account
      if (typeof tokenData === 'object' && tokenData.accountId && tokenData.accountId !== accountId) {
        console.error(`[CONTEXT_MENU ACCOUNT MISMATCH] Token is for account ${tokenData.accountId} but transaction is for account ${accountId}!`);
        console.error(`[CONTEXT_MENU ACCOUNT MISMATCH] Token username: ${tokenData.username}, Transaction username: ${username}`);
        console.error(`[CONTEXT_MENU ACCOUNT MISMATCH] Cache key used: ${cacheKey}`);
        
        // CRITICAL FIX: Always regenerate a fresh token for this account
        console.log(`[CONTEXT_MENU ACCOUNT MISMATCH] Forcing token refresh for account ${accountId}`);
        
        // Force regenerate token with explicit force refresh flag
        const freshTokenData = getOrRefreshJWT(account, true);
        if (freshTokenData && freshTokenData.jwToken) {
          jwToken = freshTokenData.jwToken;
          console.log(`[CONTEXT_MENU ACCOUNT MISMATCH] Successfully generated fresh token for account ${accountId}`);
        } else {
          console.error('[CONTEXT_MENU ACCOUNT MISMATCH] Failed to regenerate token - skipping transaction');
          return;
        }
      }
      
      // COOKIES REMOVED: Testing confirmed cookies are NOT required for API authentication
      const headers = buildHeaders(jwToken, 'Accounts_Context_Menu', { 'organization-id': account.fiIdentifier || organizationId });
    const url = `${baseURL}/cuflex/ExternalApp/Authentication/ContextMenuItemsSVC`;
    const payload = {
      _credentials: {
        _deviceToken: 'MglCcm93c2VyCTIJdW5rbm93bgkyCTEJMmU0YWFmM2VhMjM2M2JmY2M0ZmFhZWFkYjVjOGNjMWMJZGlnaXRhbEJBTktJTkctMS4wLjAuMAkJMjAyNS0wNi0wNlQwNDo0MS4zNTdaCQlDb250ZXh0TWVudUl0ZW1zU1ZDCQllbgk3MGRhN2FlZC1mYTkzLTRhMmEtOWQ2NS1mNGJjZDY0MWU2ZGQ='
      },
      _p: `${account.customerid},${account.fiIdentifier}`,
      _op: '',
      businessContext: null,
      _lang: 'en'
    };
      try {
        let res = http.post(url, JSON.stringify(payload), { headers, tags: { transaction: 'Accounts_Context_Menu' } });
      dumpResponse(res, 'Accounts_Context_Menu');
      if (res.status === 401) {
        const cacheKeyLocal = getCacheKey(account);
        if (!canRefreshToken(cacheKeyLocal)) {
          console.warn(`[CONTEXT_MENU] Refresh suppressed by cooldown/max-policy for ${cacheKeyLocal}`);
        } else {
          const refreshed = getOrRefreshJWT(account, true);
          recordRefresh(cacheKeyLocal);
          if (!refreshed) return;
          const retryHeaders = buildHeaders(refreshed, 'Accounts_Context_Menu');
          res = http.post(url, JSON.stringify(payload), { headers: retryHeaders, tags: { transaction: 'Accounts_Context_Menu' } });
        }
      }
  if (String(__ENV.DEBUG).toLowerCase() === 'true') console.log(`[CONTEXTMENU DEBUG] Response status: ${res.status}`);
        try {
        const statusCode = extractStatusCode(res);
        // Only refresh on explicit business 401; do not refresh on 403 or other failures
        if (statusCode === 401) {
          if (String(__ENV.DEBUG).toLowerCase() === 'true') console.log(`[CONTEXTMENU] Business status code ${statusCode} detected — attempting token refresh and retrying once`);
          const cacheKeyLocal = getCacheKey(account);
          if (!canRefreshToken(cacheKeyLocal)) {
            console.warn(`[CONTEXTMENU] Refresh suppressed by cooldown/max-policy for ${cacheKeyLocal}`);
          } else {
            const newToken = getOrRefreshJWT(account, true);
            recordRefresh(cacheKeyLocal);
            if (newToken) {
              const retryHeaders = buildHeaders(newToken, 'Accounts_Context_Menu');
              const retryRes = http.post(url, JSON.stringify(payload), { headers: retryHeaders, tags: { transaction: 'Accounts_Context_Menu' } });
              if (String(__ENV.DEBUG).toLowerCase() === 'true') console.log(`[CONTEXTMENU DEBUG] Retry response status: ${retryRes.status}`);
              // Check and log the status code from retry
              const retryStatusCode = extractStatusCode(retryRes);
              if (String(__ENV.DEBUG).toLowerCase() === 'true' && retryStatusCode === 401) {
                console.warn('[CONTEXTMENU WARN] Business status code 401 persists after token refresh. This might indicate an account or session issue.');
              }
              res = retryRes;
            }
          }
        }
      } catch (e) {
        if (String(__ENV.DEBUG).toLowerCase() === 'true') console.error('[CONTEXTMENU] Error during business-status retry logic:', e.message);
      }
      dumpResponse(res, 'Accounts Context Menu');
      const ok = checkstatsucode(res, 'Accounts Context Menu');
    } catch (error) {
      handleError(error, 'ContextMenuItemsSVC API');
    }
    } catch (outerError) {
      handleError(outerError, 'ContextMenuItemsSVC API - Outer');
    }
  });
}

// 4. Configuration Signonsecattr
function executeConfigurationSignonsecattr(account) {
  group('Configuration_Signonsecattr', () => {
    try {
      // Get user information for better logging
      const username = account && (account.username || account.userName) ? (account.username || account.userName) : 'unknown-user';
      const accountId = account && account.accountid ? account.accountid : 'unknown-acct';
      const orgId = account && account.fiIdentifier ? account.fiIdentifier : 'unknown-org';
      
      // Compute cacheKey for this account using the proper function to ensure account ID is included
      const cacheKey = getCacheKey(account);
      
      if (String(__ENV.DEBUG).toLowerCase() === 'true') {
        console.log(`[SIGNONSECATTR] Using cache key for user ${username} (account ${accountId}): ${cacheKey}`);
      }
      
      // Get token data including the JWT and cookies
      const tokenData = getOrRefreshJWT(account);
      
      // Enforce presence of a real token: skip if missing
      if (!tokenData) {
        console.error(`[SIGNONSECATTR] No JWT token available for user ${username} (account ${accountId}) - skipping transaction`);
        return;
      }
      
      // Handle both cases: tokenData as object with jwToken or direct string token
      let jwToken = typeof tokenData === 'object' && tokenData.jwToken ? tokenData.jwToken : tokenData;
      
      // CRITICAL: Verify the token's account matches the transaction account
      if (typeof tokenData === 'object' && tokenData.accountId && tokenData.accountId !== accountId) {
        console.error(`[SIGNONSECATTR ACCOUNT MISMATCH] Token is for account ${tokenData.accountId} but transaction is for account ${accountId}!`);
        console.error(`[SIGNONSECATTR ACCOUNT MISMATCH] Token username: ${tokenData.username}, Transaction username: ${username}`);
        console.error(`[SIGNONSECATTR ACCOUNT MISMATCH] Cache key used: ${cacheKey}`);
        
        // CRITICAL FIX: Always regenerate a fresh token for this account
        console.log(`[SIGNONSECATTR ACCOUNT MISMATCH] Forcing token refresh for account ${accountId}`);
        
        // Force regenerate token with explicit force refresh flag
        const freshTokenData = getOrRefreshJWT(account, true);
        if (freshTokenData && freshTokenData.jwToken) {
          jwToken = freshTokenData.jwToken;
          console.log(`[SIGNONSECATTR ACCOUNT MISMATCH] Successfully generated fresh token for account ${accountId}`);
        } else {
          console.error('[SIGNONSECATTR ACCOUNT MISMATCH] Failed to regenerate token - skipping transaction');
          return;
        }
      }
      
      // COOKIES REMOVED: Testing confirmed cookies are NOT required for API authentication
      const headers = buildHeaders(jwToken, 'Configuration_Signonsecattr', { 'organization-id': account.fiIdentifier || organizationId });
      const url = `${baseURL}/cuflex/ExternalApp/Authentication/GetConfigurationsSvc`;
    const payload = {
      _credentials: {
        _deviceToken: 'MglCcm93c2VyCTIJdW5rbm93bgkyCTEJMmU0YWFmM2VhMjM2M2JmY2M0ZmFhZWFkYjVjOGNjMWMJZGlnaXRhbEJBTktJTkctMS4wLjAuMAkJMjAyNS0wNi0wNlQwNjowNDozNy4wMzlaCQlHZXRDb25maWd1cmF0aW9uc1N2YwkJZW4JMWEyZDhhMTAtNDJhNi0xMWYwLWIyYTktYTMxYWFiMGY1MGRi'
      },
      _operation: 'GET',
      _p: `${account.fiIdentifier},${account.customerid},signonsecattr,0,0`,
      _op: null,
      businessContext: null,
      _lang: 'en'
    };
      try {
      let res = http.post(url, JSON.stringify(payload), { headers, tags: { transaction: 'Configuration_Signonsecattr' } });
      dumpResponse(res, 'Configuration_Signonsecattr');
      if (res.status === 401) {
        const cacheKeyLocal = getCacheKey(account);
        if (!canRefreshToken(cacheKeyLocal)) {
          console.warn(`[SIGNONSECATTR] Refresh suppressed by cooldown/max-policy for ${cacheKeyLocal}`);
        } else {
          jwToken = getOrRefreshJWT(account, true);
          recordRefresh(cacheKeyLocal);
          if (!jwToken) return;
          const retryHeaders = buildHeaders(jwToken, 'Configuration_Signonsecattr');
          res = http.post(url, JSON.stringify(payload), { headers: retryHeaders, tags: { transaction: 'Configuration_Signonsecattr' } });
        }
      }
      if (String(__ENV.DEBUG).toLowerCase() === 'true') console.log(`[SIGNONSECATTR DEBUG] Response status: ${res.status}`);
        try {
        const statusCode = extractStatusCode(res);
        if (statusCode === 401) {
          if (String(__ENV.DEBUG).toLowerCase() === 'true') console.log(`[SIGNONSECATTR] Business status code ${statusCode} detected — attempting token refresh and retrying once`);
          const cacheKeyLocal = getCacheKey(account);
          if (!canRefreshToken(cacheKeyLocal)) {
            console.warn(`[SIGNONSECATTR] Refresh suppressed by cooldown/max-policy for ${cacheKeyLocal}`);
          } else {
            const newToken = getOrRefreshJWT(account, true);
            recordRefresh(cacheKeyLocal);
            if (newToken) {
              const retryHeaders = buildHeaders(newToken, 'Configuration_Signonsecattr');
              const retryRes = http.post(url, JSON.stringify(payload), { headers: retryHeaders, tags: { transaction: 'Configuration_Signonsecattr' } });
              if (String(__ENV.DEBUG).toLowerCase() === 'true') console.log(`[SIGNONSECATTR DEBUG] Retry response status: ${retryRes.status}`);
              // Check and log the status code from retry
              const retryStatusCode = extractStatusCode(retryRes);
              if (String(__ENV.DEBUG).toLowerCase() === 'true' && retryStatusCode === 401) {
                console.warn('[SIGNONSECATTR WARN] Business status code 401 persists after token refresh. This might indicate an account or session issue.');
              }
              res = retryRes;
            }
          }
        }
      } catch (e) {
        if (String(__ENV.DEBUG).toLowerCase() === 'true') console.error('[SIGNONSECATTR] Error during business-status retry logic:', e.message);
      }
        dumpResponse(res, 'Configuration Signonsecattr');
        const ok = checkstatsucode(res, 'Configuration Signonsecattr');
      } catch (error) {
        handleError(error, 'GetConfigurationsSvc API');
      }
    } catch (outerError) {
      handleError(outerError, 'GetConfigurationsSvc API - Outer');
    }
  });
}// 5. Configuration Artifacts (now Get Feature Configurations Service)
function executeConfigurationArtifacts(account) {
  group('Configuration_Artifacts', () => {
    try {
      // Get user information for better logging
      const username = account && (account.username || account.userName) ? (account.username || account.userName) : 'unknown-user';
      const accountId = account && account.accountid ? account.accountid : 'unknown-acct';
      const orgId = account && account.fiIdentifier ? account.fiIdentifier : 'unknown-org';
      
      // Compute cacheKey for this account using the proper function to ensure account ID is included
      const cacheKey = getCacheKey(account);
      
      if (String(__ENV.DEBUG).toLowerCase() === 'true') {
        console.log(`[FEATURECONFIG] Using cache key for user ${username} (account ${accountId}): ${cacheKey}`);
      }
      
      // Get token data including the JWT and cookies
      const tokenData = getOrRefreshJWT(account);
      
      // Enforce presence of a real token: skip if missing
      if (!tokenData) {
        console.error(`[FEATURECONFIG] No JWT token available for user ${username} (account ${accountId}) - skipping transaction`);
        return;
      }
      
      // Handle both cases: tokenData as object with jwToken or direct string token
      let jwToken = typeof tokenData === 'object' && tokenData.jwToken ? tokenData.jwToken : tokenData;
      
      // CRITICAL: Verify the token's account matches the transaction account
      if (typeof tokenData === 'object' && tokenData.accountId && tokenData.accountId !== accountId) {
        console.error(`[FEATURECONFIG ACCOUNT MISMATCH] Token is for account ${tokenData.accountId} but transaction is for account ${accountId}!`);
        console.error(`[FEATURECONFIG ACCOUNT MISMATCH] Token username: ${tokenData.username}, Transaction username: ${username}`);
        console.error(`[FEATURECONFIG ACCOUNT MISMATCH] Cache key used: ${cacheKey}`);
        
        // CRITICAL FIX: Always regenerate a fresh token for this account
        console.log(`[FEATURECONFIG ACCOUNT MISMATCH] Forcing token refresh for account ${accountId}`);
        
        // Force regenerate token with explicit force refresh flag
        const freshTokenData = getOrRefreshJWT(account, true);
        if (freshTokenData && freshTokenData.jwToken) {
          jwToken = freshTokenData.jwToken;
          console.log(`[FEATURECONFIG ACCOUNT MISMATCH] Successfully generated fresh token for account ${accountId}`);
        } else {
          console.error('[FEATURECONFIG ACCOUNT MISMATCH] Failed to regenerate token - skipping transaction');
          return;
        }
      }
      
      // COOKIES REMOVED: Testing confirmed cookies are NOT required for API authentication
      const headers = buildHeaders(jwToken, 'Configuration_Artifacts', { 'organization-id': account.fiIdentifier || organizationId });
      const url = `${baseURL}/cuflex/ExternalApp/Authentication/GetFeatureConfigurationsSvc`;
    const payload = {
      _credentials: {
        _deviceToken: 'MglCcm93c2VyCTIJdW5rbm93bgkyCTEJMmU0YWFmM2VhMjM2M2JmY2M0ZmFhZWFkYjVjOGNjMWMJZGlnaXRhbEJBTktJTkctMS4wLjAuMAkJMjAyNS0wNi0wNlQwNjowNDo0MS4zNTdaCQlHZXRGZWF0dXJlQ29uZmlndXJhdGlvbnNTdmMJCWVuCTcwZGE3YWVkLWZhOTMtNGEyYS05ZDY1LWY0YmNkNjQxZTZkZA'
      },
      _p: `${account.fiIdentifier},${account.accountid},languages%2CFlexUIConfig%2Cdormantaccountconfig,0,0`,
      _op: '',
      businessContext: null,
      _lang: 'en'
    };
      try {
      let res = http.post(url, JSON.stringify(payload), { headers, tags: { transaction: 'Configuration_Artifacts' } });
      dumpResponse(res, 'Configuration_Artifacts');
      if (res.status === 401) {
        const cacheKeyLocal = getCacheKey(account);
        if (!canRefreshToken(cacheKeyLocal)) {
          console.warn(`[FEATURECONFIG] Refresh suppressed by cooldown/max-policy for ${cacheKeyLocal}`);
        } else {
          jwToken = getOrRefreshJWT(account, true);
          recordRefresh(cacheKeyLocal);
          if (!jwToken) return;
          const retryHeaders = buildHeaders(jwToken, 'Configuration_Artifacts');
          res = http.post(url, JSON.stringify(payload), { headers: retryHeaders, tags: { transaction: 'Configuration_Artifacts' } });
        }
      }
  if (String(__ENV.DEBUG).toLowerCase() === 'true') console.log(`[FEATURECONFIG DEBUG] Response status: ${res.status}`);
        try {
        const statusCode = extractStatusCode(res);
        if (statusCode === 401) {
          if (String(__ENV.DEBUG).toLowerCase() === 'true') console.log(`[FEATURECONFIG] Business status code ${statusCode} detected — attempting token refresh and retrying once`);
          const cacheKeyLocal = getCacheKey(account);
          if (!canRefreshToken(cacheKeyLocal)) {
            console.warn(`[FEATURECONFIG] Refresh suppressed by cooldown/max-policy for ${cacheKeyLocal}`);
          } else {
            const newToken = getOrRefreshJWT(account, true);
            recordRefresh(cacheKeyLocal);
            if (newToken) {
              const retryHeaders = buildHeaders(newToken, 'Configuration_Artifacts');
              const retryRes = http.post(url, JSON.stringify(payload), { headers: retryHeaders, tags: { transaction: 'Configuration_Artifacts' } });
              if (String(__ENV.DEBUG).toLowerCase() === 'true') console.log(`[FEATURECONFIG DEBUG] Retry response status: ${retryRes.status}`);
              // Check and log the status code from retry
              const retryStatusCode = extractStatusCode(retryRes);
              if (String(__ENV.DEBUG).toLowerCase() === 'true' && retryStatusCode === 401) {
                console.warn('[FEATURECONFIG WARN] Business status code 401 persists after token refresh. This might indicate an account or session issue.');
              }
              res = retryRes;
            }
          }
        }
      } catch (e) {
        if (String(__ENV.DEBUG).toLowerCase() === 'true') console.error('[FEATURECONFIG] Error during business-status retry logic:', e.message);
      }
        dumpResponse(res, 'Configuration Artifacts');
        const ok = checkstatsucode(res, 'Configuration Artifacts');
      } catch (error) {
        handleError(error, 'GetFeatureConfigurationsSvc API');
      }
    } catch (outerError) {
      handleError(outerError, 'GetFeatureConfigurationsSvc API - Outer');
    }
  });
}// Define transaction executors (after function declarations)
const transactionExecutors = {
  'HistoryTransactions': executeHistoryTransactions,
  'Accounts': executeAccounts,
  'AccountsContextMenu': executeAccountsContextMenu,
  'ConfigurationSignonsecattr': executeConfigurationSignonsecattr,
  'ConfigurationArtifacts': executeConfigurationArtifacts
};

// Create transaction distribution manager
// Debug instrumentation to verify weights and env override prior to manager construction
try {
  const sumWeights = transactionDefinitions.reduce((s, t) => s + (typeof t.weight === 'number' ? t.weight : 0), 0);
  console.log(`[DEBUG TX] Pre-construction weights: ${transactionDefinitions.map(t => `${t.name}:${t.weight}`).join(', ')}`);
  console.log(`[DEBUG TX] Pre-construction weight sum: ${sumWeights}`);
  if (typeof __ENV.TRANSACTION_DISTRIBUTION !== 'undefined') {
    console.log(`[DEBUG TX] TRANSACTION_DISTRIBUTION env value: '${__ENV.TRANSACTION_DISTRIBUTION}'`);
  } else {
    console.log('[DEBUG TX] TRANSACTION_DISTRIBUTION env value: <undefined>');
  }
} catch (e) {
  console.warn('[DEBUG TX] Failed to log pre-construction weights:', e && e.message);
}

const transactionManager = new TransactionDistributionManager(
  transactionDefinitions,
  transactionExecutors,
  __ENV.TRANSACTION_DISTRIBUTION
);
