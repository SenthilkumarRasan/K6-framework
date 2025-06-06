import { browser } from 'k6/browser'; // Corrected to stable browser module
import { Trend, Rate } from 'k6/metrics';
import { SharedArray } from 'k6/data';
import { createCsvIterator, parseCsvWithHeaders } from '../../utils/csvReader.js';
import { scenarios, thresholds, buildCustomScenario } from '../../config/scenario.js'; 
import { collectCoreWebVitals } from '../../utils/coreVitals.js'; 

// --- Metrics ---
const pageLoadTime = new Trend('browser_page_load_time');
const pageLoadSuccess = new Rate('browser_page_load_success'); 

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
const parsedCsvData = new SharedArray('shared array', function () {
  // Read the raw CSV string
  const csvFileContent = open(csvFilePath);
  // Parse it using the new function
  return parseCsvWithHeaders(csvFileContent);
});

const urlIterator = createCsvIterator(parsedCsvData, { selectionMode: __ENV.SELECTION_MODE });

export async function setup() {
  console.log(`Starting browser test with vertical: ${vertical}, environment: ${environment}`);
}

export default async function() {
  const urlData = urlIterator.next();

  if (!urlData) {
    console.warn(`[K6 BROWSER] VU: ${__VU}, Iteration: ${__ITER} - No more URL data available from iterator. Skipping iteration.`);
    return;
  }

  // Construct fullUrl and templateName from urlData based on CSV headers
  const path = urlData.urlpath ? urlData.urlpath.trim() : '';
  const qs = urlData.querystring ? urlData.querystring.trim() : '';
  const fullUrl = `${baseUrl}${path}${qs ? '?' + qs : ''}`;
  const templateNameFromCsv = urlData.templatename ? urlData.templatename.trim() : 'unknown_template';

  const tags = {
    template: templateNameFromCsv,
    vertical: vertical,
    environment: environment,
    test_type: testType,
    scenario: scenarioType,
    url_name: path.substring(0,50) // Use the path as a default url_name, capped at 50 chars
  };

  // Create browser page with longer timeout
  const page = await browser.newPage({
    timeout: 90000 // Increase timeout to 90 seconds
  });
  
  let pageLoadSuccessful = true;
  let navigationError = null;

  try {
    console.log(`[K6 BROWSER] Navigating to: ${fullUrl} for template: ${tags.template}`);
    const startTime = new Date();
    const res = await page.goto(fullUrl, { waitUntil: 'load', timeout: 60000 });

    const currentUrl = page.url();
    const status = res.status();

    if (status !== 200 && status !== 0) { // status 0 can sometimes be okay for file:// or about:blank
      console.error(`[K6 BROWSER] Page load failed for ${currentUrl}. Status: ${status}`);
      pageLoadSuccessful = false;
      navigationError = `Page load failed with status ${status}`;
    } else {
      console.log(`[K6 BROWSER] Page loaded: ${currentUrl}, Status: ${status}`);
      pageLoadSuccessful = true;
    }

    // --- Page Load Metrics ---
    const loadTime = new Date() - startTime;
    pageLoadTime.add(loadTime, tags);
    pageLoadSuccess.add(pageLoadSuccessful, tags);

    // --- Core Web Vitals ---
    if (pageLoadSuccessful && tags.template !== 'serverStatus') {
      try {
        console.log('[DEBUG] CWV block: Attempting to collect Core Web Vitals...');
        const cwvMetrics = await collectCoreWebVitals(page); // Call imported function, no 'tags' needed here
        const { lcp, fcp, cls, ttfb } = cwvMetrics;

        // Ensure metrics are numbers before adding, default to 0 or a sentinel if not.
        if (typeof lcp === 'number') lcpByTemplate.add(lcp, tags);
        if (typeof fcp === 'number') fcpByTemplate.add(fcp, tags);
        if (typeof cls === 'number') clsByTemplate.add(cls, tags);
        if (typeof ttfb === 'number') ttfbByTemplate.add(ttfb, tags);

      } catch (cwvError) {
        console.error(`[K6 BROWSER] Error collecting Core Web Vitals: ${cwvError.message}`, cwvError.stack);
        // Optionally, mark pageLoadSuccessful as false or add a specific CWV error metric
      }
    } else if (tags.template === 'serverStatus') {
      console.log('[DEBUG] Skipping Core Web Vitals for serverStatus template.');
    } else if (!pageLoadSuccessful) {
      console.log('[DEBUG] Skipping Core Web Vitals due to page load failure.');
    }

  } catch (e) {
    console.error(`[K6 BROWSER] Error during page navigation or processing for ${fullUrl}: ${e.message}`, e.stack);
    pageLoadSuccessful = false;
    navigationError = e.message.substring(0, 200); // Cap error message length
    pageLoadSuccess.add(false, { ...tags, error: navigationError }); // Add to rate with error tag
    // No pageLoadTime metric is added here as the load might not have completed or timed out.
  } finally {
    if (page) {
      try {
        await page.close();
      } catch (closeError) {
        console.error(`[K6 BROWSER] Error closing page: ${closeError.message}`);
      }
    }
    // Optional: Add a small delay if needed between iterations, though ramping handles overall pacing.
    // sleep(1); 
  }
}

export async function teardown() {
  console.log('Browser test completed');
}