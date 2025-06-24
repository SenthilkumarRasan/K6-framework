/* globals __ENV */
import { group, sleep } from 'k6';
import { createCsvIterator, parseCsvWithHeaders } from '../../utils/csvReader.js';
import { SharedArray } from 'k6/data';
import { scenarios, thresholds, buildCustomScenario } from '../../config/scenario.js';
import { createResourceTags, createRequestParams, fetchPageAndResources } from '../../utils/protocolUtils.js';

// --- Configuration parameters ---
const testType = __ENV.TEST_TYPE || 'PROTOCOL';
const scenarioType = __ENV.SCENARIO_TYPE || 'smoke';
const environment = __ENV.ENVIRONMENT || 'dev';
const baseUrl = __ENV.BASE_URL || 'http://localhost:3000';
const csvFilename = __ENV.CSV_FILENAME || 'vertical.csv';
const timeUnit = __ENV.TIME_UNIT || '1s';
const aut = __ENV.K6_REPORT_AUT || csvFilename.replace('.csv', '');
const rampingStages = __ENV.RAMPING_STAGES || '10s:1,1m:5,10s:1';

let scenarioConfig;
if (scenarioType === 'custom-tps' || scenarioType === 'custom-vus') {
  scenarioConfig = buildCustomScenario(scenarioType, rampingStages, timeUnit);
} else {
  scenarioConfig = scenarios[testType][scenarioType];
}

export const options = {
  // Include transaction tag in system tags to ensure it's saved in output
  systemTags: ['proto', 'subproto', 'status', 'method', 'url', 'name', 'group', 'check', 'error', 'transaction'],
  thresholds: thresholds[testType],
  scenarios: {
    custom_scenario: {
      ...scenarioConfig,
    },
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(50)', 'p(90)', 'p(95)', 'p(99)'],
};

const csvFilePath = `../../testdata/${csvFilename}`;

// Load and process CSV data using SharedArray for efficient sharing across VUs
const processedCsvData = new SharedArray(`${aut}_data`, function () {
  const csvFileContent = open(csvFilePath);
  if (!csvFileContent) {
    console.error(`Critical error: Failed to open CSV file at path: ${csvFilePath}. Returning empty array.`);
    return [];
  }
  const rawParsedData = parseCsvWithHeaders(csvFileContent);

  // Data is now raw, filtering and transformation will happen in the default function
  if (rawParsedData.length === 0) { // Log once during init if no data results
    console.warn(`Warning: CSV file ${csvFilename} is empty or could not be parsed. Check CSV content.`);
  }
  return rawParsedData; // Return raw parsed data
});

// Create a global shared iterator for URL data
// Use selection mode from environment variable or default to sequential
const urlIterator = createCsvIterator(processedCsvData, { 
  selectionMode: __ENV.SELECTION_MODE || 'sequential' 
});

/**
 * Processes URL data from CSV for protocol testing
 * Application-specific implementation for verticalNonhtml.js
 * @param {Object} rawUrlData - Raw URL data from CSV
 * @param {string} baseUrl - Base URL for the test
 * @returns {Object|null} - Processed URL data or null if invalid
 */
function processUrlData(rawUrlData, baseUrl) {
  if (!rawUrlData) {
    return null;
  }

  // Ensure essential fields are present - specific to this application's CSV structure
  if (!(rawUrlData.templatename && rawUrlData.urlpath)) {
    console.warn(`Skipping: templatename or urlpath missing for item: ${JSON.stringify(rawUrlData)}`);
    return null;
  }

  // Transform data according to this application's needs
  const transactionName = rawUrlData.templatename.trim();
  const urlPath = rawUrlData.urlpath.trim();
  const queryString = rawUrlData.querystring ? rawUrlData.querystring.trim() : '';
  const fullUrl = `${baseUrl}${urlPath}${queryString ? '?' + queryString : ''}`;

  return {
    transactionName,
    urlPath,
    queryString,
    fullUrl
  };
}

export default function() {
  // Get the next raw URL data from the iterator
  const rawUrlData = urlIterator.next();

  // Process the URL data using our utility function
  const urlData = processUrlData(rawUrlData, baseUrl);
  if (!urlData) {
    sleep(1); // Sleep if no valid data
    return;
  }

  const { transactionName, fullUrl } = urlData;
  
  // Create tags for HTML and non-HTML resources
  const { htmlTags, nonHtmlTags } = createResourceTags(transactionName, environment, aut);
  
  // Create request parameters
  const requestParams = createRequestParams(htmlTags);

  // Execute the request within a group for better reporting
  group(transactionName, function () {
    // Fetch the page and load all referenced resources
    fetchPageAndResources(
      fullUrl,
      requestParams,
      htmlTags,
      nonHtmlTags,
      baseUrl,
      { logErrors: true }
    );
    
    // Add a small sleep between iterations
    sleep(1);
  });
}
