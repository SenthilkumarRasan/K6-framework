import { browser } from 'k6/browser';
import { check, sleep, group } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import { loadCsvFile, createCsvIterator } from '../../utils/csvReader.js';
import { scenarios, thresholds, buildCustomScenario } from '../../config/scenario.js';

// Configuration parameters
const testType = __ENV.TEST_TYPE || 'BROWSER';
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
    custom_scenario: {
      ...scenarioConfig,
    },
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(50)', 'p(90)', 'p(95)', 'p(99)'],
};

const baseUrl = "https://www-allrecipes-carbon-pe.a-ue1.allrecipes.com";

// Get CSV filename from environment variable or use default
const csvFilename = __ENV.CSV_FILENAME || 'vertical.csv';
const csvFilePath = `../../testdata/${csvFilename}`;

// Extract the vertical name from the CSV filename (remove .csv extension)
const vertical = csvFilename.replace('.csv', '');

// Read the CSV file directly in the test script to avoid path resolution issues
const csvContent = open(csvFilePath);

// Load CSV data with the new utility, passing the content directly
const csvData = loadCsvFile(csvContent, {
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

// Set selection mode from environment variable or use default
const selectionMode = __ENV.SELECTION_MODE || 'sequential';

// Create an iterator with the specified selection mode
const urlIterator = createCsvIterator(csvData, { selectionMode });

// Create custom metrics to track by template
const pageLoadTime = new Trend('browser_page_load_time');
const pageRenderTime = new Trend('browser_render_time');
const pageInteractiveTime = new Trend('browser_interactive_time');
const pageLoadSuccess = new Rate('browser_page_load_success');
const pageLoadFailure = new Rate('browser_page_load_failure');

// Custom Core Web Vitals metrics with template tags
const lcpByTemplate = new Trend('browser_lcp', true);
const fcpByTemplate = new Trend('browser_fcp', true);
const clsByTemplate = new Trend('browser_cls', true);
const ttfbByTemplate = new Trend('browser_ttfb', true);

export async function setup() {
  console.log(`Starting browser test with vertical: ${vertical}, environment: ${environment}`);
}

export default async function() {
  const urlData = urlIterator.next();

  if (!urlData) {
    console.error('No URL data available. Check if CSV file is properly loaded.');
    return;
  }

  console.log('urlData:', JSON.stringify(urlData));

  // Defensive tags construction
  const tags = {
    template: urlData.templateName || 'unknown_template',
    environment: environment || 'unknown_env',
    vertical: vertical || 'unknown_vertical'
  };

  // Debug log for tags
  console.log('CWV metric tags:', JSON.stringify(tags));

  console.log(`Starting test for template: ${tags.template}`);
  const page = await browser.newPage();
  const startTime = new Date(); // <--- Declare startTime here

  try {
    console.log(`Navigating to: ${urlData.fullGetUrl}`);
    const response = await page.goto(urlData.fullGetUrl);

    try {
      await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
      try {
        await page.waitForLoadState('networkidle', { timeout: 10000 });
      } catch (networkIdleError) {
        console.log(`Network not idle for ${tags.template}, continuing with test`);
      }
    } catch (loadError) {
      console.error(`Timeout waiting for page to load: ${loadError}`);
    }

    const loadTime = new Date() - startTime;
    pageLoadTime.add(loadTime, tags);

    // --- Core Web Vitals Collection ---
    try {
      // Wait for a short period to allow metrics to settle
      await new Promise(resolve => setTimeout(resolve, 2000));

      const lcp = await page.evaluate(() => {
        const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
        return lcpEntries.length > 0 ? lcpEntries[0].renderTime : 0;
      });
      const fcp = await page.evaluate(() => {
        const fcpEntries = performance.getEntriesByType('paint');
        return fcpEntries.length > 0 ? fcpEntries[0].startTime : 0;
      });
      const cls = await page.evaluate(() => {
        const clsEntries = performance.getEntriesByType('layout-shift');
        return clsEntries.length > 0 ? clsEntries[0].value : 0;
      });
      const ttfb = await page.evaluate(() => {
        return performance.timing.responseStart - performance.timing.requestStart;
      });

      // Record metrics with tags
      lcpByTemplate.add(lcp, tags);
      fcpByTemplate.add(fcp, tags);
      clsByTemplate.add(cls, tags);
      ttfbByTemplate.add(ttfb, tags);

      console.log(`Recorded LCP: ${lcp}, FCP: ${fcp}, CLS: ${cls}, TTFB: ${ttfb} for template: ${tags.template}`);
    } catch (error) {
      console.error(`Error collecting Core Web Vitals for ${urlData.fullGetUrl}: ${error}`);
    } finally {
      pageLoadFailure.add(1, tags);
    }

    sleep(1);
    console.log(`Completed test for template: ${tags.template}`);
  } catch (error) {
    console.error(`Error during browser test for ${urlData.fullGetUrl}: ${error}`);
    pageLoadFailure.add(1, tags);
  } finally {
    await page.close();
  }
}

export async function teardown() {
  console.log('Browser test completed');
}