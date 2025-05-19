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
  scenarioConfig.options = { browser: { type: 'chromium' } };
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
console.log("SELECTION_MODE:", __ENV.SELECTION_MODE);
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

  const page = await browser.newPage();
  const startTime = new Date();
  let pageLoadSuccessful = true;

  try {
    const fullUrl = urlData.fullGetUrl || urlData.url || `${baseUrl}`;
    console.log(`Navigating to: ${fullUrl}`);
    let response;
    try {
      response = await page.goto(fullUrl, { timeout: 60000 }); // Increased timeout
    } catch (gotoError) {
      console.error(`Error during page.goto(${fullUrl}): ${gotoError}`);
      pageLoadSuccessful = false;
    }

    if (response) {
      try {
        if (!check(response, { 'status is not an error': (r) => r.status() < 400 })) {
          pageLoadSuccessful = false;
        }
        await page.waitForLoadState('domcontentloaded', { timeout: 45000 });
        try {
          await page.waitForLoadState('networkidle', { timeout: 45000 });
        } catch (networkIdleError) {
          console.log(`Network not idle for ${tags.template}, continuing with test`);
        }
      } catch (loadError) {
        console.error(`Timeout waiting for page to load: ${loadError}`);
        pageLoadSuccessful = false;
      }
    } else {
      console.error(`page.goto() returned no response for ${fullUrl}`);
      pageLoadSuccessful = false;
    }

    const loadTime = new Date() - startTime;

    // Add pageLoadTime for all successful loads, including serverStatus
    if (pageLoadSuccessful) {
      pageLoadTime.add(loadTime, tags);
    }

    // --- Core Web Vitals: Only for successful loads and not serverStatus ---
    if (
      pageLoadSuccessful &&
      tags.template !== 'serverStatus') {
      try {
        const cwvMetrics = await collectCoreWebVitals(page, tags);
        const { lcp, fcp, cls, ttfb } = cwvMetrics;

        lcpByTemplate.add(lcp, tags);
        fcpByTemplate.add(fcp, tags);
        clsByTemplate.add(cls, tags);
        ttfbByTemplate.add(ttfb, tags);

        console.log(`Recorded LCP: ${lcp}, FCP: ${fcp}, CLS: ${cls}, TTFB: ${ttfb} for template: ${tags.template}`);
      } catch (cwvError) {
        console.error(`Error collecting Core Web Vitals: ${cwvError}`);
        // Optionally, set pageLoadSuccessful = false if you want to treat CWV collection failure as a test failure
      }
    }

  } catch (error) {
    console.error(`Error during browser test for ${urlData.fullGetUrl || urlData.url}: ${error}`);
    pageLoadSuccessful = false;
  } finally {
    await page.close();
  }

  // --- Emit pass/fail as a single Rate metric (THIS IS THE KEY LINE) ---
  pageLoadSuccess.add(pageLoadSuccessful ? 1 : 0, tags);
}

export async function teardown() {
  console.log('Browser test completed');
}