/* eslint-disable no-unused-vars */
/* globals __ENV, __VU, __ITER */
import { SharedArray } from 'k6/data';

// Import all metrics from a single source
import * as metrics from '../../utils/metrics.js';

// Import utilities
import { createCsvIterator, parseCsvWithHeaders } from '../../utils/csvReader.js';
import { scenarios, thresholds, buildCustomScenario } from '../../config/scenario.js';
import { loadPageAndCollectMetrics, buildBrowserScenario, closeBrowserResources } from '../../utils/browserUtils.js';
import { buildMetricDefinitions } from '../../utils/browserMetrics.js';

// --- Configuration parameters ---
const testType = __ENV.TEST_TYPE || 'BROWSER';
const csvFilename = __ENV.CSV_FILENAME || 'shape.csv';
const baseUrl = __ENV.BASE_URL || 'http://localhost:3000';
const scenarioType = __ENV.SCENARIO_TYPE || 'smoke';
const environment = __ENV.ENVIRONMENT || 'dev';
const timeUnit = __ENV.TIME_UNIT || '1s';
const aut = __ENV.AUT || 'default_aut';
const captureMantleMetrics = String(__ENV.CAPTURE_MANTLE_METRICS || 'true').toLowerCase() === 'true';

// Build scenario configuration based on the scenario type
let scenarioConfig;
if (scenarioType === 'custom-tps' || scenarioType === 'custom-vus') {
  scenarioConfig = buildCustomScenario(scenarioType, __ENV.RAMPING_STAGES, timeUnit);
} else {
  scenarioConfig = scenarios[testType][scenarioType];
}

// Apply browser-specific settings
if (testType === 'BROWSER') {
  scenarioConfig = buildBrowserScenario(scenarioType, scenarioConfig);
}

export const options = {
  thresholds: thresholds[testType],
  scenarios: {
    browser: scenarioConfig,
  },
};

// --- Global shared iterator for strict sequential extraction ---
const csvFilePath = `./../../testdata/${csvFilename}`;

let parsedCsvData;
let urlIterator;
try {
  parsedCsvData = new SharedArray('shared array', function () {
    const csvFileContent = open(csvFilePath);
    const parsedData = parseCsvWithHeaders(csvFileContent);
    return parsedData;
  });
  urlIterator = createCsvIterator(parsedCsvData, { selectionMode: __ENV.SELECTION_MODE });
} catch (e) {
  console.error(`[K6 BROWSER SCRIPT] ERROR in init context during CSV processing: ${e.message}`);
}

export async function setup() {
  // Starting browser test
}

export default async function() {
  // Get the next URL from the iterator
  const urlData = urlIterator.next();
  if (!urlData) {
    console.warn(`[K6 BROWSER] VU: ${__VU}, Iteration: ${__ITER} - No more URL data available from iterator. Skipping iteration.`);
    return;
  }

  // Prepare URL and tags
  const path = urlData.urlpath ? urlData.urlpath.trim() : '';
  const qs = urlData.querystring ? urlData.querystring.trim() : '';
  const fullUrl = `${baseUrl}${path}${qs ? '?' + qs : ''}`;
  const templateNameFromCsv = urlData.templatename ? urlData.templatename.trim() : 'testTemplate';

  const tags = {
    transaction: templateNameFromCsv,
    aut: aut,
    environment: environment,
    test_type: testType,
    scenario: scenarioType,
    url_name: path.substring(0, 50)
  };

  // Create options object separately to avoid circular reference
  const metricOptions = {
    includeCoreWebVitals: true,        // Set to false to exclude Core Web Vitals
    includeDetailedTimingMetrics: true, // Set to false to exclude detailed timing metrics
    includeResourceMetrics: true,       // Set to false to exclude resource metrics
    captureMantleMetrics: captureMantleMetrics // Use the environment variable setting
  };
  
  // Build metric definitions object using the utility function
  const metricDefinitions = buildMetricDefinitions(metrics, metricOptions);

  // Load page and collect metrics using the utility function
  // The captureMantleMetrics flag is now stored in metricDefinitions._options
  const { page, context, success, metrics: collectedMetrics } = await loadPageAndCollectMetrics(
    fullUrl,
    tags,
    metricDefinitions
  );

  // Close browser resources
  try {
    await closeBrowserResources(page, context);
  } catch (error) {
    console.error(`[K6 BROWSER] Error closing browser resources: ${error.message}`);
  }
}

export function teardown() {
  // Browser test completed
}