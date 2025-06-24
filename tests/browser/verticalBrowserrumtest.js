import { browser } from 'k6/browser';
import { Trend, Rate } from 'k6/metrics';
import { check } from 'k6';
import { sleep } from 'k6';
import { loadCsvFile, createCsvIterator } from '../../utils/csvReader.js';
import { scenarios, thresholds, buildCustomScenario } from '../../config/scenario.js';
import { collectCoreWebVitals } from '../../utils/browserMetrics.js';

// --- Metrics ---
const pageLoadTime = new Trend('browser_page_load_time');
const pageLoadSuccess = new Rate('browser_page_load_success'); // Only one Rate metric for pass/fail

// Core Web Vitals metrics
const lcpByTemplate = new Trend('browser_lcp', true);
const fcpByTemplate = new Trend('browser_fcp', true);
const clsByTemplate = new Trend('browser_cls', true);
const ttfbByTemplate = new Trend('browser_ttfb', true);

// --- Configuration parameters ---
const testType = __ENV.TEST_TYPE || 'BROWSER';
const csvFilename = __ENV.CSV_FILENAME || 'shape.csv';
const baseUrl = __ENV.BASE_URL || 'http://localhost:3000';
const scenarioType = __ENV.SCENARIO_TYPE || 'smoke';
const environment = __ENV.ENVIRONMENT || 'dev';
const headless = __ENV.HEADLESS_BROWSER === 'true';
const timeUnit = __ENV.TIME_UNIT || '1s';
const vertical = __ENV.VERTICAL || 'default';

// Build scenario configuration based on the scenario type
let scenarioConfig;
if (scenarioType === 'custom-tps' || scenarioType === 'custom-vus') {
  scenarioConfig = buildCustomScenario(scenarioType, __ENV.RAMPING_STAGES, timeUnit);
} else {
  scenarioConfig = scenarios[testType][scenarioType];
}

// Ensure browser type is set for BROWSER test type
if (testType === 'BROWSER' && !scenarioConfig.options) {
  scenarioConfig.options = { 
    browser: { 
      type: 'chromium',
      // Add browser stability settings
      args: [
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-web-security',
        '--allow-running-insecure-content'
      ]
    } 
  };
}

export const options = {
  thresholds: thresholds[testType],
  scenarios: {
    browser: scenarioConfig,
  },
};

// --- Global shared iterator for strict sequential extraction ---
// Read the CSV file directly in the test script to avoid path resolution issues
const csvFilePath = `./../../testdata/${csvFilename}`;
let csvData;
try {
  const csvContent = open(csvFilePath);

  // Load CSV data with the new utility, passing the content directly
  csvData = loadCsvFile(csvContent, {
    name: `${vertical}_urls`,
    filter: item => item && item.templatename && item.urlpath,
    transform: (item) => {
      const templateName = item.templatename.trim();
      const urlPath = item.urlpath.trim();
      const queryString = item.querystring ? item.querystring.trim() : '';
      const fullGetUrl = `${baseUrl}${urlPath}${queryString ? '?' + queryString : ''}`;
      return {
        templateName,
        fullGetUrl,
        urlPath
      };
    }
  });
} catch (csvError) {
  console.error(`Error loading CSV file: ${csvError}`);
  csvData = []; // Ensure csvData is an empty array to prevent further errors
}
console.log('SELECTION_MODE:', __ENV.SELECTION_MODE);
const urlIterator = createCsvIterator(csvData, { selectionMode: __ENV.SELECTION_MODE });

export async function setup() {
  console.log(`Starting browser test with vertical: ${vertical}, environment: ${environment}`);
}

export default async function() {
  const urlData = urlIterator.next();

  if (!urlData) {
    console.warn('No URL data available. Check if CSV file is properly loaded.');
    return;
  }

  // Defensive tags construction
  const tags = {
    template: urlData.templateName || 'unknown_template',
    vertical: vertical,
    environment: environment,
  };

  // Create browser page with longer timeout
  const page = await browser.newPage({
    timeout: 90000 // Increase timeout to 90 seconds
  });
  
  // Add network request monitoring for Elastic RUM - using try/catch for safety
  try {
    page.on('request', request => {
      try {
        const url = request.url();
        if (url.includes('elastic') || url.includes('rum') || url.includes('apm')) {
          console.log(`[RUM DEBUG] Detected potential Elastic RUM request: ${url}`);
        }
      } catch (e) {
        console.log(`[RUM DEBUG] Error in request listener: ${e}`);
      }
    });
  } catch (eventError) {
    console.log(`[RUM DEBUG] Browser doesn't support request event: ${eventError}`);
  }
  
  // Add response monitoring for debugging - using try/catch for safety
  try {
    page.on('response', response => {
      try {
        const url = response.url();
        if (url.includes('elastic') || url.includes('rum') || url.includes('apm')) {
          console.log(`[RUM DEBUG] Received response from potential Elastic RUM endpoint: ${url}, status: ${response.status()}`);
        }
      } catch (e) {
        console.log(`[RUM DEBUG] Error in response listener: ${e}`);
      }
    });
  } catch (eventError) {
    console.log(`[RUM DEBUG] Browser doesn't support response event: ${eventError}`);
  }
  
  // Add console message monitoring - using try/catch for safety
  try {
    page.on('console', msg => {
      try {
        const text = msg.text();
        if (text.includes('elastic') || text.includes('rum') || text.includes('apm')) {
          console.log(`[RUM DEBUG] Console message: ${msg.type()}: ${text}`);
        }
      } catch (e) {
        console.log(`[RUM DEBUG] Error in console listener: ${e}`);
      }
    });
  } catch (eventError) {
    console.log(`[RUM DEBUG] Browser doesn't support console event: ${eventError}`);
  }
  
  // Array to store intercepted RUM beacon details
  const interceptedRumBeacons = [];

  // Listener for responses to capture RUM beacons
  // IMPORTANT: This listener setup should be done BEFORE page navigation (e.g., page.goto())
  page.on('response', async (response) => {
    const url = response.url();
    // Ensure this pattern matches your Elastic APM intake endpoint (e.g., '/intake/v2/rum/events')
    if (url.includes('/intake/v2/rum/events')) { 
      const status = response.status();
      let responseBody = '';
      if (status < 200 || status >= 300) { // Log body only on error to avoid overhead
        try {
          responseBody = await response.text();
        } catch (e) {
          responseBody = 'Failed to get response body';
        }
      }
      console.log(`[K6 RUM] Intercepted RUM beacon: ${url}, Status: ${status}`);
      interceptedRumBeacons.push({ url, status, body: responseBody });
    }
  });
  
  const startTime = new Date();
  let pageLoadSuccessful = true;

  try { 
    console.log('[DEBUG] Main try block entered.');
    
    const fullUrl = urlData.fullGetUrl || urlData.url || `${baseUrl}`;
    console.log(`[K6 BROWSER] Navigating to: ${fullUrl} for template: ${tags.template}`);
    pageLoadSuccessful = true; // Assume success unless an error occurs
    let response;

    try {
      response = await page.goto(fullUrl, { 
        timeout: 60000, // 60 seconds navigation timeout
        waitUntil: 'domcontentloaded'
      });
    } catch (gotoError) {
      console.error(`[K6 BROWSER] Error during page.goto(${fullUrl}): ${gotoError.message}`);
      pageLoadSuccessful = false;
      response = null; // Ensure response is null if goto fails
    }

    if (response) {
      console.log(`[K6 BROWSER] Page loaded: ${page.url()}, Status: ${response.status()}`);
      // pageStatus.add(1, { ...tags, http_status: response.status() }); // Metric re-addition later
      
      // --- RUM PROCESSING --- 
      try { // RUM PROCESSING TRY (Restoring this block)
        // Original RUM processing logic, page.evaluate, beacon checks etc.
        // including the try/catch for waitFor (which is still commented inside page.evaluate)
        
        // Wait for a reasonable amount of time for scripts to load
        console.log('[RUM DEBUG] Waiting for page to stabilize before RUM eval...');
        sleep(2); // Give page time to stabilize
        
        // Add delay for RUM agent to send beacons (this was outside page.evaluate before, seems fine here)
        const rumBeaconWaitDelay = 5000; 
        console.log(`[K6 RUM] Waiting ${rumBeaconWaitDelay / 1000}s for RUM beacons to be sent (before page.evaluate)...`);
        // Note: page.waitForTimeout might be better outside page.evaluate if it's a k6 browser API, 
        // but if it's meant to be a browser context timeout, it needs to be handled differently.
        // For now, this is a k6-side sleep. We might need page.waitForTimeout(rumBeaconWaitDelay); if that was the intent for browser context.
        // Let's assume it was a k6 sleep for now. The original await page.waitForTimeout(rumBeaconWaitDelay); was at k6 level.

        let isAgentReadyForEvaluate = false;
        try {
          console.log('[K6 RUM] Attempting to wait for Elastic APM agent initialization using page.waitForFunction()...');
          await page.waitForFunction(() => {
            return window.elasticApm && typeof window.elasticApm.startTransaction === 'function';
          }, { timeout: 10000 }); // Increased timeout to 10 seconds
          isAgentReadyForEvaluate = true;
          console.log('[K6 RUM] Elastic APM agent detected and ready via page.waitForFunction().');
        } catch (wfError) {
          console.log(`[K6 RUM] Timeout or error waiting for Elastic APM agent via page.waitForFunction(): ${wfError.message}`);
          isAgentReadyForEvaluate = false;
        }

        const rumDebugInfo = await page.evaluate((currentTags, agentIsReady) => {
          // waitFor function definition is removed as it's no longer used here
          /*
          const waitFor = (condition, timeout = 5000, pollInterval = 100) => { ... };
          */

          let scripts = [];
          let hasGTM = false;
          let hasElasticAgent = false;
          let hasApmGlobal = false;
          let elasticKeys = [];
          let rumAgentInitialized = false; // This will be set based on agentIsReady
          let manualTransactionStatus = 'not attempted';
          let labelsAddedStatus = 'not attempted';

          try { // Inner try for page.evaluate main logic
            scripts = Array.from(document.scripts)
              .map(script => script.src)
              .filter(src => src && (src.includes('elastic') || src.includes('rum') || src.includes('apm')));
            
            hasGTM = typeof window.dataLayer !== 'undefined' || document.querySelector('script[src*="googletagmanager"]') !== null;
            
            const windowKeysRaw = Object.keys(window);
            elasticKeys = windowKeysRaw.filter(key => key.includes('elastic') || key.includes('apm') || key.includes('rum'));
            // We still check window.elasticApm here for completeness, though agentIsReady should be the primary guide
            hasElasticAgent = typeof window.elasticApm !== 'undefined'; 
            hasApmGlobal = typeof window.apm !== 'undefined';

            if (agentIsReady && hasElasticAgent) { // Check both agentIsReady and hasElasticAgent
              console.log('[RUM EVAL] Elastic APM agent confirmed ready.');
              rumAgentInitialized = true; // Set based on the successful wait
              
              // No need for the inner try/catch that wrapped 'await waitFor' anymore for this specific purpose
              // The following logic assumes agent is ready.
              if (window.elasticApm.addLabels) {
                window.elasticApm.addLabels({
                  template: currentTags.template,
                  vertical: currentTags.vertical,
                  environment: currentTags.environment,
                  k6_scenario: currentTags.scenarioType || 'unknown_scenario'
                });
                labelsAddedStatus = 'success';
                console.log('[RUM EVAL] Attempted to add custom labels to Elastic APM.');
              } else {
                labelsAddedStatus = 'addLabels not available';
                console.log('[RUM EVAL] window.elasticApm.addLabels is not a function.');
              }

              if (window.elasticApm.startTransaction) {
                const transaction = window.elasticApm.startTransaction('k6-browser-interaction', 'custom', { managed: true });
                if (transaction) {
                  const span = transaction.startSpan('k6-page-action', 'custom.k6');
                  if (span) span.end();
                  transaction.end();
                  manualTransactionStatus = 'success';
                  console.log('[RUM EVAL] Attempted to create and end Elastic APM transaction and span.');
                } else {
                  manualTransactionStatus = 'startTransaction returned null';
                  console.log('[RUM EVAL] window.elasticApm.startTransaction returned null.');
                }
              } else {
                manualTransactionStatus = 'startTransaction not available';
                console.log('[RUM EVAL] window.elasticApm.startTransaction is not a function.');
              }
            } else {
              if (!agentIsReady) console.log('[RUM EVAL] Agent was not ready (based on pre-evaluate check).');
              if (!hasElasticAgent) console.log('[RUM EVAL] window.elasticApm NOT detected within evaluate.');
              rumAgentInitialized = false; // Ensure it's false if conditions not met
            }
            
            return {
              scripts, hasGTM, hasElasticAgent, hasApmGlobal, elasticKeys, 
              rumAgentInitialized, manualTransactionStatus, labelsAddedStatus, error: null
            };
          } catch (evalPageError) {
            console.error('[RUM EVAL] Error inside page.evaluate main try: ', evalPageError.message, evalPageError.stack);
            return { error: evalPageError.message, stack: evalPageError.stack };
          }
        }, tags, isAgentReadyForEvaluate); // Pass isAgentReadyForEvaluate here

        // Log all the gathered information
        console.log('[RUM DEBUG] ---- Elastic RUM Debug Information ----');
        if (rumDebugInfo.error) {
          console.log(`[RUM DEBUG] Error during evaluation: ${rumDebugInfo.error}`);
          if (rumDebugInfo.stack) console.log(`[RUM DEBUG] Eval Stack: ${rumDebugInfo.stack}`);
        } else {
          console.log(`[RUM DEBUG] RUM Scripts Found on page: ${rumDebugInfo.scripts?.length || 0}`);
          if (rumDebugInfo.scripts?.length > 0) rumDebugInfo.scripts.forEach(src => console.log(`[RUM DEBUG]   Script Source: ${src}`));
          console.log(`[RUM DEBUG] Elastic Agent Present (window.elasticApm): ${rumDebugInfo.hasElasticAgent}`);
          console.log(`[RUM DEBUG] RUM Agent Initialized (from eval): ${rumDebugInfo.rumAgentInitialized}`); // Check this output
          console.log(`[RUM DEBUG] Elastic Config Keys: ${JSON.stringify(rumDebugInfo.elasticKeys)}`);
          console.log(`[RUM DEBUG] Manual Transaction Status: ${rumDebugInfo.manualTransactionStatus}`);
          console.log(`[RUM DEBUG] Labels Added Status: ${rumDebugInfo.labelsAddedStatus}`);
        }

        // Validate intercepted RUM beacon responses
        console.log('[K6 RUM] Validating RUM beacon responses...');
        let allBeaconsOk = true;
        if (interceptedRumBeacons.length === 0) {
          console.warn('[K6 RUM] No RUM beacons to Elastic APM were intercepted.');
        } else {
          interceptedRumBeacons.forEach(res => {
            if (res.status !== 202 && (res.status < 200 || res.status >= 300)) { 
              console.error(`[K6 RUM] FAILED Beacon: URL: ${res.url}, Status: ${res.status}${res.body ? ', Body: ' + res.body : ''}`);
              allBeaconsOk = false;
            } else {
              console.log(`[K6 RUM] SUCCESS Beacon (Status ${res.status}): URL: ${res.url}`);
            }
          });
        }
        check(allBeaconsOk, { 'RUM beacons sent successfully to Elastic APM': (ok) => ok, });

      } catch (e) {
        console.error(`[K6 BROWSER] Error in RUM processing block: ${e.message}`, e.stack);
        pageLoadSuccessful = false;
      }
      // --- END OF RUM PROCESSING ---

      // --- Core Web Vitals --- (Restoring this block)
      if (pageLoadSuccessful && tags.template !== 'serverStatus') {
        try {
          console.log('[DEBUG] CWV block: Attempting to collect Core Web Vitals...');
          const cwvMetrics = await collectCoreWebVitals(page, tags);
          const { lcp, fcp, cls, ttfb } = cwvMetrics;

          // Ensure metrics are numbers before adding, default to 0 or a sentinel if not.
          lcpByTemplate.add(typeof lcp === 'number' ? lcp : 0, tags);
          fcpByTemplate.add(typeof fcp === 'number' ? fcp : 0, tags);
          clsByTemplate.add(typeof cls === 'number' ? cls : 0, tags);
          ttfbByTemplate.add(typeof ttfb === 'number' ? ttfb : 0, tags);

          console.log(`[CWV DEBUG] Recorded LCP: ${lcp}, FCP: ${fcp}, CLS: ${cls}, TTFB: ${ttfb} for template: ${tags.template}`);
        } catch (cwvError) {
          console.error(`[CWV DEBUG] Error collecting Core Web Vitals: ${cwvError.message}`, cwvError.stack);
        }
      }
      // --- END OF CWV --- 

    } else {
      console.error(`[K6 BROWSER] Failed to load page or page.goto() failed: ${fullUrl}.`);
      // pageStatus.add(1, { ...tags, http_status: 0 }); // Restore metric
      pageLoadSuccessful = false;
    }
    
    // --- Previously commented section is now fully integrated or confirmed empty ---

  } catch (loadError) { 
    console.error(`Error during page processing: ${loadError.message}`, loadError.stack);
    pageLoadSuccessful = false;
  } finally {
    try {
      if (page) { 
        await page.close();
      }
    } catch (closeError) {
      console.log(`[RUM DEBUG] Error closing page: ${closeError}`);
    }
  }

  // --- Emit pass/fail as a single Rate metric (THIS IS THE KEY LINE) ---
  pageLoadSuccess.add(pageLoadSuccessful ? 1 : 0, tags);
}

export async function teardown() {
  console.log('Browser test completed');
}