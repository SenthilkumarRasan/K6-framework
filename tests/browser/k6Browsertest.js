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
const csvFilename = __ENV.CSV_FILENAME || 'data.csv';
const baseUrl = __ENV.BASE_URL || 'http://localhost:3000';
const scenarioType = __ENV.SCENARIO_TYPE || 'smoke';
const environment = __ENV.ENVIRONMENT || 'dev';
const headless = __ENV.HEADLESS_BROWSER === 'true';
const timeUnit = __ENV.TIME_UNIT || '1s';

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

export async function setup() {
  console.log('Setting up browser test');
  const csvData = loadCsvFile(`./../../data/${csvFilename}`);
  return createCsvIterator(csvData, {
    header: true,
    delimiter: ',',
    newline: '\r\n',
    dynamicTyping: true,
    skipEmptyLines: true,
    transformHeader: header => header.replace(/\W/g, '_'),
    filter: row => row.templatename !== '',
  });
}

export default async function (urlData, tags) {
  console.log('CWV metric tags:', JSON.stringify(tags));
  console.log(`Starting test for template: ${tags.template}`);
  const page = await browser.newPage();
  const startTime = new Date();
  let pageLoadSuccessful = true;

  try {
    console.log(`Navigating to: ${urlData.fullGetUrl}`);
    const response = await page.goto(urlData.fullGetUrl);

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

    const loadTime = new Date() - startTime;
    sleep(5);

    // --- Core Web Vitals Collection (only if page load was successful) ---
    if (pageLoadSuccessful) {
      pageLoadTime.add(loadTime, tags);
      try {
        const cwvMetrics = await collectCoreWebVitals(page, tags);
        const { lcp, fcp, cls, ttfb, success } = cwvMetrics;

        lcpByTemplate.add(lcp, tags);
        fcpByTemplate.add(fcp, tags);
        clsByTemplate.add(cls, tags);
        ttfbByTemplate.add(ttfb, tags);

        console.log(`Recorded LCP: ${lcp}, FCP: ${fcp}, CLS: ${cls}, TTFB: ${ttfb} for template: ${tags.template}`);
      } catch (cwvError) {
        console.error(`Error collecting Core Web Vitals: ${cwvError}`);
        pageLoadSuccessful = false;
      }
    }

  } catch (error) {
    console.error(`Error during browser test for ${urlData.fullGetUrl}: ${error}`);
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