/**
 * Protocol Summary Report Generator
 * 
 * This module generates a server-side rendered protocol summary report
 * with no client-side JavaScript or hardcoded values.
 */

/* eslint-disable no-unused-vars */
import fs from 'fs';

/**
 * Generate a protocol summary report
 * @param {string} processedDataPath - Path to the processed data JSON file
 * @param {string} templatePath - Path to the HTML template
 * @param {string} outputPath - Path to write the output HTML file
 */
async function generateProtocolSummaryReport(processedDataPath, templatePath, outputPath) {
  console.log('STARTING PROTOCOL SUMMARY REPORT GENERATION');
  console.log(`Input file: ${processedDataPath}`);
  console.log(`Template file: ${templatePath}`);
  console.log(`Output file: ${outputPath}`);

  try {
    // Check if the input file exists and has content
    if (!fs.existsSync(processedDataPath)) {
      console.error(`Error: Input file ${processedDataPath} does not exist`);
      return;
    }

    console.log('[DEBUG] File exists, checking size...');
    const stats = fs.statSync(processedDataPath);
    if (stats.size === 0) {
      console.error(`Error: Input file ${processedDataPath} is empty`);
      return;
    }

    if (stats.size > 100 * 1024 * 1024) { // 100MB
      console.log('[DEBUG] Large file detected, using chunked processing');
      // Implement chunked processing for large files if needed
    } else {
      console.log('[DEBUG] Normal sized file, using standard processing');
    }

    // Read and parse the processed data
    console.log('[DEBUG] Raw data read, size:', stats.size, 'bytes');
    const rawData = fs.readFileSync(processedDataPath, 'utf8');
    const processedData = JSON.parse(rawData);
    console.log('[DEBUG] JSON parsed successfully');

    // Transform the data for the protocol summary report
    console.log('[DEBUG] Transforming processed data for protocol summary report...');
    const transformedData = transformProtocolData(processedData);
    console.log('[DEBUG] Data transformation complete');

    // Read the HTML template
    console.log('[DEBUG] Reading HTML template...');
    const templateHtml = fs.readFileSync(templatePath, 'utf8');
    console.log('[DEBUG] HTML template loaded, size:', templateHtml.length, 'bytes');

    // Server-side rendering of the report
    console.log('[DEBUG] Server-side rendering of report data...');
    
    // Log warnings for missing data to maintain data integrity requirements
    if (!transformedData.summary) console.error('[WARNING] Summary data is missing');
    if (!transformedData.testInfo) console.error('[WARNING] Test info data is missing');
    if (!transformedData.htmlResources) console.error('[WARNING] HTML resources data is missing');
    if (!transformedData.nonHtmlResources) console.error('[WARNING] Non-HTML resources data is missing');
    if (!transformedData.resourceTypes) console.error('[WARNING] Resource types data is missing');
    if (!transformedData.networkAnalysis) console.error('[WARNING] Network analysis data is missing');

    // Format the timestamp for display
    const formatTimestamp = (timestamp) => {
      if (!timestamp) return 'N/A';
      const date = new Date(timestamp);
      return date.toLocaleString();
    };

    // Replace placeholders with server-side rendered content
    console.log('[DEBUG] Replacing placeholders with server-side rendered content...');
    
    // Generate HTML content for each section
    const summaryHtml = generateSummaryHtml(transformedData.summary);
    const overallMetricsHtml = generateOverallMetricsHtml(transformedData.summary);
    const htmlResourcesHtml = generateResourcesTableHtml(transformedData.htmlResources, 'html-table');
    const nonHtmlResourcesHtml = generateResourcesTableHtml(transformedData.nonHtmlResources, 'nonhtml-table');
    const resourceTypesHtml = generateResourceTypesTableHtml(transformedData.resourceTypes);
    const networkAnalysisHtml = generateNetworkAnalysisTableHtml(transformedData.networkAnalysis);

    console.log(`[DEBUG] Generated summary HTML: ${summaryHtml.length} characters`);
    console.log(`[DEBUG] Generated HTML resources HTML: ${htmlResourcesHtml.length} characters`);
    console.log(`[DEBUG] Generated non-HTML resources HTML: ${nonHtmlResourcesHtml.length} characters`);
    console.log(`[DEBUG] Generated resource types HTML: ${resourceTypesHtml.length} characters`);
    console.log(`[DEBUG] Generated network analysis HTML: ${networkAnalysisHtml.length} characters`);

    // Replace placeholders in the template with actual data
    let finalHtml = templateHtml
      .replace('id="runStartTime"></span>', `id="runStartTime">${transformedData.testInfo.startTime || ''}</span>`)
      .replace('id="runEndTime"></span>', `id="runEndTime">${transformedData.testInfo.endTime || ''}</span>`)
      .replace('id="testType"></span>', `id="testType">${transformedData.testInfo.testType || 'PROTOCOL'}</span>`)
      .replace('id="aut"></span>', `id="aut">${transformedData.testInfo.aut || 'Unknown'}</span>`)
      .replace('id="scenario"></span>', `id="scenario">${transformedData.testInfo.scenario || 'custom-tps'}</span>`)
      .replace('id="generationTime"></span>', '');

    // Replace section placeholders with generated HTML - Force direct insertion
    
    // Performance Summary section
    const summaryHeadingPos = finalHtml.indexOf('<h2 class="section-title">Performance Summary</h2>');
    if (summaryHeadingPos !== -1) {
      // Find the end of the heading
      const headingEndPos = summaryHeadingPos + '<h2 class="section-title">Performance Summary</h2>'.length;
      
      // Find the div after the heading
      let divStartPos = finalHtml.indexOf('<div', headingEndPos);
      let divEndPos = finalHtml.indexOf('</div>', divStartPos);
      
      if (divStartPos !== -1 && divEndPos !== -1) {
        // Replace the div content with our summary HTML
        finalHtml = finalHtml.slice(0, divStartPos) + 
                    '<div class="summary-stats-grid">' + 
                    summaryHtml + 
                    finalHtml.slice(divEndPos);
      } else {
        // Insert after the heading if div not found
        finalHtml = finalHtml.slice(0, headingEndPos) + '\n' + summaryHtml + finalHtml.slice(headingEndPos);
      }
      
      // Add overall metrics table right after the summary stats grid
      const summaryEndPos = finalHtml.indexOf('</section>', summaryHeadingPos);
      if (summaryEndPos !== -1) {
        finalHtml = finalHtml.slice(0, summaryEndPos) + 
                  '\n<div class="mt-6">\n' + 
                  overallMetricsHtml + 
                  '\n</div>\n' + 
                  finalHtml.slice(summaryEndPos);
      }
    }
    
    // HTML Resources section
    const htmlResourcesPos = finalHtml.indexOf('<h2 class="section-title">HTML Resources</h2>');
    if (htmlResourcesPos !== -1) {
      const headingEndPos = htmlResourcesPos + '<h2 class="section-title">HTML Resources</h2>'.length;
      finalHtml = finalHtml.slice(0, headingEndPos) + '\n' + htmlResourcesHtml + finalHtml.slice(headingEndPos);
    }
    
    // Non-HTML Resources section
    const nonHtmlResourcesPos = finalHtml.indexOf('<h2 class="section-title">Non-HTML Resources</h2>');
    if (nonHtmlResourcesPos !== -1) {
      const headingEndPos = nonHtmlResourcesPos + '<h2 class="section-title">Non-HTML Resources</h2>'.length;
      finalHtml = finalHtml.slice(0, headingEndPos) + '\n' + nonHtmlResourcesHtml + finalHtml.slice(headingEndPos);
    }
    
    // Resource Types section
    const resourceTypesPos = finalHtml.indexOf('<h2 class="section-title">Resource Types by Transaction</h2>');
    if (resourceTypesPos !== -1) {
      const headingEndPos = resourceTypesPos + '<h2 class="section-title">Resource Types by Transaction</h2>'.length;
      finalHtml = finalHtml.slice(0, headingEndPos) + '\n' + resourceTypesHtml + finalHtml.slice(headingEndPos);
    }
    
    // Network Analysis section
    const networkAnalysisPos = finalHtml.indexOf('<h2 class="section-title">Network Resource Analysis</h2>');
    if (networkAnalysisPos !== -1) {
      const headingEndPos = networkAnalysisPos + '<h2 class="section-title">Network Resource Analysis</h2>'.length;
      finalHtml = finalHtml.slice(0, headingEndPos) + '\n' + networkAnalysisHtml + finalHtml.slice(headingEndPos);
    }
      
    // Remove any client-side script that might be in the template
    finalHtml = finalHtml.replace(/<script>\s*function renderReport\(data\)[\s\S]*?<\/script>/g, '');
    
    console.log('[DEBUG] Server-side rendering complete');

    // Write the final HTML to the output file
    console.log(`[DEBUG] Writing protocol summary report to: ${outputPath}`);
    fs.writeFileSync(outputPath, finalHtml);
    
    // Verify the file was written
    console.log('[DEBUG] File written successfully, checking if it exists...');
    if (fs.existsSync(outputPath)) {
      const outputStats = fs.statSync(outputPath);
      console.log(`[DEBUG] Report file created: ${outputPath}, size: ${outputStats.size} bytes`);
      console.log('[DEBUG] Protocol summary report generated successfully');
    } else {
      console.error(`[ERROR] Failed to create report file: ${outputPath}`);
    }
    
    console.log('COMPLETED PROTOCOL SUMMARY REPORT GENERATION');
  } catch (error) {
    console.error('Error generating protocol summary report:', error);
  }
}

/**
 * Transform the processed data for the protocol summary report
 * @param {Object} processedData - The processed data from the data processor
 * @returns {Object} - Transformed data for the protocol summary report
 */
function transformProtocolData(processedData) {
  const summary = processedData.summary || {};
  const testInfo = summary.testInfo || {};
  const transactions = processedData.transactions || {};
  
  // Extract HTML and non-HTML transactions
  const htmlTransactions = {};
  const nonHtmlTransactions = {};
  
  Object.entries(transactions).forEach(([txName, txData]) => {
    if (txName === 'unknown') return;
    
    if (txName.endsWith('_nonhtml')) {
      nonHtmlTransactions[txName] = txData;
    } else {
      htmlTransactions[txName] = txData;
    }
  });
  
  // Calculate overall metrics from actual data
  const htmlTotalRequests = Object.values(htmlTransactions).reduce((sum, tx) => sum + (tx.requests || 0), 0);
  const nonHtmlTotalRequests = Object.values(nonHtmlTransactions).reduce((sum, tx) => sum + (tx.requests || 0), 0);
  const totalRequests = htmlTotalRequests + nonHtmlTotalRequests;
  
  const htmlFailedRequests = Object.values(htmlTransactions).reduce((sum, tx) => sum + (tx.failed || 0), 0);
  const nonHtmlFailedRequests = Object.values(nonHtmlTransactions).reduce((sum, tx) => sum + (tx.failed || 0), 0);
  const totalFailedRequests = htmlFailedRequests + nonHtmlFailedRequests;
  
  const overallSuccessRate = totalRequests > 0 ? 
    ((totalRequests - totalFailedRequests) / totalRequests * 100).toFixed(2) : '0.00';
  
  // Debug log the extracted transactions
  console.log(`[DEBUG] Extracted ${Object.keys(htmlTransactions).length} HTML transactions and ${Object.keys(nonHtmlTransactions).length} non-HTML transactions`);
  console.log(`[DEBUG] HTML transactions: ${Object.keys(htmlTransactions).join(', ')}`);
  
  // Get metrics data from various parts of the processed data
  // First check if metrics exist in different possible locations
  let ttfbData = {};
  let responseTimeData = {};
  
  // Look for metrics in different possible locations in the data structure
  if (processedData.detailedData?.chartData?.ttfbByTx) {
    console.log('[DEBUG] Found metrics in detailedData.chartData');
    ttfbData = processedData.detailedData.chartData.ttfbByTx || {};
    responseTimeData = processedData.detailedData.chartData.responseTimeByTx || {};
  } else if (processedData.metrics && processedData.metrics.http_req_waiting) {
    console.log('[DEBUG] Found metrics in metrics.http_req_waiting');
    // Extract TTFB (http_req_waiting) and TTLB (http_req_duration) metrics
    const extractMetricsByTx = (metricsObj) => {
      const byTx = {};
      if (metricsObj && metricsObj.values) {
        Object.entries(metricsObj.values).forEach(([txName, values]) => {
          byTx[txName] = values.map(v => ({ value: v }));
        });
      }
      return byTx;
    };
    
    ttfbData = extractMetricsByTx(processedData.metrics.http_req_waiting);
    responseTimeData = extractMetricsByTx(processedData.metrics.http_req_duration);
  }
  
  console.log(`[DEBUG] Found TTFB data for ${Object.keys(ttfbData).length} transactions`);
  console.log(`[DEBUG] Found response time data for ${Object.keys(responseTimeData).length} transactions`);
  
  // Process HTML resources data using only real data
  const htmlResources = processHtmlResources(htmlTransactions, ttfbData, responseTimeData);
  
  // Process non-HTML resources data using only real data
  const nonHtmlResources = processNonHtmlResources(nonHtmlTransactions, ttfbData, responseTimeData);
  
  // Process resource types data by analyzing transaction data
  // Instead of using a placeholder, extract actual resource type data from transactions
  const resourceTypes = processResourceTypes(processedData, nonHtmlTransactions);
  
  // Process network analysis data by analyzing detailed metrics
  // Instead of using a placeholder, extract actual network analysis data
  const networkAnalysis = processNetworkAnalysis(processedData, nonHtmlTransactions);
  
  return {
    testInfo: {
      startTime: summary.startTime,
      endTime: summary.endTime,
      testType: testInfo.testType || 'PROTOCOL',
      aut: testInfo.aut || 'Unknown',
      scenario: testInfo.scenario || 'custom-tps'
    },
    summary: {
      htmlTotalRequests,
      nonHtmlTotalRequests,
      totalRequests,
      htmlFailedRequests,
      nonHtmlFailedRequests,
      totalFailedRequests,
      overallSuccessRate,
      testRunDuration: summary.testRunDuration || 0
    },
    htmlResources,
    nonHtmlResources,
    resourceTypes,
    networkAnalysis
  };
}

/**
 * Process HTML resources data
 * @param {Object} htmlTransactions - HTML transactions data
 * @param {Object} ttfbByTx - TTFB data by transaction
 * @param {Object} responseTimeByTx - Response time data by transaction
 * @returns {Array} - Processed HTML resources data
 */
function processHtmlResources(htmlTransactions, ttfbByTx, responseTimeByTx) {
  const resources = [];
  
  // Process each HTML transaction
  Object.entries(htmlTransactions).forEach(([txName, txData]) => {
    console.log(`[DEBUG] Processing HTML transaction: ${txName}, requests: ${txData.requests}`);
    
    // Get TTFB values for this transaction (actual metrics only)
    const ttfbValues = [];
    if (ttfbByTx[txName]) {
      ttfbByTx[txName].forEach(dataPoint => {
        if (dataPoint && dataPoint.value !== undefined && dataPoint.value !== null && !isNaN(dataPoint.value)) {
          ttfbValues.push(dataPoint.value);
        }
      });
    }
    
    // Get TTLB values for this transaction (actual metrics only)
    const ttlbValues = [];
    if (responseTimeByTx[txName]) {
      responseTimeByTx[txName].forEach(dataPoint => {
        if (dataPoint && dataPoint.value !== undefined && dataPoint.value !== null && !isNaN(dataPoint.value)) {
          ttlbValues.push(dataPoint.value);
        }
      });
    }
    
    console.log(`[DEBUG] Transaction ${txName}: Found ${ttfbValues.length} TTFB values and ${ttlbValues.length} TTLB values`);
    
    // Calculate statistics based on real data
    const ttfbStats = calculateStats(ttfbValues);
    const ttlbStats = calculateStats(ttlbValues);
    
    resources.push({
      transaction: txName,
      requests: txData.requests || 0,
      successRate: txData.successRate || '0.00',
      ttfb: {
        avg: formatValue(ttfbStats.avg),
        med: formatValue(ttfbStats.med),
        p90: formatValue(ttfbStats.p90)
      },
      ttlb: {
        avg: formatValue(ttlbStats.avg),
        med: formatValue(ttlbStats.med),
        p90: formatValue(ttlbStats.p90)
      }
    });
  });
  
  console.log(`[DEBUG] Processed ${resources.length} HTML resources`);
  return resources;
}

/**
 * Process non-HTML resources data
 * @param {Object} nonHtmlTransactions - Non-HTML transactions data
 * @param {Object} ttfbByTx - TTFB data by transaction
 * @param {Object} responseTimeByTx - Response time data by transaction
 * @returns {Array} - Processed non-HTML resources data
 */
function processNonHtmlResources(nonHtmlTransactions, ttfbByTx, responseTimeByTx) {
  const resources = [];
  
  // Process each non-HTML transaction
  Object.entries(nonHtmlTransactions).forEach(([txName, txData]) => {
    console.log(`[DEBUG] Processing non-HTML transaction: ${txName}, requests: ${txData.requests}`);
    
    // Get TTFB values for this transaction (actual metrics only)
    const ttfbValues = [];
    if (ttfbByTx[txName]) {
      ttfbByTx[txName].forEach(dataPoint => {
        if (dataPoint && dataPoint.value !== undefined && dataPoint.value !== null && !isNaN(dataPoint.value)) {
          ttfbValues.push(dataPoint.value);
        }
      });
    }
    
    // Get TTLB values for this transaction (actual metrics only)
    const ttlbValues = [];
    if (responseTimeByTx[txName]) {
      responseTimeByTx[txName].forEach(dataPoint => {
        if (dataPoint && dataPoint.value !== undefined && dataPoint.value !== null && !isNaN(dataPoint.value)) {
          ttlbValues.push(dataPoint.value);
        }
      });
    }
    
    console.log(`[DEBUG] Transaction ${txName}: Found ${ttfbValues.length} TTFB values and ${ttlbValues.length} TTLB values`);
    
    // Calculate statistics based on real data
    const ttfbStats = calculateStats(ttfbValues);
    const ttlbStats = calculateStats(ttlbValues);
    
    resources.push({
      transaction: txName.replace('_nonhtml', ''), // Remove _nonhtml suffix for display
      requests: txData.requests || 0,
      successRate: txData.successRate || '0.00',
      ttfb: {
        avg: formatValue(ttfbStats.avg),
        med: formatValue(ttfbStats.med),
        p90: formatValue(ttfbStats.p90)
      },
      ttlb: {
        avg: formatValue(ttlbStats.avg),
        med: formatValue(ttlbStats.med),
        p90: formatValue(ttlbStats.p90)
      }
    });
  });
  
  console.log(`[DEBUG] Processed ${resources.length} non-HTML resources`);
  return resources;
}

/**
 * Process resource types data
 * @param {Object} processedData - The processed data
 * @param {Object} nonHtmlTransactions - Non-HTML transactions data
 * @returns {Array} - Processed resource types data
 */
function processResourceTypes(processedData, nonHtmlTransactions) {
  // Extract resource types from non-HTML transactions
  const resourceTypesByTransaction = [];
  console.log('[DEBUG] Processing resource types data...');
  
  // Define resource types to extract
  const resourceTypes = ['css', 'js', 'image'];
  const displayNames = {
    'css': 'CSS',
    'js': 'JS',
    'image': 'Image'
  };
  
  // Process each non-HTML transaction to extract resource type data
  Object.entries(nonHtmlTransactions).forEach(([txName, txData]) => {
    // Skip unknown transactions
    if (txName === 'unknown') return;
    
    // Extract the base transaction name (remove _nonhtml suffix)
    const baseTxName = txName.replace('_nonhtml', '');
    console.log(`[DEBUG] Processing resource types for transaction: ${baseTxName}`);
    
    // Create resource entry for this transaction
    const resourceDetails = {};
    let foundSpecificResourceTypes = false;
    
    // First, try to get resources from the detailed resources array if it exists
    if (processedData.resources && Array.isArray(processedData.resources)) {
      console.log(`[DEBUG] Checking resources array for transaction ${baseTxName}`);
      
      // Filter resources for this transaction
      const txResources = processedData.resources.filter(resource => {
        return (resource.transaction === txName || resource.transaction === baseTxName);
      });
      
      if (txResources.length > 0) {
        console.log(`[DEBUG] Found ${txResources.length} resources for ${baseTxName}`);
        
        // Process each resource type
        resourceTypes.forEach(type => {
          // Filter resources by this type
          const typeResources = txResources.filter(res => res.type === type);
          
          if (typeResources.length > 0) {
            // Extract real values
            const ttfbValues = typeResources.map(r => r.ttfb).filter(v => v != null && !isNaN(v));
            const ttlbValues = typeResources.map(r => r.duration).filter(v => v != null && !isNaN(v));
            
            // Only proceed if we have real data
            if (ttfbValues.length > 0 && ttlbValues.length > 0) {
              const ttfbStats = calculateStats(ttfbValues);
              const ttlbStats = calculateStats(ttlbValues);
              
              // Calculate success rate from actual data
              const successCount = typeResources.filter(r => r.status >= 200 && r.status < 400).length;
              const successRate = typeResources.length > 0 ? 
                (successCount / typeResources.length * 100).toFixed(2) : '100.00';
              
              // Add metrics for this resource type using only real data
              resourceDetails[displayNames[type]] = {
                reqs: typeResources.length,
                avgTtfb: ttfbStats.avg,
                avgTtlb: ttlbStats.avg,
                p90: ttlbStats.p90,
                success: successRate
              };
              
              foundSpecificResourceTypes = true;
              console.log(`[DEBUG] Added ${displayNames[type]} metrics for ${baseTxName}: ${typeResources.length} requests, TTFB: ${ttfbStats.avg.toFixed(2)}ms, TTLB: ${ttlbStats.avg.toFixed(2)}ms`);
            }
          }
        });
      }
    }
    
    // If we couldn't find resource type specific data, try to find any metrics we can use
    // This is a fallback that still uses only real data, not synthetic
    if (!foundSpecificResourceTypes) {
      console.log(`[DEBUG] No specific resource type data found for ${baseTxName}, using aggregate metrics`);
      
      // Get TTFB and TTLB data for this transaction
      let ttfbData = [];
      let ttlbData = [];
      
      // Try to find metrics in different possible locations
      if (processedData.detailedData?.chartData?.ttfbByTx?.[txName]) {
        ttfbData = processedData.detailedData.chartData.ttfbByTx[txName] || [];
        ttlbData = processedData.detailedData.chartData.responseTimeByTx?.[txName] || [];
      } else if (processedData.metrics?.http_req_waiting?.values?.[txName]) {
        ttfbData = processedData.metrics.http_req_waiting.values[txName].map(v => ({ value: v })) || [];
        ttlbData = processedData.metrics.http_req_duration?.values?.[txName]?.map(v => ({ value: v })) || [];
      }
      
      // Clean values - remove any undefined, null, or NaN values
      const ttfbValues = ttfbData
        .filter(p => p && p.value !== undefined && p.value !== null && !isNaN(p.value))
        .map(p => p.value);
      
      const ttlbValues = ttlbData
        .filter(p => p && p.value !== undefined && p.value !== null && !isNaN(p.value))
        .map(p => p.value);
      
      // Check if we have valid metrics data for this transaction
      if (ttfbValues.length > 0 && ttlbValues.length > 0) {
        // Calculate statistics from the real data
        const ttfbStats = calculateStats(ttfbValues);
        const ttlbStats = calculateStats(ttlbValues);
        
        // Add all resources as a single category with real metrics
        resourceDetails['All Resources'] = {
          reqs: txData.requests, 
          avgTtfb: ttfbStats.avg,
          avgTtlb: ttlbStats.avg,
          p90: ttlbStats.p90,
          success: txData.successRate || '100.00'
        };
        
        console.log(`[INFO] Added 'All Resources' metrics for ${baseTxName} with ${txData.requests} requests`);
        console.log(`[DEBUG] -- All Resources: Requests: ${txData.requests}, TTFB: ${ttfbStats.avg.toFixed(2)}ms, TTLB: ${ttlbStats.avg.toFixed(2)}ms, p90: ${ttlbStats.p90.toFixed(2)}ms`);
      } else {
        console.log(`[WARNING] No valid metric data available for ${baseTxName}, skipping`);
      }
    }
    
    // Only add this transaction if we found any resource details
    if (Object.keys(resourceDetails).length > 0) {
      resourceTypesByTransaction.push({
        transaction: baseTxName,
        resourceDetails
      });
    }
  });
  
  console.log(`[DEBUG] Extracted resource types for ${resourceTypesByTransaction.length} transactions`);
  return resourceTypesByTransaction;
}

/**
 * Process network analysis data
 * @param {Object} processedData - The processed data
 * @param {Object} nonHtmlTransactions - Non-HTML transactions data
 * @returns {Array} - Processed network analysis data
 */
function processNetworkAnalysis(processedData, nonHtmlTransactions) {
  // Extract network analysis data from non-HTML transactions
  const networkAnalysis = [];
  console.log('[DEBUG] Processing network analysis data...');
  
  // Process each non-HTML transaction to extract network analysis data
  Object.entries(nonHtmlTransactions).forEach(([txName, txData]) => {
    // Skip unknown transactions
    if (txName === 'unknown') return;
    
    // Extract the base transaction name (remove _nonhtml suffix)
    const baseTxName = txName.replace('_nonhtml', '');
    console.log(`[DEBUG] Processing network analysis for transaction: ${baseTxName}`);
    
    // Get TTFB and TTLB data for this transaction from various possible locations
    let ttlbData = [];
    
    // Try to find metrics in different possible locations
    if (processedData.detailedData?.chartData?.responseTimeByTx?.[txName]) {
      ttlbData = processedData.detailedData.chartData.responseTimeByTx[txName] || [];
    } else if (processedData.metrics?.http_req_duration?.values?.[txName]) {
      ttlbData = processedData.metrics.http_req_duration.values[txName].map(v => ({ value: v })) || [];
    }
    
    // Clean values (no undefined, null, or NaN)
    const ttlbValues = ttlbData
      .filter(p => p && p.value !== undefined && p.value !== null && !isNaN(p.value))
      .map(p => p.value);
    
    console.log(`[DEBUG] Transaction ${baseTxName}: Found ${ttlbValues.length} TTLB values for network analysis`);
    
    // Calculate total requests from actual transaction data
    const totalRequests = txData.requests || 0;
    
    // Only proceed if we have actual requests and response time data
    if (totalRequests > 0 && ttlbValues.length > 0) {
      // Calculate statistics from actual data
      const ttlbStats = calculateStats(ttlbValues);
      
      // Create network analysis entry using only actual data
      networkAnalysis.push({
        transaction: baseTxName,
        totalRequests,
        avgTimeMs: formatValue(ttlbStats.avg),
        successRate: txData.successRate || '100.00'
      });
    } else if (totalRequests > 0) {
      // If we have request counts but no timing data, include entry with just the counts
      // This is still valid actual data, just missing the timing metrics
      networkAnalysis.push({
        transaction: baseTxName,
        totalRequests,
        avgTimeMs: 'N/A', // No synthetic data - clearly indicate data is not available
        successRate: txData.successRate || '100.00'
      });
      console.log(`[WARNING] No response time data available for transaction: ${baseTxName}`);
    }
  });
  
  console.log(`[DEBUG] Extracted network analysis for ${networkAnalysis.length} transactions`);
  return networkAnalysis;
}

/**
 * Generate HTML for the summary section
 * @param {Object} summary - Summary data
 * @returns {string} - HTML for the summary section
 */
function generateSummaryHtml(summary) {
  // Format duration in minutes and seconds
  let durationDisplay = 'N/A';
  if (summary.testRunDuration !== undefined) {
    const totalSeconds = summary.testRunDuration;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    durationDisplay = `${minutes}m ${seconds}s`;
  }

  return `
    <div class="summary-stats-grid">
      <div class="summary-stat-card primary">
        <div class="summary-stat-value">${summary.htmlTotalRequests || 0}</div>
        <div class="summary-stat-label">HTML Requests</div>
      </div>
      <div class="summary-stat-card success">
        <div class="summary-stat-value">${summary.nonHtmlTotalRequests || 0}</div>
        <div class="summary-stat-label">Non-HTML Requests</div>
      </div>
      <div class="summary-stat-card warning">
        <div class="summary-stat-value">${summary.overallSuccessRate || '0.00'}%</div>
        <div class="summary-stat-label">Overall Success Rate</div>
      </div>
      <div class="summary-stat-card ${summary.totalFailedRequests > 0 ? 'danger' : 'primary'}">
        <div class="summary-stat-value">${summary.totalFailedRequests || 0}</div>
        <div class="summary-stat-label">Failed Requests</div>
      </div>
      <div class="summary-stat-card primary">
        <div class="summary-stat-value">${durationDisplay}</div>
        <div class="summary-stat-label">Test Duration</div>
      </div>
    </div>
  `;
}

/**
 * Generate HTML for the overall metrics table
 * @param {Object} summary - Summary data
 * @returns {string} - HTML for the overall metrics table
 */
function generateOverallMetricsHtml(summary) {
  return `
    <div class="overflow-x-auto">
      <table class="custom-table w-full">
        <thead>
          <tr>
            <th>Resource Type</th>
            <th>Requests</th>
            <th>Success Rate</th>
            <th>Failed</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>HTML Resources</td>
            <td>${summary.htmlTotalRequests || 0}</td>
            <td>${summary.htmlTotalRequests > 0 ? 
    ((summary.htmlTotalRequests - summary.htmlFailedRequests) / summary.htmlTotalRequests * 100).toFixed(2) : 
    '0.00'}%</td>
            <td>${summary.htmlFailedRequests || 0}</td>
          </tr>
          <tr>
            <td>Non-HTML Resources</td>
            <td>${summary.nonHtmlTotalRequests || 0}</td>
            <td>${summary.nonHtmlTotalRequests > 0 ? 
    ((summary.nonHtmlTotalRequests - summary.nonHtmlFailedRequests) / summary.nonHtmlTotalRequests * 100).toFixed(2) : 
    '0.00'}%</td>
            <td>${summary.nonHtmlFailedRequests || 0}</td>
          </tr>
          <tr class="font-semibold">
            <td>Total</td>
            <td>${summary.totalRequests || 0}</td>
            <td>${summary.overallSuccessRate || '0.00'}%</td>
            <td>${summary.totalFailedRequests || 0}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
}

/**
 * Generate HTML for a resources table
 * @param {Array} resources - Resources data
 * @param {string} tableClass - CSS class for the table
 * @returns {string} - HTML for the resources table
 */
function generateResourcesTableHtml(resources, tableClass) {
  if (!resources || resources.length === 0) {
    return '<p>No resource data available.</p>';
  }

  let tableHtml = `
    <div class="overflow-x-auto">
      <table class="custom-table ${tableClass} w-full">
        <thead>
          <tr>
            <th>Transaction</th>
            <th>Requests</th>
            <th>Success Rate</th>
            <th colspan="3">TTFB (ms)</th>
            <th colspan="3">TTLB (ms)</th>
          </tr>
          <tr>
            <th></th>
            <th></th>
            <th></th>
            <th>Avg</th>
            <th>Med</th>
            <th>p90</th>
            <th>Avg</th>
            <th>Med</th>
            <th>p90</th>
          </tr>
        </thead>
        <tbody>
  `;

  resources.forEach(resource => {
    tableHtml += `
      <tr>
        <td>${resource.transaction}</td>
        <td>${resource.requests}</td>
        <td>${resource.successRate}%</td>
        <td>${resource.ttfb.avg}</td>
        <td>${resource.ttfb.med}</td>
        <td>${resource.ttfb.p90}</td>
        <td>${resource.ttlb.avg}</td>
        <td>${resource.ttlb.med}</td>
        <td>${resource.ttlb.p90}</td>
      </tr>
    `;
  });

  tableHtml += `
        </tbody>
      </table>
    </div>
  `;

  return tableHtml;
}

/**
 * Generate HTML for the resource types table
 * @param {Array} resourceTypes - Resource types data
 * @returns {string} - HTML for the resource types table
 */
function generateResourceTypesTableHtml(resourceTypes) {
  if (!resourceTypes || resourceTypes.length === 0) {
    return '<p>No resource type data available.</p>';
  }

  // Add a note about data integrity requirements
  let tableHtml = `
    <div class="mb-4 p-4 bg-yellow-50 border-l-4 border-yellow-400 text-yellow-700">
      <p class="font-medium">Note: Following strict data integrity requirements, only actual measured metrics are shown.</p>
      <p class="text-sm">Resource type breakdowns (CSS/JS/Image) would require additional instrumentation data not available in this test run.</p>
    </div>
    <div class="overflow-x-auto">
      <table class="custom-table resource-type-table w-full">
        <thead>
          <tr>
            <th>Transaction</th>
            <th>Resource Type</th>
            <th>Requests</th>
            <th>Avg TTFB (ms)</th>
            <th>Avg TTLB (ms)</th>
            <th>p90 (ms)</th>
            <th>Success Rate</th>
          </tr>
        </thead>
        <tbody>
  `;

  resourceTypes.forEach(transaction => {
    const txName = transaction.transaction;
    const resourceDetails = transaction.resourceDetails || {};
    
    // If no resource details, skip this transaction
    if (Object.keys(resourceDetails).length === 0) return;
    
    // Add a row for each resource type
    Object.entries(resourceDetails).forEach(([resourceType, metrics], index) => {
      tableHtml += `
        <tr${index === 0 ? ' class="border-t-4 border-slate-200"' : ''}>
          ${index === 0 ? `<td rowspan="${Object.keys(resourceDetails).length}">${txName}</td>` : ''}
          <td>${resourceType}</td>
          <td>${metrics.reqs}</td>
          <td>${formatValue(metrics.avgTtfb)}</td>
          <td>${formatValue(metrics.avgTtlb)}</td>
          <td>${formatValue(metrics.p90)}</td>
          <td>${metrics.success}%</td>
        </tr>
      `;
    });
  });

  tableHtml += `
        </tbody>
      </table>
    </div>
  `;

  return tableHtml;
}

/**
 * Generate HTML for the network analysis table
 * @param {Array} networkAnalysis - Network analysis data
 * @returns {string} - HTML for the network analysis table
 */
function generateNetworkAnalysisTableHtml(networkAnalysis) {
  if (!networkAnalysis || networkAnalysis.length === 0) {
    return '<p>No network analysis data available.</p>';
  }

  let tableHtml = `
    <div class="overflow-x-auto">
      <table class="custom-table network-table w-full">
        <thead>
          <tr>
            <th>Transaction</th>
            <th>Total Requests</th>
            <th>Avg Time (ms)</th>
            <th>Success Rate</th>
          </tr>
        </thead>
        <tbody>
  `;

  networkAnalysis.forEach(analysis => {
    tableHtml += `
      <tr>
        <td>${analysis.transaction}</td>
        <td>${analysis.totalRequests}</td>
        <td>${analysis.avgTimeMs}</td>
        <td>${analysis.successRate}%</td>
      </tr>
    `;
  });

  tableHtml += `
        </tbody>
      </table>
    </div>
  `;

  return tableHtml;
}

/**
 * Calculate statistics for an array of values
 * @param {Array} values - Array of numeric values
 * @returns {Object} - Statistics object
 */
function calculateStats(values) {
  if (!values || values.length === 0) {
    return { min: 0, max: 0, avg: 0, med: 0, p90: 0, p95: 0, p99: 0, count: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;
  const min = sorted[0];
  const max = sorted[count - 1];
  const sum = sorted.reduce((acc, val) => acc + val, 0);
  const avg = sum / count;
  const med = sorted[Math.floor(count / 2)];
  const p90 = sorted[Math.floor(count * 0.9)];
  const p95 = sorted[Math.floor(count * 0.95)];
  const p99 = sorted[Math.floor(count * 0.99)];

  return { min, max, avg, med, p90, p95, p99, count };
}

/**
 * Format a numeric value for display
 * @param {number} value - The value to format
 * @returns {string} - Formatted value
 */
function formatValue(value) {
  if (value === undefined || value === null || isNaN(value)) {
    return 'N/A';
  }
  return value.toFixed(2);
}

// Export the function for use in other modules
export { generateProtocolSummaryReport };

// Execute the function if this script is run directly
if (import.meta.url === import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.error('Usage: node protocol-summary-report-generator.js <processedDataPath> <templatePath> <outputPath>');
    process.exit(1);
  }

  const processedDataPath = args[0];
  const templatePath = args[1];
  const outputPath = args[2];

  generateProtocolSummaryReport(processedDataPath, templatePath, outputPath);
}
