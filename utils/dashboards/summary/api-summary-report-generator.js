/**
 * Summary Report Generator for k6
 * 
 * This module generates a summary HTML report from processed k6 data.
 * It handles large data files efficiently and uses server-side rendering
 * to avoid client-side JavaScript errors and memory issues.
 */

/* eslint-env node */
/* global require, module, process */

/**
 * Check if a file is larger than a specified threshold
 * @param {string} filePath - Path to the file to check
 * @param {number} thresholdMB - Size threshold in MB (default: 100)
 * @returns {boolean} - True if file is larger than threshold
 */
function isLargeFile(filePath, thresholdMB = 100) {
  try {
    const fs = require('fs');
    const stats = fs.statSync(filePath);
    const fileSizeMB = stats.size / (1024 * 1024);
    return fileSizeMB > thresholdMB;
  } catch (error) {
    console.warn(`Could not check file size: ${error.message}`);
    return false;
  }
}

/**
 * Calculate statistics for an array of values
 * @param {Array<number>} values - Array of numeric values
 * @returns {Object} - Object containing min, max, avg, med, p90, p95, p99, count
 */
function calculateStats(values) {
  if (!values || !Array.isArray(values) || values.length === 0) {
    // Log a warning and return null for all metrics when data is missing
    console.error('[WARNING] No metric values available to calculate statistics');
    return { min: null, max: null, avg: null, med: null, p90: null, p95: null, p99: null, count: 0 };
  }

  // Process in batches for large arrays to avoid stack overflow
  const batchSize = 10000;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;

  // Calculate min, max, sum in batches
  for (let i = 0; i < values.length; i += batchSize) {
    const endIndex = Math.min(i + batchSize, values.length);
    const batch = values.slice(i, endIndex);
    
    for (const value of batch) {
      if (value < min) min = value;
      if (value > max) max = value;
      sum += value;
    }
  }

  // Sort values for percentiles - be careful with large arrays
  const sortedValues = [...values].sort((a, b) => a - b);
  
  const count = values.length;
  const avg = sum / count;
  const med = sortedValues[Math.floor(count / 2)];
  const p90 = sortedValues[Math.floor(count * 0.9)];
  const p95 = sortedValues[Math.floor(count * 0.95)];
  const p99 = sortedValues[Math.floor(count * 0.99)];

  return {
    min,
    max,
    avg,
    med,
    p90,
    p95,
    p99,
    count
  };
}

/**
 * Transform processed API data into a format suitable for the standard report
 * @param {Object} processedData - The processed data from the performance data processor
 * @returns {Object} - Transformed data for the standard report
 */
function transformApiData(processedData) {
  console.log('Found', Object.keys(processedData.transactions).length, 'transactions to process');
  
  // Extract TTFB (Time To First Byte) and TTLB (Time To Last Byte) values
  const ttfbValues = [];
  const ttlbValues = [];
  
  // Process transactions
  const transactions = processedData.transactions;
  
  // Filter out transactions with zero requests
  const transactionNames = Object.keys(transactions).filter(name => {
    return transactions[name].requests > 0;
  });

  // Process metrics for each transaction
  for (const txName of transactionNames) {
    // Only use actual metrics from the processed data, no estimations
    if (processedData.detailedData && 
        processedData.detailedData.chartData && 
        processedData.detailedData.chartData.responseTimeByTx && 
        processedData.detailedData.chartData.responseTimeByTx[txName]) {
      
      const responseTimes = processedData.detailedData.chartData.responseTimeByTx[txName];
      
      // Only use the actual TTLB values, no estimation of TTFB
      responseTimes.forEach(rt => {
        if (rt.value) {
          ttlbValues.push(rt.value);
        }
      });
    }
    
    // Use the dedicated TTFB data from ttfbByTx (now properly collected)
    if (processedData.detailedData && 
        processedData.detailedData.chartData && 
        processedData.detailedData.chartData.ttfbByTx && 
        processedData.detailedData.chartData.ttfbByTx[txName]) {
      
      const ttfbTimes = processedData.detailedData.chartData.ttfbByTx[txName];
      
      // Extract actual TTFB values
      ttfbTimes.forEach(rt => {
        if (rt.value) {
          ttfbValues.push(rt.value);
        }
      });
    }
  }
  
  console.log(`Processing ${transactionNames.length} transactions for metrics extraction`);
  console.log(`Total metrics to process: ${ttfbValues.length} TTFB values and ${ttlbValues.length} TTLB values`);
  
  // Calculate stats for TTFB and TTLB values
  const ttfbStats = calculateStats(ttfbValues);
  const ttlbStats = calculateStats(ttlbValues);
  
  console.log('TTFB stats:', JSON.stringify(ttfbStats));
  console.log('TTLB stats:', JSON.stringify(ttlbStats));
  
  // Format endpoint performance data with proper HTML format
  const endpointPerformance = [];
  
  // Calculate total success/failure counts across all endpoints
  let totalRequests = 0;
  let totalSuccessful = 0;
  
  for (const txName of Object.keys(transactions)) {
    const transaction = transactions[txName];
    if (transaction.requests > 0) {
      totalRequests += transaction.requests || 0;
      totalSuccessful += transaction.successful || 0;
    }
  }
  
  // Actual success rate based on data
  const actualSuccessRate = totalRequests > 0 ? 
    (totalSuccessful / totalRequests * 100).toFixed(2) : '0.00';
  
  // Process each transaction
  for (const txName of Object.keys(transactions)) {
    const transaction = transactions[txName];
    
    // Skip transactions with no requests
    if (transaction.requests === 0) continue;
    
    // Get response times for this transaction
    let txTtfbValues = [];
    let txTtlbValues = [];
    
    // Get TTLB values from responseTimeByTx
    if (processedData.detailedData && 
        processedData.detailedData.chartData && 
        processedData.detailedData.chartData.responseTimeByTx && 
        processedData.detailedData.chartData.responseTimeByTx[txName]) {
      
      const responseTimes = processedData.detailedData.chartData.responseTimeByTx[txName];
      
      // Only collect actual TTLB values, no estimation
      txTtlbValues = responseTimes.filter(rt => rt.value !== undefined && rt.value !== null).map(rt => rt.value);
    }
    
    // Get TTFB values from ttfbByTx (the new dedicated TTFB structure)
    if (processedData.detailedData && 
        processedData.detailedData.chartData && 
        processedData.detailedData.chartData.ttfbByTx && 
        processedData.detailedData.chartData.ttfbByTx[txName]) {
      
      const ttfbTimes = processedData.detailedData.chartData.ttfbByTx[txName];
      
      // Only collect actual TTFB values, no estimation
      txTtfbValues = ttfbTimes.filter(rt => rt.value !== undefined && rt.value !== null).map(rt => rt.value);
    }
    
    // Calculate stats for this transaction
    const txTtfbStats = calculateStats(txTtfbValues);
    const txTtlbStats = calculateStats(txTtlbValues);
    
    // Format values for display - use N/A if data not available
    const formatValue = (value) => {
      if (value === undefined || value === null || isNaN(value)) {
        return 'N/A';
      }
      return value.toFixed(2);
    };
    
    // Log warnings for missing metrics
    if (txTtfbValues.length === 0) {
      console.error(`[WARNING] No TTFB metrics available for endpoint ${txName}`); 
    }
    
    if (txTtlbValues.length === 0) {
      console.error(`[WARNING] No TTLB metrics available for endpoint ${txName}`); 
    }
    
    // Format metrics properly, use N/A if not available - no ms suffix as it's in header
    const formatMetricWithUnit = (value) => {
      return formatValue(value); // Just return the formatted value without adding 'ms'
    };
    
    // Extract the real transaction name from the txName, which might contain tags or other information
    // This is important to ensure we display the actual endpoint name, not just 'Unknown'
    let displayName = txName;
    
    // If the name contains a tag format like '{tag:value}', extract the meaningful part
    if (txName.includes(':')) {
      // Try to extract the transaction name from tag format
      const tagMatch = txName.match(/\{([^:]+):([^}]+)\}/);
      if (tagMatch && tagMatch[2]) {
        displayName = tagMatch[2]; // Use the tag value as the display name
      } else {
        // If not in tag format, just use the raw name but clean it up
        displayName = txName.replace(/\{.*?\}/g, '').trim();
      }
    }
    
    // Add formatted transaction data
    endpointPerformance.push({
      name: displayName, // Use a clear property name for display
      endpoint: txName,  // Keep the original name for reference
      requests: transaction.requests,
      successful: transaction.successful,
      failed: transaction.failed,
      successRate: transaction.successRate,
      // Format values for the HTML template with N/A for missing metrics
      ttfbAvg: formatMetricWithUnit(txTtfbStats.avg),
      ttfbMedian: formatMetricWithUnit(txTtfbStats.med),
      ttfbP90: formatMetricWithUnit(txTtfbStats.p90),
      ttlbAvg: formatMetricWithUnit(txTtlbStats.avg),
      ttlbMedian: formatMetricWithUnit(txTtlbStats.med),
      ttlbP90: formatMetricWithUnit(txTtlbStats.p90),
      // Also include raw stats for reference
      ttfb: txTtfbStats,
      ttlb: txTtlbStats
    });
  }
  
  console.log(`Created endpoint performance data for ${endpointPerformance.length} endpoints`);
  
  // Create summary metrics based on actual data
  const summary = {
    endpoints: transactionNames.length,
    requests: totalRequests,
    ttfb: ttfbStats,
    ttlb: ttlbStats,
    successRate: actualSuccessRate
  };
  
  // Extract test information from processed data to create reportInfo
  const reportInfo = {
    testType: processedData.summary.testInfo?.testType || 'API',
    applicationName: processedData.summary.testInfo?.aut || 'Unknown Application',
    scenario: processedData.summary.testInfo?.scenario || 'Unknown Scenario',
    startTime: processedData.summary.startTime || new Date().toLocaleString(),
    endTime: processedData.summary.endTime || new Date().toLocaleString(),
    duration: processedData.summary.durationSeconds ? `${processedData.summary.durationSeconds.toFixed(2)}s` : 'Unknown',
    vus: processedData.summary.maxVUs || 0,
    // Also include runStartTime and runEndTime for the HTML template
    runStartTime: processedData.summary.startTime || new Date().toLocaleString(),
    runEndTime: processedData.summary.endTime || new Date().toLocaleString(),
    aut: processedData.summary.testInfo?.aut || 'Unknown Application'
  };

  // Create overallSummary for the main summary table with actual calculated values
  const overallSummary = {
    requestsLabel: 'All Endpoints',
    count: totalRequests,
    successRate: `${actualSuccessRate}%`,
    ttfbAvg: ttfbStats.avg ? ttfbStats.avg.toFixed(2) : 'N/A',
    ttfbMedian: ttfbStats.med ? ttfbStats.med.toFixed(2) : 'N/A',
    ttfbP90: ttfbStats.p90 ? ttfbStats.p90.toFixed(2) : 'N/A',
    ttlbAvg: ttlbStats.avg ? ttlbStats.avg.toFixed(2) : 'N/A',
    ttlbMedian: ttlbStats.med ? ttlbStats.med.toFixed(2) : 'N/A',
    ttlbP90: ttlbStats.p90 ? ttlbStats.p90.toFixed(2) : 'N/A'
  };

  // Create summaryMetrics for the top metrics display with actual data - 
  // IMPORTANT: property names must match exactly what the HTML template expects
  const summaryMetrics = {
    totalEndpoints: transactionNames.length,
    totalRequests: totalRequests,
    overallSuccessRate: actualSuccessRate,   // The HTML looks for this property name
    avgTtfb: ttfbStats.avg ? ttfbStats.avg.toFixed(2) : 'N/A',  // Note this name difference (lowercase 'b')
    avgTtlB: ttlbStats.avg ? ttlbStats.avg.toFixed(2) : 'N/A'   // Note this name difference (uppercase 'B')
  };

  return {
    reportInfo,
    summary,
    endpointPerformance,
    overallSummary,
    summaryMetrics
  };
}

/**
 * Orchestrates the generation of the summary HTML report with server-side rendering.
 * Handles large files efficiently to avoid memory issues and client-side JavaScript errors.
 * @param {string} processedDataPath - The path to the processed JSON data file
 * @param {string} templatePath - The path to the HTML template file
 * @param {string} outputPath - The path where the final HTML report will be saved
 */
function generateSummaryReport(processedDataPath, templatePath, outputPath) {
  const fs = require('fs');
  
  console.error('STARTING SUMMARY REPORT GENERATION');
  console.error(`Input file: ${processedDataPath}`);
  console.error(`Template file: ${templatePath}`);
  console.error(`Output file: ${outputPath}`);
  
  try {
    // Check if file exists
    if (!fs.existsSync(processedDataPath)) {
      console.error(`[ERROR] File does not exist: ${processedDataPath}`);
      return;
    }
    
    console.error('[DEBUG] File exists, checking size...');
    
    // Check if the file is large and might cause memory issues
    const isLarge = isLargeFile(processedDataPath);
    let processedData;
    
    if (isLarge) {
      console.error('[DEBUG] Large file detected (>100MB). Using memory-efficient processing...');
      // For extremely large files, we could implement a streaming JSON parser
      // For now, we'll still load it but with a warning about potential memory issues
      console.warn('[WARNING] Processing very large data file. This may cause high memory usage.');
      const rawData = fs.readFileSync(processedDataPath, 'utf8');
      console.error(`[DEBUG] Raw data read, size: ${rawData.length} bytes`);
      try {
        processedData = JSON.parse(rawData);
        console.error('[DEBUG] JSON parsed successfully');
      } catch (parseError) {
        console.error(`[ERROR] Failed to parse JSON: ${parseError.message}`);
        throw parseError;
      }
    } else {
      // For normal sized files, standard processing is fine
      console.error('[DEBUG] Normal sized file, using standard processing');
      const rawData = fs.readFileSync(processedDataPath, 'utf8');
      console.error(`[DEBUG] Raw data read, size: ${rawData.length} bytes`);
      try {
        processedData = JSON.parse(rawData);
        console.error('[DEBUG] JSON parsed successfully');
      } catch (parseError) {
        console.error(`[ERROR] Failed to parse JSON: ${parseError.message}`);
        throw parseError;
      }
    }

    if (!processedData) {
      console.error('[ERROR] Processed data is empty or invalid');
      throw new Error('Processed data is empty or invalid');
    }

    console.error('[DEBUG] Transforming processed data for standard report...');
    const transformedData = transformApiData(processedData);
    console.error('[DEBUG] Data transformation complete');
    
    // Clear the reference to the large data object to help garbage collection
    processedData = null;

    console.error('[DEBUG] Reading HTML template...');
    if (!fs.existsSync(templatePath)) {
      console.error(`[ERROR] Template file does not exist: ${templatePath}`);
      throw new Error(`Template file does not exist: ${templatePath}`);
    }
    
    let htmlTemplate = fs.readFileSync(templatePath, 'utf8');
    console.error(`[DEBUG] HTML template loaded, size: ${htmlTemplate.length} bytes`);

    console.error('[DEBUG] Server-side rendering of report data...');
    
    // Log warnings for missing data to maintain data integrity requirements
    if (!transformedData.summary) console.error('[WARNING] Summary data is missing');
    if (!transformedData.testInfo) console.error('[WARNING] Test info data is missing');
    if (!transformedData.metrics) console.error('[WARNING] Metrics data is missing');
    
    // Format the timestamp for display
    const formatTimestamp = (timestamp) => {
      if (!timestamp) return 'N/A';
      const date = new Date(timestamp);
      return date.toLocaleString();
    };
    
    // Replace placeholders in the template with actual data
    console.error('[DEBUG] Replacing placeholders with server-side rendered content...');
    
    // Extract the summary metrics from the transformed data
    const summaryMetrics = transformedData.summaryMetrics || {};
    const endpointPerformance = transformedData.endpointPerformance || [];
    const overallSummary = transformedData.overallSummary || {};
    const reportInfo = transformedData.reportInfo || {};
    
    console.error('[DEBUG] Summary metrics:', JSON.stringify(summaryMetrics));
    console.error('[DEBUG] Endpoint performance data:', endpointPerformance.length, 'endpoints');
    
    // Replace key placeholders with actual data from the transformed data
    htmlTemplate = htmlTemplate
      // Header information
      .replace('id="runStartTime"></span>', `id="runStartTime">${formatTimestamp(reportInfo.startTime)}</span>`)
      .replace('id="testDuration"></span>', `id="testDuration">${reportInfo.duration || 'N/A'} seconds</span>`)
      .replace('id="totalRequests"></span>', `id="totalRequests">${summaryMetrics.totalRequests || 'N/A'}</span>`)
      .replace('id="failedRequests"></span>', `id="failedRequests">${(summaryMetrics.totalRequests - (summaryMetrics.totalRequests * (parseFloat(summaryMetrics.overallSuccessRate || 0) / 100))).toFixed(0) || 'N/A'}</span>`)
      .replace('id="failureRate"></span>', `id="failureRate">${summaryMetrics.overallSuccessRate ? (100 - parseFloat(summaryMetrics.overallSuccessRate)).toFixed(2) + '%' : 'N/A'}</span>`)
      .replace('id="avgRps"></span>', `id="avgRps">${reportInfo.avgRps ? reportInfo.avgRps.toFixed(2) : 'N/A'}</span>`)
      .replace('id="avgResponseTime"></span>', `id="avgResponseTime">${summaryMetrics.avgTtlB ? summaryMetrics.avgTtlB + ' ms' : 'N/A'}</span>`);
    
    // Generate the summary metrics section - using the template's styling classes
    let summaryHtml = `
      <div class="summary-stats-grid grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
        <div class="summary-stat-card primary bg-white p-4 rounded-lg shadow-md">
          <div class="summary-stat-label text-sm text-gray-500 mb-1">Total Endpoints</div>
          <div class="summary-stat-value text-xl font-bold">${summaryMetrics.totalEndpoints || 'N/A'}</div>
        </div>
        <div class="summary-stat-card success bg-white p-4 rounded-lg shadow-md">
          <div class="summary-stat-label text-sm text-gray-500 mb-1">Total Requests</div>
          <div class="summary-stat-value text-xl font-bold">${summaryMetrics.totalRequests || 'N/A'}</div>
        </div>
        <div class="summary-stat-card warning bg-white p-4 rounded-lg shadow-md">
          <div class="summary-stat-label text-sm text-gray-500 mb-1">Overall Success Rate</div>
          <div class="summary-stat-value text-xl font-bold">${summaryMetrics.overallSuccessRate || 'N/A'}%</div>
        </div>
        <div class="summary-stat-card primary bg-white p-4 rounded-lg shadow-md">
          <div class="summary-stat-label text-sm text-gray-500 mb-1">Avg TTFB</div>
          <div class="summary-stat-value text-xl font-bold">${summaryMetrics.avgTtfb || 'N/A'} ms</div>
        </div>
        <div class="summary-stat-card primary bg-white p-4 rounded-lg shadow-md">
          <div class="summary-stat-label text-sm text-gray-500 mb-1">Avg TTLB</div>
          <div class="summary-stat-value text-xl font-bold">${summaryMetrics.avgTtlB || 'N/A'} ms</div>
        </div>
      </div>
    `;
    
    // Generate the overall metrics table with proper styling
    let overallTableHtml = `
      <div class="overflow-x-auto">
        <table class="custom-table w-full">
          <thead>
            <tr>
              <th>REQUESTS</th>
              <th>COUNT</th>
              <th>SUCCESS RATE</th>
              <th colspan="3">TTFB (MS)</th>
              <th colspan="3">TTLB (MS)</th>
            </tr>
            <tr>
              <th></th>
              <th></th>
              <th></th>
              <th>AVG</th>
              <th>MEDIAN</th>
              <th>P90</th>
              <th>AVG</th>
              <th>MEDIAN</th>
              <th>P90</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>${overallSummary.requestsLabel || 'All Endpoints'}</td>
              <td>${overallSummary.count || 'N/A'}</td>
              <td>${overallSummary.successRate || 'N/A'}</td>
              <td>${overallSummary.ttfbAvg || 'N/A'}</td>
              <td>${overallSummary.ttfbMedian || 'N/A'}</td>
              <td>${overallSummary.ttfbP90 || 'N/A'}</td>
              <td>${overallSummary.ttlbAvg || 'N/A'}</td>
              <td>${overallSummary.ttlbMedian || 'N/A'}</td>
              <td>${overallSummary.ttlbP90 || 'N/A'}</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
    
    // Generate the endpoint performance table with proper styling
    let endpointTableHtml = `
      <div class="overflow-x-auto">
        <table class="custom-table w-full">
          <thead>
            <tr>
              <th>ENDPOINT</th>
              <th>REQUESTS</th>
              <th>SUCCESS RATE</th>
              <th colspan="3">TTFB (MS)</th>
              <th colspan="3">TTLB (MS)</th>
            </tr>
            <tr>
              <th></th>
              <th></th>
              <th></th>
              <th>AVG</th>
              <th>MEDIAN</th>
              <th>P90</th>
              <th>AVG</th>
              <th>MEDIAN</th>
              <th>P90</th>
            </tr>
          </thead>
          <tbody>
    `;
    
    // Add each endpoint row
    if (endpointPerformance.length > 0) {
      endpointPerformance.forEach(endpoint => {
        // Use the endpoint name from the transaction data, not the name property we added
        // This ensures we display the actual transaction names like GetPosts, GetUsers, etc.
        const displayName = endpoint.endpoint || 'Unknown';
        
        endpointTableHtml += `
          <tr>
            <td>${displayName}</td>
            <td>${endpoint.requests || 'N/A'}</td>
            <td>${endpoint.successRate || 'N/A'}</td>
            <td>${endpoint.ttfbAvg || 'N/A'}</td>
            <td>${endpoint.ttfbMedian || 'N/A'}</td>
            <td>${endpoint.ttfbP90 || 'N/A'}</td>
            <td>${endpoint.ttlbAvg || 'N/A'}</td>
            <td>${endpoint.ttlbMedian || 'N/A'}</td>
            <td>${endpoint.ttlbP90 || 'N/A'}</td>
          </tr>
        `;
      });
    } else {
      endpointTableHtml += `
        <tr>
          <td colspan="9" class="text-center py-4">No endpoint data available</td>
        </tr>
      `;
    }
    
    endpointTableHtml += `
          </tbody>
        </table>
      </div>
    `;
    
    // Replace section placeholders with generated HTML
    // First check if the placeholders exist in the template
    if (htmlTemplate.includes('<div id="performance-summary">')) {
      htmlTemplate = htmlTemplate.replace('<div id="performance-summary"></div>', summaryHtml);
    } else {
      // Insert after the Performance Summary heading
      const summaryHeadingPos = htmlTemplate.indexOf('<h2 class="section-title">Performance Summary</h2>');
      if (summaryHeadingPos !== -1) {
        const insertPos = summaryHeadingPos + '<h2 class="section-title">Performance Summary</h2>'.length;
        htmlTemplate = htmlTemplate.slice(0, insertPos) + '\n' + summaryHtml + htmlTemplate.slice(insertPos);
      }
    }
    
    if (htmlTemplate.includes('<div id="overall-metrics">')) {
      htmlTemplate = htmlTemplate.replace('<div id="overall-metrics"></div>', overallTableHtml);
    } else {
      // Add overall metrics table after the summary section
      const summaryEndPos = htmlTemplate.indexOf('</section>', htmlTemplate.indexOf('<h2 class="section-title">Performance Summary</h2>'));
      if (summaryEndPos !== -1) {
        const insertPos = summaryEndPos;
        htmlTemplate = htmlTemplate.slice(0, insertPos) + '\n<div class="mt-6">\n' + overallTableHtml + '\n</div>\n' + htmlTemplate.slice(insertPos);
      }
    }
    
    if (htmlTemplate.includes('<div id="endpoint-performance">')) {
      htmlTemplate = htmlTemplate.replace('<div id="endpoint-performance"></div>', endpointTableHtml);
    } else {
      // Add endpoint performance table after the endpoint section heading
      const endpointHeadingPos = htmlTemplate.indexOf('<h2 class="section-title">Transaction Performance by Endpoint</h2>');
      if (endpointHeadingPos !== -1) {
        const insertPos = endpointHeadingPos + '<h2 class="section-title">Transaction Performance by Endpoint</h2>'.length;
        htmlTemplate = htmlTemplate.slice(0, insertPos) + '\n<div class="mt-6">\n' + endpointTableHtml + '\n</div>\n' + htmlTemplate.slice(insertPos);
      }
    }
      
    // Remove the client-side renderReport script since we're doing server-side rendering
    htmlTemplate = htmlTemplate.replace(/<script>\s*function renderReport\(data\)[\s\S]*?<\/script>/g, '');
    
    console.error('[DEBUG] Server-side rendering complete');
    
    console.error(`[DEBUG] Writing summary report to: ${outputPath}`);
    try {
      fs.writeFileSync(outputPath, htmlTemplate);
      console.error('[DEBUG] File written successfully, checking if it exists...');
      if (fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath);
        console.error(`[DEBUG] Report file created: ${outputPath}, size: ${stats.size} bytes`);
      } else {
        console.error(`[ERROR] Report file was not created: ${outputPath}`);
      }
    } catch (writeError) {
      console.error(`[ERROR] Failed to write report file: ${writeError.message}`);
      throw writeError;
    }
    
    console.error('[DEBUG] Summary report generated successfully');
    console.error('COMPLETED SUMMARY REPORT GENERATION');
  } catch (error) {
    console.error(`[ERROR] Error generating summary report: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

// Export functions for testing
module.exports = {
  generateSummaryReport,
  transformApiData,
  calculateStats,
  isLargeFile
};

// Entry point for CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.error('Usage: node summary-report-generator.js <processed-data.json> <template.html> <output.html>');
    process.exit(1);
  }
  generateSummaryReport(args[0], args[1], args[2]);
}
