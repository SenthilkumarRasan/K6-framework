/**
 * run.js - Central Report Generation Entry Point
 *
 * This script handles both performance dashboard and summary report generation from k6 test results.
 * It ensures that only actual test data is used (never synthetic values or fallbacks).
 */

/* eslint-env node */
/* global require, process, module, __dirname */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Load required modules conditionally to handle missing files gracefully
let performanceDashboardGenerator;
let browserPerformanceDashboardGenerator;

// Summary report generators for each test type
let apiSummaryReportGenerator;
let browserSummaryReportGenerator;
let protocolSummaryReportGenerator;

// Load performance dashboard generator for API and PROTOCOL tests
try {
  performanceDashboardGenerator = require('./performance/performance-dashboard-generator');
} catch (err) {
  console.warn(`Warning: performance-dashboard-generator.js not found (${err.code})`);
  performanceDashboardGenerator = null;
}

// Load browser performance dashboard generator for BROWSER tests
try {
  browserPerformanceDashboardGenerator = require('./performance/browser-performance-dashboard');
  console.log('Successfully loaded browser-performance-dashboard.js for browser tests');
} catch (err) {
  console.warn(`Warning: browser-performance-dashboard.js not found (${err.code})`);
  try {
    // Fall back to regular version if fixed version is not found
    browserPerformanceDashboardGenerator = require('./performance/browser-performance-dashboard-generator');
    console.log('Using regular browser-performance-dashboard-generator.js as fallback');
  } catch {
    console.error('Error: No browser performance dashboard generator found');
    browserPerformanceDashboardGenerator = null;
  }
}

// Load API summary report generator
try {
  apiSummaryReportGenerator = require('./summary/api-summary-report-generator');
} catch (err) {
  console.warn(`Warning: api-summary-report-generator.js not found (${err.code})`);
  apiSummaryReportGenerator = null;
}

// Load BROWSER summary report generator
try {
  browserSummaryReportGenerator = require('./summary/browser-summary-report-generator');
} catch (err) {
  console.warn(`Warning: browser-summary-report-generator.js not found (${err.code})`);
  browserSummaryReportGenerator = null;
}

// Load PROTOCOL summary report generator
try {
  protocolSummaryReportGenerator = require('./summary/protocol-summary-report-generator');
} catch (err) {
  console.warn(`Warning: protocol-summary-report-generator.js not found (${err.code})`);
  protocolSummaryReportGenerator = null;
}

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
function generatePerformanceDashboard(resultsJsonPath, summaryJsonPath, outputPath, testType, aut, scenario, templatePaths) {
  // Create temp directory if it doesn't exist
  const tempDir = path.join(process.cwd(), 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  // Step 1: Process the data using the appropriate data processor based on test type
  // This ensures only actual test data is used (never synthetic values)
  const processedDataPath = path.join(tempDir, `${testType}_processed.json`);
  
  // Use browser-specific data processor for BROWSER tests, standard processor for others
  // testType comparison must be case-insensitive since it could be 'BROWSER' or 'browser'
  const testTypeLower = testType.toLowerCase();
  const dataProcessorPath = testTypeLower === 'browser'
    ? path.join(__dirname, 'common/performance-data-processor.js')
    : path.join(__dirname, 'common/performance-data-processor.js');
  
  // Note: The same processor is now used for all test types, but we keep the logic for future customization
  
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
    });
    
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
function generateSummaryReport(resultsJsonPath, summaryJsonPath, outputPath, testType, aut, scenario, templatePaths) {
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
    
    // Process the raw data
    execSync(`node "${dataProcessorPath}" "${resultsJsonPath}" "${summaryJsonPath}" "${processedDataPath}" "${testType}" "${aut}" "${scenario}"`, { 
      stdio: 'inherit'
    });
    
    // Verify processed data file exists
    if (!fs.existsSync(processedDataPath)) {
      console.error(`Error: Processed data file was not created at ${processedDataPath}`);
      process.exit(1);
    }
    
    console.log(`Using processed data from: ${processedDataPath}`);
    
    // Generate the summary report based on test type
    if (testType === 'api') {
      // API test: Use API-specific summary report generator
      if (!apiSummaryReportGenerator) {
        console.error('Error: API summary report generator not available');
        process.exit(1);
      }
      
      console.log(`Using api-summary-report-generator.js with template: ${path.basename(templatePath)}`);
      // The API generator exports generateSummaryReport function
      // Use the processed data from performance-data-processor.js instead of raw data
      apiSummaryReportGenerator.generateSummaryReport(processedDataPath, templatePath, outputPath);
    } else if (testType === 'browser') {
      // BROWSER test: Use browser-specific summary report generator
      if (!browserSummaryReportGenerator) {
        console.error('Error: Browser summary report generator not available');
        process.exit(1);
      }
      
      console.log(`Using browser-summary-report-generator.js with template: ${path.basename(templatePath)}`);
      // The browser generator exports generateProtocolSummaryReport function
      // Use processed data from performance-data-processor.js instead of raw data
      browserSummaryReportGenerator.generateProtocolSummaryReport(processedDataPath, templatePath, outputPath);
    } else if (testType === 'protocol') {
      // PROTOCOL test: Use protocol-specific summary report generator
      if (!protocolSummaryReportGenerator) {
        console.error('Error: Protocol summary report generator not available');
        process.exit(1);
      }
      
      console.log(`Using protocol-summary-report-generator.js with template: ${path.basename(templatePath)}`);
      // The protocol generator exports generateProtocolSummaryReport function
      // Use processed data from performance-data-processor.js instead of raw data
      protocolSummaryReportGenerator.generateProtocolSummaryReport(processedDataPath, templatePath, outputPath);
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
function generateReport(resultsJsonPath, summaryJsonPath, outputPath, testType, aut, scenario, reportType = 'performance') {
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
    generatePerformanceDashboard(resultsJsonPath, summaryJsonPath, outputPath, normalizedTestType, aut, scenario, templatePaths);
  } else if (reportType.toLowerCase() === 'summary') {
    // Handle summary report generation
    generateSummaryReport(resultsJsonPath, summaryJsonPath, outputPath, normalizedTestType, aut, scenario, templatePaths);
  } else {
    console.error(`Unknown report type: ${reportType}`);
    process.exit(1);
  }
}

// Execute if called directly
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length < 6) {
    console.error('Usage: node run.js <resultsJson> <summaryJson> <outputPath> <testType> <aut> <scenario> [reportType]');
    process.exit(1);
  }
  
  const [resultsJsonPath, summaryJsonPath, outputPath, testType, aut, scenario, reportType = 'performance'] = args;
  
  generateReport(resultsJsonPath, summaryJsonPath, outputPath, testType, aut, scenario, reportType);
}

// Export for use as a module
module.exports = { generateReport };
