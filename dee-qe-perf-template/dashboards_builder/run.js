/**
 * run.js - Central Report Generation Entry Point
 *
 * This script handles both performance dashboard an  // Process the data using the performance data processor
  const processedDataPath = path.join(tempDir, `${testType}_processed.json`);
  const dataProcessorPath = path.join(__dirname, 'common/performance-data-processor.js');
  
  console.log(`Using data processor: ${dataProcessorPath}`);
  
  // Verify data processor exists
  if (!fs.existsSync(dataProcessorPath)) {
    console.error(`Error: Data processor not found at ${dataProcessorPath}`);
    process.exit(1);
  }
  
  try {
    console.log(`Processing data for ${testType.toUpperCase()} performance dashboard...`);
    execSync(`node "${dataProcessorPath}" "${resultsJsonPath}" "${summaryJsonPath}" "${processedDataPath}" "${testType}" "${aut}" "${scenario}"`, { 
      stdio: 'inherit'
    });generation from k6 test results.
 * It ensures that only actual test data is used (never synthetic values or fallbacks).
 */

/* eslint-env node */

import fs from 'fs';
import path from 'path';
// ...existing code...
import { fileURLToPath } from 'url';
import { processK6Data } from './common/performance-data-processor.js';

// Get current file path for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load required modules conditionally to handle missing files gracefully
let performanceDashboardGenerator;
let browserPerformanceDashboardGenerator;

// Summary report generators for each test type
let apiSummaryReportGenerator;
let browserSummaryReportGenerator;
let protocolSummaryReportGenerator;

// Load API summary report generator as an ES module
import('./summary/api-summary-report-generator.js')
  .then(module => {
    apiSummaryReportGenerator = module;
    console.log('Successfully loaded api-summary-report-generator.js');
  })
  .catch(err => {
    console.warn(`Warning: api-summary-report-generator.js not found (${err.code || err.message})`);
    apiSummaryReportGenerator = null;
  });

// Load performance dashboard generator for API and PROTOCOL tests
try {
  performanceDashboardGenerator = await import('./performance/performance-dashboard-generator.js')
    .then(module => module.default || module);
} catch (err) {
  console.warn(`Warning: performance-dashboard-generator.js not found (${err.code || err.message})`);
  performanceDashboardGenerator = null;
}

// Load browser performance dashboard generator for BROWSER tests
try {
  browserPerformanceDashboardGenerator = await import('./performance/browser-performance-dashboard.js')
    .then(module => module);
  console.log('Successfully loaded browser-performance-dashboard.js for browser tests');
} catch (err) {
  console.warn(`Warning: browser-performance-dashboard.js not found (${err.code || err.message})`);
  try {
    // Fall back to regular version if fixed version is not found
    browserPerformanceDashboardGenerator = await import('./performance/browser-performance-dashboard-generator.js')
      .then(module => module);
    console.log('Using regular browser-performance-dashboard-generator.js as fallback');
  } catch {
    console.error('Error: No browser performance dashboard generator found');
    browserPerformanceDashboardGenerator = null;
  }
}

// Load BROWSER summary report generator as an ES module
import('./summary/browser-summary-report-generator.js')
  .then(module => {
    browserSummaryReportGenerator = module;
    console.log('Successfully loaded browser-summary-report-generator.js');
  })
  .catch(err => {
    console.warn(`Warning: browser-summary-report-generator.js not found (${err.code || err.message})`);
    browserSummaryReportGenerator = null;
  });

// Load PROTOCOL summary report generator as an ES module
import('./summary/protocol-summary-report-generator.js')
  .then(module => {
    protocolSummaryReportGenerator = module;
    console.log('Successfully loaded protocol-summary-report-generator.js');
  })
  .catch(err => {
    console.warn(`Warning: protocol-summary-report-generator.js not found (${err.code || err.message})`);
    protocolSummaryReportGenerator = null;
  });

/**
 * Generate a performance dashboard from k6 test results
 * 
 * For BROWSER tests: Uses browser-performance-dashboard-generator.js with browser template
 * For API/PROTOCOL tests: Uses performance-dashboard-generator.js with standard template
 *
 * @param {string} resultsJsonPath - Path to the raw k6 results JSON file
 * @param {string} summaryJsonPath - Path to the k6 summary JSON file
 * @param {string} outputPath - Path to write the dashboard to
 * @param {string} testType - Test type (api, browser, protocol)
 * @param {string} aut - Application under test name
 * @param {string} scenario - Test scenario name
 * @param {object} templatePaths - Object containing paths to template files
 */
async function generatePerformanceDashboard(resultsJsonPath, summaryJsonPath, outputPath, testType, aut, scenario, templatePaths) {
  // Create temp directory if it doesn't exist
  const tempDir = path.join(process.cwd(), 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  // Step 1: Process the data using the performance data processor
  // The same processor is used for all test types
  const processedDataPath = path.join(tempDir, `${testType}_processed.json`);
  const dataProcessorPath = path.join(__dirname, 'common/performance-data-processor.js');
  
  console.log(`Using data processor: ${dataProcessorPath}`);
  
  // Verify data processor exists
  if (!fs.existsSync(dataProcessorPath)) {
    console.error(`Error: Data processor not found at ${dataProcessorPath}`);
    process.exit(1);
  }
  
  try {
    console.log(`Processing data for ${testType.toUpperCase()} performance dashboard...`);
    
    // Use the imported processK6Data function directly
    await processK6Data(
      resultsJsonPath,
      summaryJsonPath,
      processedDataPath,
      { testType, aut, scenario },
      { filterNonHtml: testType === 'PROTOCOL' }
    );
    
    // Verify processed data was created
    if (!fs.existsSync(processedDataPath)) {
      console.error(`Error: Processed data file not created at ${processedDataPath}`);
      process.exit(1);
    }
    
    // Step 2: Generate dashboard using the appropriate generator based on test type
    if (testType === 'browser') {
      // BROWSER TEST: Use browser-specific dashboard generator and template
      if (!browserPerformanceDashboardGenerator) {
        console.error('Error: Browser performance dashboard generator not available');
        process.exit(1);
      }
      
      const browserTemplatePath = templatePaths.performance.browser;
      if (!fs.existsSync(browserTemplatePath)) {
        console.error(`Error: Browser performance dashboard template not found: ${browserTemplatePath}`);
        process.exit(1);
      }
      
      console.log(`Using browser-performance-dashboard-generator.js with template: ${path.basename(browserTemplatePath)}`);
      // The browser generator exports generateBrowserPerformanceDashboard function (not generatePerformanceDashboard)
      browserPerformanceDashboardGenerator.generateBrowserPerformanceDashboard(
        processedDataPath, 
        browserTemplatePath, 
        outputPath
      );
    } else {
      // API & PROTOCOL TESTS: Use standard performance dashboard generator and template
      if (!performanceDashboardGenerator) {
        console.error('Error: Performance dashboard generator not available');
        process.exit(1);
      }
      
      const standardTemplatePath = templatePaths.performance[testType];
      if (!fs.existsSync(standardTemplatePath)) {
        console.error(`Error: Performance dashboard template not found: ${standardTemplatePath}`);
        process.exit(1);
      }
      
      console.log(`Using performance-dashboard-generator.js for ${testType.toUpperCase()} test with template: ${path.basename(standardTemplatePath)}`);
      performanceDashboardGenerator.generatePerformanceDashboard(
        processedDataPath, 
        standardTemplatePath, 
        outputPath
      );
    }
    
    console.log(`Performance dashboard successfully generated: ${outputPath}`);
  } catch (error) {
    console.error(`Error generating performance dashboard: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Generate a summary report from k6 test results
 * 
 * Each test type uses its own specific generator and template:
 * - API: Uses api-summary-report-generator.js with api template
 * - BROWSER: Uses browser-summary-report-generator.js with browser template
 * - PROTOCOL: Uses protocol-summary-report-generator.js with protocol template
 *
 * @param {string} resultsJsonPath - Path to the raw k6 results JSON file
 * @param {string} summaryJsonPath - Path to the k6 summary JSON file
 * @param {string} outputPath - Path to write the report to
 * @param {string} testType - Test type (api, browser, protocol)
 * @param {string} aut - Application under test name
 * @param {string} scenario - Test scenario name
 * @param {object} templatePaths - Object containing paths to template files
 */
async function generateSummaryReport(resultsJsonPath, summaryJsonPath, outputPath, testType, aut, scenario, templatePaths) {
  try {
    console.log('STARTING SUMMARY REPORT GENERATION');
    console.log(`Raw results: ${resultsJsonPath}`);
    console.log(`Summary JSON: ${summaryJsonPath}`);
    console.log(`Output file: ${outputPath}`);
    console.log(`Test type: ${testType.toUpperCase()}`);
    
    // Get the appropriate template for the test type
    const templatePath = templatePaths.summary[testType];
    
    if (!fs.existsSync(templatePath)) {
      console.error(`Error: Summary report template not found: ${templatePath}`);
      process.exit(1);
    }
    
    // First run performance-data-processor.js to get processed data
    // This ensures we're using the same processed data for both performance and summary reports
    console.log(`Processing raw data with performance-data-processor.js for ${testType.toUpperCase()} summary report...`);
    
    // Create temp directory if it doesn't exist
    const tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Process the data using performance-data-processor.js
    const processedDataPath = path.join(tempDir, `${testType}_processed.json`);
    const dataProcessorPath = path.join(__dirname, 'common/performance-data-processor.js');
    
    // Verify data processor exists
    if (!fs.existsSync(dataProcessorPath)) {
      console.error(`Error: performance-data-processor.js not found at ${dataProcessorPath}`);
      process.exit(1);
    }
    
    // Process the raw data using the imported processK6Data function
    await processK6Data(
      resultsJsonPath,
      summaryJsonPath, 
      processedDataPath,
      { testType, aut, scenario },
      { filterNonHtml: testType === 'PROTOCOL' }
    );
    
    // Verify processed data file exists
    if (!fs.existsSync(processedDataPath)) {
      console.error(`Error: Processed data file was not created at ${processedDataPath}`);
      process.exit(1);
    }
    
    console.log(`Using processed data from: ${processedDataPath}`);
    
    // If ES module generators aren't loaded yet, try loading them now
    if (!apiSummaryReportGenerator) {
      try {
        const apiModule = await import('./summary/api-summary-report-generator.js');
        apiSummaryReportGenerator = apiModule;
        console.log('Loaded API summary report generator on demand');
      } catch (err) {
        console.error(`Error: Could not load API summary report generator: ${err.message}`);
      }
    }
    
    if (!browserSummaryReportGenerator) {
      try {
        const browserModule = await import('./summary/browser-summary-report-generator.js');
        browserSummaryReportGenerator = browserModule;
        console.log('Loaded browser summary report generator on demand');
      } catch (err) {
        console.error(`Error: Could not load browser summary report generator: ${err.message}`);
      }
    }
    
    if (!protocolSummaryReportGenerator) {
      try {
        const protocolModule = await import('./summary/protocol-summary-report-generator.js');
        protocolSummaryReportGenerator = protocolModule;
        console.log('Loaded protocol summary report generator on demand');
      } catch (err) {
        console.error(`Error: Could not load protocol summary report generator: ${err.message}`);
      }
    }
    
    // Generate the summary report based on test type
    if (testType === 'api') {
      // API test: Use API-specific summary report generator
      if (!apiSummaryReportGenerator) {
        console.error('Error: API summary report generator not available');
        process.exit(1);
      }
      
      console.log(`Using api-summary-report-generator.js with template: ${path.basename(templatePath)}`);
      // The API generator exports generateSummaryReport function
      await apiSummaryReportGenerator.generateSummaryReport(processedDataPath, templatePath, outputPath);
    } else if (testType === 'browser') {
      // BROWSER test: Use browser-specific summary report generator
      if (!browserSummaryReportGenerator) {
        console.error('Error: Browser summary report generator not available');
        process.exit(1);
      }
      
      console.log(`Using browser-summary-report-generator.js with template: ${path.basename(templatePath)}`);
      await browserSummaryReportGenerator.generateBrowserSummaryReport(processedDataPath, templatePath, outputPath);
    } else if (testType === 'protocol') {
      // PROTOCOL test: Use protocol-specific summary report generator
      if (!protocolSummaryReportGenerator) {
        console.error('Error: Protocol summary report generator not available');
        process.exit(1);
      }
      
      console.log(`Using protocol-summary-report-generator.js with template: ${path.basename(templatePath)}`);
      await protocolSummaryReportGenerator.generateProtocolSummaryReport(processedDataPath, templatePath, outputPath);
    } else {
      console.error(`Unknown test type: ${testType}`);
      process.exit(1);
    }
    
    // Verify the report was created
    if (!fs.existsSync(outputPath)) {
      console.error(`Error: Summary report was not generated at ${outputPath}`);
      process.exit(1);
    }
    
    console.log(`Summary report successfully generated: ${outputPath}`);
  } catch (error) {
    console.error(`Error generating summary report: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Main function to generate reports (performance dashboards and summary reports)
 */
async function generateReport(resultsJsonPath, summaryJsonPath, outputPath, testType, aut, scenario, reportType = 'performance') {
  console.log(`Generating ${reportType} report for test type: ${testType}`);
  
  // Validate inputs - ensure we have actual test data to work with
  if (!fs.existsSync(resultsJsonPath)) {
    console.error(`Results JSON file not found: ${resultsJsonPath}`);
    process.exit(1);
  }
  
  if (!fs.existsSync(summaryJsonPath)) {
    console.error(`Summary JSON file not found: ${summaryJsonPath}`);
    process.exit(1);
  }
  
  // Define template paths for all report types - using specific templates for each test type
  const templatePaths = {
    // Summary report templates - each test type has its own specific template
    summary: {
      protocol: path.join(__dirname, 'summary/protocol-summary-report-template.html'),
      browser: path.join(__dirname, 'summary/browser-summary-report-template.html'),
      api: path.join(__dirname, 'summary/api-summary-report-template.html')
    },
    
    // Performance dashboard templates
    performance: {
      protocol: path.join(__dirname, 'performance/performance-dashboard-template.html'),
      browser: path.join(__dirname, 'performance/browser-performance-dashboard-template.html'),
      api: path.join(__dirname, 'performance/performance-dashboard-template.html')
    }
  };
  
  // Ensure the output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Normalize test type to lowercase for consistency
  const normalizedTestType = testType.toLowerCase();
  
  // Process based on report type
  if (reportType.toLowerCase() === 'performance') {
    // Handle performance dashboard generation
    await generatePerformanceDashboard(resultsJsonPath, summaryJsonPath, outputPath, normalizedTestType, aut, scenario, templatePaths);
  } else if (reportType.toLowerCase() === 'summary') {
    // Handle summary report generation
    await generateSummaryReport(resultsJsonPath, summaryJsonPath, outputPath, normalizedTestType, aut, scenario, templatePaths);
  } else {
    console.error(`Unknown report type: ${reportType}`);
    process.exit(1);
  }
}

// Execute if called directly
const args = process.argv.slice(2);
  
if (args.length < 6) {
  console.error('Usage: node run.js <resultsJson> <summaryJson> <outputPath> <testType> <aut> <scenario> [reportType]');
  process.exit(1);
}

const [resultsJsonPath, summaryJsonPath, outputPath, testType, aut, scenario, reportType = 'performance'] = args;

// Use an immediately invoked async function to handle the async generateReport
(async () => {
  try {
    await generateReport(resultsJsonPath, summaryJsonPath, outputPath, testType, aut, scenario, reportType);
  } catch (error) {
    console.error(`Error executing report generation: ${error.message}`);
    process.exit(1);
  }
})();

// Export for use as a module
export { generateReport };
