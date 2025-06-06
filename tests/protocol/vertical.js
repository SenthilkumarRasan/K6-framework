import { group, sleep } from "k6"
import { createCsvIterator, parseCsvWithHeaders } from '../../utils/csvReader.js';
import { SharedArray } from 'k6/data';
import { get } from '../../utils/httpClient.js';
import { scenarios, thresholds, buildCustomScenario } from '../../config/scenario.js';


const testType = __ENV.TEST_TYPE || 'PROTOCOL'; // Default to PROTOCOL if not specified
const scenarioType = __ENV.SCENARIO_TYPE || 'smoke'; // Default to smoke if not specified
const environment = __ENV.ENVIRONMENT || 'dev'; // Get environment or default to dev
const timeUnit = __ENV.TIME_UNIT || '1s'; // Default to 1 second if not specified

let scenarioConfig;
if (scenarioType === 'custom-tps' || scenarioType === 'custom-vus') {
  scenarioConfig = buildCustomScenario(scenarioType, __ENV.RAMPING_STAGES, timeUnit);
} else {
  scenarioConfig = scenarios[testType][scenarioType];
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

const baseUrl = __ENV.BASE_URL || 'http://localhost:3000';

// Get CSV filename from environment variable or use default
const csvFilename = __ENV.CSV_FILENAME || 'vertical.csv';
const csvFilePath = `../../testdata/${csvFilename}`;

// Extract the vertical name from the CSV filename (remove .csv extension)
const vertical = csvFilename.replace('.csv', '');

// Load and process CSV data using SharedArray for efficient sharing across VUs
const processedCsvData = new SharedArray(`${vertical}_data`, function () {
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
const urlIterator = createCsvIterator(processedCsvData, { selectionMode: __ENV.SELECTION_MODE });

// Set selection mode from environment variable or use default
const selectionMode = __ENV.SELECTION_MODE || 'sequential';

export default function() {
  // Get the next raw URL data from the iterator
  const rawUrlData = urlIterator.next();
  
  if (!rawUrlData) {
    // console.log('No more raw URL data to process or CSV was empty.');
    sleep(1); // Optional: sleep if no data
    return;
  }

  // **1. Filter Data**
  // Ensure essential fields are present
  if (!(rawUrlData.templatename && rawUrlData.urlpath)) {
    console.warn(`Skipping iteration: templatename or urlpath missing for item: ${JSON.stringify(rawUrlData)}`);
    return;
  }

  // **2. Transform Data**
  const templateName = rawUrlData.templatename.trim();
  const urlPath = rawUrlData.urlpath.trim();
  const queryString = rawUrlData.querystring ? rawUrlData.querystring.trim() : '';
  const fullGetUrl = `${baseUrl}${urlPath}${queryString ? '?' + queryString : ''}`;
  
  // 'vertical' is already available from the outer scope
  const k6MetricTags = { // Renamed to avoid confusion with HTTP headers/tags
    template: templateName,
    environment: environment,
    vertical: vertical
  };

  // Define the HTTP request parameters, including the crucial headers
  const requestParams = {
      headers: {
          "accept": "text/html,application/xhtml+xml",
          "accept-encoding": "gzip, deflate",
          // Add any other headers you want to test, e.g.:
          // "User-Agent": "MyK6TestScript/1.0", 
      },
      tags: k6MetricTags // These are k6 metric tags
  };

  // --- LOGGING REQUEST DETAILS ---
 // console.log(`[VU: ${__VU}, Iter: ${__ITER}] REQUEST URL: ${fullGetUrl}`);
 // console.log(`[VU: ${__VU}, Iter: ${__ITER}] REQUEST PARAMS: ${JSON.stringify(requestParams)}`);
  // Note: For GET requests, body is typically not sent, so not logging it here.

  group(templateName, function () { // Use transformed templateName for group
    let getResp;
    try {
      getResp = get(
        fullGetUrl, // Use transformed fullGetUrl
        requestParams, // Pass the comprehensive requestParams object
        { // These are options for the processResponse function in httpClient.js
          name: `GET ${templateName}`, // This name is used for k6 checks
          tags: k6MetricTags // These tags are also for k6 checks
        }
      );

      // --- LOGGING RESPONSE DETAILS ---
      if (getResp) {
        //console.log(`[VU: ${__VU}, Iter: ${__ITER}] RESPONSE STATUS: ${getResp.status} for ${fullGetUrl}`);
        //console.log(`[VU: ${__VU}, Iter: ${__ITER}] RESPONSE HEADERS: ${JSON.stringify(getResp.headers)}`);
       // const bodySnippet = getResp.body ? getResp.body.substring(0, 200) : "(empty body)"; // Log first 200 chars
        //console.log(`[VU: ${__VU}, Iter: ${__ITER}] RESPONSE BODY SNIPPET: ${bodySnippet}... (length: ${getResp.body ? getResp.body.length : 0})`);

        if (getResp.status !== 200) {
          console.error(`[VU: ${__VU}, Iter: ${__ITER}] GET failed with status ${getResp.status} for ${fullGetUrl}. Full Body: ${getResp.body}`);
        }
      } else {
        console.error(`[VU: ${__VU}, Iter: ${__ITER}] No response object received for ${fullGetUrl}`);
      }
    } catch (error) {
      console.error(`[VU: ${__VU}, Iter: ${__ITER}] Error during GET request for ${fullGetUrl}: ${error}`);
    }
    sleep(1);
  });
}