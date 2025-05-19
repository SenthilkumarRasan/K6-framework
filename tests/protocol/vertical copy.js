import { group, sleep } from "k6"
import { loadCsvFile, createCsvIterator } from '../../utils/csvReader.js';
import { get } from '../../utils/httpClient.js';
import { scenarios, thresholds, buildCustomScenario } from '../../config/scenario.js';


const testType = __ENV.TEST_TYPE || 'PROTOCOL'; // Default to PROTOCOL if not specified
const scenarioType = __ENV.SCENARIO_TYPE || 'smoke'; // Default to smoke if not specified
const environment = __ENV.ENVIRONMENT || 'dev'; // Get environment or default to dev

let scenarioConfig;
if (scenarioType === 'custom-tps' || scenarioType === 'custom-vus') {
  scenarioConfig = buildCustomScenario(scenarioType, __ENV.RAMPING_STAGES);
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

export default function() {
  // Get the next URL from the iterator
  const urlData = urlIterator.next();
  
  if (!urlData) {
    console.error('No URL data available. Check if CSV file is properly loaded.');
    return;
  }
  
  // Create a single tags object with both template name and environment
  const tags = { 
    template: urlData.templateName,
    environment: environment,
    vertical: vertical
  };

  group(urlData.templateName, function () {
    let getResp;
    try {
      getResp = get(
        urlData.fullGetUrl,
        {
          headers: {
            "accept": "text/html,application/xhtml+xml",
            "accept-encoding": "gzip, deflate",
          },
          tags
        },
        {
          name: `GET ${urlData.templateName}`,
          tags
        }
      );
      if (getResp.status !== 200) {
        console.error(`GET failed with status ${getResp.status} for ${urlData.fullGetUrl}`);
      }
    } catch (error) {
      console.error(`Error during GET request: ${error}`);
    }
    sleep(1);
  });
}