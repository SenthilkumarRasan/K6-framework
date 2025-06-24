/* globals require, process, module */
const {
  calculateStats,
  calculateAggregateStats,
  buildPageLoadBreakdownTable,
  buildTop5NetworkResourcesTable,
  buildReportLegend
} = require('./report-helpers.js');

function extractCoreWebVitalsMetrics(processedData) {
  // processedData here is the 'data' object from process-k6-results.js
  // It contains keys like 'fcp', 'lcp', where each is an object:
  // { transactionName1: [rawValue1, rawValue2], transactionName2: [rawValue3] }
  const coreWebVitalsOutput = {
    fcp: {},
    lcp: {},
    cls: {},
    ttfb: {}
    // fid and inp are not currently processed or collected by these names
  };

  if (!processedData) {
    return coreWebVitalsOutput;
  }

  const cwvMetricsToProcess = {
    fcp: processedData.fcp,     // e.g., processedData.fcp from process-k6-results
    lcp: processedData.lcp,
    cls: processedData.cls,
    ttfb: processedData.ttfb    // This should align with the key used in process-k6-results (e.g. data.ttfb)
  };

  for (const metricName in cwvMetricsToProcess) {
    const metricDataByTransaction = cwvMetricsToProcess[metricName];
    if (metricDataByTransaction) {
      for (const transactionName in metricDataByTransaction) {
        const values = metricDataByTransaction[transactionName];
        if (Array.isArray(values) && values.length > 0) {
          // calculateStats is imported at the top of this file from report-helpers.js
          const stats = calculateStats(values);
          coreWebVitalsOutput[metricName][transactionName] = stats.avg; // Storing the average
        } else {
          coreWebVitalsOutput[metricName][transactionName] = 0; // Default if no data
        }
      }
    }
  }
  return coreWebVitalsOutput;
}

function extractMetricsByTransaction(data, metricName, targetObject) {
  if (!data.metrics || !data.metrics[metricName] || !data.metrics[metricName].values) {
    // Metric not found or has no values
    return;
  }

  const metricValues = data.metrics[metricName].values;

  // For Trend metrics, 'values' is an object where keys can be tag strings or direct stats like 'avg', 'p(90)'
  // We are interested in values tagged with 'transaction::transaction_name'
  // Example key: "transaction::Homepage,url_name::/,aut::my_app,environment::dev,test_type::BROWSER,scenario::smoke"
  // We need to parse these keys to extract the transaction name and the metric value (e.g., avg).

  // Check if the metric is a k6 built-in browser metric (e.g., browser_web_vital_fcp)
  // which might have a simpler structure if not using custom trends with explicit tagging in the script.
  // However, our script `verticalBrowser.js` uses custom Trend objects (e.g., fcpByTransaction)
  // and adds values with tags like { transaction: 'transactionName', ... }.
  // The k6 JSON output for such a Trend metric will have entries in `values` like:
  // "avg{transaction=Homepage,aut=...}": 123.45
  // "p(90){transaction=Homepage,aut=...}": 200.0
  // Or, if k6 aggregates by unique tag combinations directly:
  // "avg{tags_string_for_combination_1}": value1
  // "avg{tags_string_for_combination_2}": value2

  // Let's iterate over the keys in metricValues (e.g., 'avg', 'p(90)', etc.)
  // if the values are objects themselves containing tagged data.
  // Or, if k6 >0.32.0, tags are part of the key string.

  for (const key in metricValues) {
    // Example key from k6 JSON: "avg{transaction=ProductPage,aut=myAut,...}"
    // or for older k6 versions or different metric types, it might be simpler.
    // We need to extract the transaction tag and the actual value.
    
    // This regex attempts to find 'transaction=someValue' and capture 'someValue'
    const transactionMatch = key.match(/transaction=([^,{}]+)/);
    if (transactionMatch && transactionMatch[1]) {
      const transactionName = transactionMatch[1];
      // We are interested in the 'avg' value for simplicity in this report section.
      // The key itself might be 'avg{...}' or 'p(90){...}'. We'll look for 'avg' at the start.
      if (key.startsWith('avg')) {
        targetObject[transactionName] = metricValues[key];
      }
      // If we need other percentiles, we can add more conditions:
      // else if (key.startsWith('p(90)')) { targetObject[transactionName_p90] = metricValues[key]; }
    } else if (metricValues[key] && typeof metricValues[key] === 'object' && metricValues[key].avg !== undefined && key === 'values') {
      // This case might handle structures where 'values' itself is a key under metricData.values
      // and contains transaction-specific objects with an 'avg'. This is less common for tagged trends.
      // Example: metricData.values.values.transactionName.avg - needs verification if such a structure exists.
    } else if (typeof metricValues[key] === 'number' && !key.includes('{')) {
      // Fallback for non-tagged or globally aggregated values if the key is simple (e.g., just 'avg')
      // This would put it under a generic key in targetObject. Not ideal for per-transaction.
      // If 'key' is a transaction name directly (older k6 or untagged custom metric style)
      // targetObject[key] = metricValues[key]; // This was part of the original logic
    }
  }
  // If, after iterating, targetObject is still empty for a known metric, it means no tagged values were found.
  // This could happen if the metric exists but has no data points with the 'transaction' tag.
}


// Helper function to build detailed performance statistics by transaction in a consolidated table
function buildDetailedStatsByTransaction(data, transactions) {
  if (!data || !transactions || !Array.isArray(transactions) || transactions.length === 0) {
    return '<p>No data available for transaction breakdown.</p>';
  }
  
  let html = '';
  html += '<div class="metrics-section">';
  
  // Define metrics we want to show
  const metricNames = [
    'serverProcessingTime',
    'networkTime',
    'domProcessingTime',
    'scriptExecutionTime',
    'scriptParsingTime',
    'jsLoadTime',
    'cssLoadTime',
    'imgLoadTime',
    'fontLoadTime',
    'otherResourceLoadTime',
    'pageLoadTime'
  ];
  
  // Map the metric names to their actual k6 metric names in the data object
  const metricDataMapping = {
    'serverProcessingTime': 'serverProcessingTime',
    'networkTime': 'networkTime',
    'domProcessingTime': 'domProcessingTime',
    'scriptExecutionTime': 'scriptExecutionTime',
    'scriptParsingTime': 'scriptParsingTime',
    'jsLoadTime': 'jsLoadTime',
    'cssLoadTime': 'cssLoadTime',
    'imgLoadTime': 'imgLoadTime',
    'fontLoadTime': 'fontLoadTime',
    'otherResourceLoadTime': 'otherResourceLoadTime',
    'pageLoadTime': 'pageLoadTime'
  };
  
  const metricDisplayNames = {
    'serverProcessingTime': 'Server Processing Time',
    'networkTime': 'Network Transfer Time',
    'domProcessingTime': 'DOM Processing Time',
    'scriptExecutionTime': 'Script Execution Time',
    'scriptParsingTime': 'Script Parsing Time',
    'jsLoadTime': 'JavaScript Load Time',
    'cssLoadTime': 'CSS Load Time',
    'imgLoadTime': 'Image Load Time',
    'fontLoadTime': 'Font Load Time',
    'otherResourceLoadTime': 'Other Resources Load Time',
    'pageLoadTime': 'Total Page Load Time'
  };
  
  // Create a table with transactions as rows and metrics as columns
  html += '<table class="transaction-stats-table"><thead><tr><th>Transaction</th><th>Requests</th>';
  
  // Add column headers for each metric (Avg and p90)
  metricNames.forEach(metricName => {
    const displayName = metricDisplayNames[metricName];
    html += `<th colspan="2">${displayName}</th>`;
  });
  html += '</tr><tr><th></th>';
  
  // Add Avg/p90 subheaders for each metric
  html += '<th>Count</th>'; // Add the requests count header
  metricNames.forEach(() => {
    html += '<th>Avg (ms)</th><th>p90 (ms)</th>';
  });
  html += '</tr></thead><tbody>';
  
  // Add rows for each transaction
  transactions.forEach(transaction => {
    const rowClass = '';
    
    // Get the actual request count for this transaction from the metrics
    // No hardcoded values - use the actual data collected with transaction tags
    let totalRequests = 0;
    if (data.browser_page_load_success && data.browser_page_load_success[transaction]) {
      totalRequests = data.browser_page_load_success[transaction].requests || 0;
    } else if (data.pageLoadTime && data.pageLoadTime[transaction]) {
      totalRequests = data.pageLoadTime[transaction].length || 0;
    }
    
    html += `<tr class="${rowClass}"><td>${transaction}</td><td>${totalRequests}</td>`;
    
    // Add cells for each metric
    metricNames.forEach(metricName => {
      // Use the mapping to get the actual k6 metric name in the data object
      const k6MetricName = metricDataMapping[metricName];
      
      // Get metric values for this transaction
      const metricValues = data[k6MetricName] && data[k6MetricName][transaction] ? data[k6MetricName][transaction] : [];
      
      // Determine cell class based on metric type
      let cellClass = '';
      if (metricName === 'serverProcessingTime') {
        cellClass = 'server-cell';
      } else if (metricName === 'pageLoadTime') {
        cellClass = 'client-total-cell';
      }
      
      if (metricValues.length > 0) {
        const stats = calculateStats(metricValues);
        html += `<td class="${cellClass}">${stats.avg.toFixed(2)}</td><td class="${cellClass}">${stats.p90.toFixed(2)}</td>`;
      } else {
        html += `<td class="${cellClass}">N/A</td><td class="${cellClass}">N/A</td>`;
      }
    });
    
    html += '</tr>';
  });
  
  html += '</tbody></table>';
  html += '</div>'; // Close metrics-section
  return html;
}

// Helper function to build the overall browser summary table
function buildBrowserSummaryTable(data, transactions, requestCounts) {
  if (!data || !transactions || !Array.isArray(transactions) || transactions.length === 0) {
    return '<p>No data available for browser summary.</p>';
  }

  // Get request counts if not provided
  if (!requestCounts) {
    requestCounts = calculateRequestCounts(data, transactions);
  }
  
  // Calculate aggregate stats for key metrics - only keep what we need for the summary table
  const serverStats = calculateAggregateStats(data.serverProcessingTime);
  const totalStats = calculateAggregateStats(data.pageLoadTime);
  
  // Calculate client-side stats (total - server)
  const clientSideStats = {
    avg: totalStats.avg - serverStats.avg,
    min: totalStats.min - serverStats.min,
    max: totalStats.max - serverStats.max,
    median: totalStats.median - serverStats.median,
    p90: totalStats.p90 - serverStats.p90,
    p95: totalStats.p95 - serverStats.p95,
    p99: totalStats.p99 - serverStats.p99,
    count: totalStats.count
  };
  
  let html = '';
  html += '<div class="metrics-section">';
  
  // Add color legend for different sections
  

  // Add request counts to the summary
  html += `<div class="request-counts-summary">
    <div class="count-box">
      <div class="count-value">${requestCounts.totalTransactions}</div>
      <div class="count-label">Total Transactions</div>
    </div>
    <div class="count-box">
      <div class="count-value">${requestCounts.totalResourceRequests}</div>
      <div class="count-label">Total Resource Requests</div>
    </div>
  </div>`;
  
  // Server-side vs. client-side summary table
  html += '<table class="overall-summary-table"><thead><tr><th>Component</th><th>Avg (ms)</th><th>Median (ms)</th><th>p90 (ms)</th><th>% of Total</th></tr></thead><tbody>';
  
  // Total page load time row
  html += `<tr class="total-row"><td>Total Page Load Time</td><td>${totalStats.avg.toFixed(2)}</td><td>${totalStats.median.toFixed(2)}</td><td>${totalStats.p90.toFixed(2)}</td><td>100.0%</td></tr>`;
  
  // Server processing time row with percentage
  const serverPct = totalStats.avg > 0 ? (serverStats.avg / totalStats.avg * 100).toFixed(1) : '0.0';
  html += `<tr class="server-row"><td>Server Processing (TTFB)</td><td>${serverStats.avg.toFixed(2)}</td><td>${serverStats.median.toFixed(2)}</td><td>${serverStats.p90.toFixed(2)}</td><td>${serverPct}%</td></tr>`;
  
  // Client-side processing row with percentage
  const clientPct = totalStats.avg > 0 ? (clientSideStats.avg / totalStats.avg * 100).toFixed(1) : '0.0';
  html += `<tr class="client-row"><td>Client-Side Processing</td><td>${clientSideStats.avg.toFixed(2)}</td><td>${clientSideStats.median.toFixed(2)}</td><td>${clientSideStats.p90.toFixed(2)}</td><td>${clientPct}%</td></tr>`;
  
  html += '</tbody></table>';
  html += '</div>'; // Close metrics-section
  
  // We've removed the Detailed Performance Statistics and Client-Side Timing Breakdown tables as requested
  
  // Add legend explaining the metrics
  html += `<div class="legend">


  </div>`;
  
  return html;
}

// Main function to generate the browser-specific part of the HTML report
// Calculate total requests and transactions for the summary section
function calculateRequestCounts(data, transactions) {
  let totalTransactions = 0;
  let totalResourceRequests = 0;
  
  // Count transactions by looking at page load success metrics
  transactions.forEach(transaction => {
    if (data.browser_page_load_success && data.browser_page_load_success[transaction]) {
      totalTransactions += data.browser_page_load_success[transaction].requests || 0;
    }
  });
  
  // Count non-HTML resource requests across all resource types
  if (data.resource_details) {
    Object.keys(data.resource_details).forEach(type => {
      if (type !== 'html' && Array.isArray(data.resource_details[type])) {
        totalResourceRequests += data.resource_details[type].length;
      }
    });
  }
  
  return { totalTransactions, totalResourceRequests };
}

function generateBrowserReport(data, transactions, state) {
  // Calculate request counts for summary
  const requestCounts = calculateRequestCounts(data, transactions);
  
  // Add CSS for request counts summary and section colors
  state.htmlReportContent.push(`
  <style>
    /* Request counts styling */
    .request-counts-summary {
      display: flex;
      justify-content: space-around;
      margin: 20px 0;
      padding: 15px;
      background-color: #f0f4f8;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .count-box {
      text-align: center;
      padding: 10px 20px;
    }
    .count-value {
      font-size: 28px;
      font-weight: bold;
      color: #1976d2;
    }
    .count-label {
      font-size: 14px;
      color: #546e7a;
      margin-top: 5px;
    }
    
    /* Section header colors */
    .summary-section h3 { background-color: #5271FF; color: white; padding: 10px 15px; }
    .core-web-vitals-section h3 { background-color: #38B000; color: white; padding: 10px 15px; }
    .mantle-metrics-section .metrics-table thead tr:first-child th { background-color: #FFA500; color: white; }
    .detailed-performance-section .metrics-table thead tr:first-child th { background-color: #9E0059; color: white; }
    .detailed-performance-section h3 { background-color: #9E0059; color: white; padding: 10px 15px; }
    .network-resources-section h3 { background-color: #2D3142; color: white; padding: 10px 15px; }
  </style>
  `);

  // Legend will be moved to the bottom of the report

  // Overall Summary Section (Browser)
  state.htmlReportContent.push('<h2 class="section-title">Overall Performance Summary</h2>');
  state.htmlReportContent.push(buildBrowserSummaryTable(data, transactions, requestCounts));

  // Core Web Vitals section - moved up for better visibility
  state.htmlReportContent.push('<h2 class="section-title">Core Web Vitals</h2>');
  
  // Get raw data for Core Web Vitals
  if (data.lcp || data.fcp || data.cls || data.ttfb) {
    state.htmlReportContent.push('<div class="metrics-section">');
    state.htmlReportContent.push('<table class="core-web-vitals-table"><thead><tr><th rowspan="2">Transaction</th><th rowspan="2">Requests</th><th colspan="2">FCP (ms)</th><th colspan="2">LCP (ms)</th><th colspan="2">CLS</th><th colspan="2">TTFB (ms)</th></tr><tr><th>Median</th><th>p90</th><th>Median</th><th>p90</th><th>Median</th><th>p90</th><th>Median</th><th>p90</th></tr></thead><tbody>');
    
    transactions.forEach(transaction => {
      // Calculate stats for each metric
      const fcpStats = data.fcp && data.fcp[transaction] && data.fcp[transaction].length > 0 ? 
        calculateStats(data.fcp[transaction]) : { median: 0, p90: 0 };
      
      const lcpStats = data.lcp && data.lcp[transaction] && data.lcp[transaction].length > 0 ? 
        calculateStats(data.lcp[transaction]) : { median: 0, p90: 0 };
      
      const clsStats = data.cls && data.cls[transaction] && data.cls[transaction].length > 0 ? 
        calculateStats(data.cls[transaction]) : { median: 0, p90: 0 };
      
      const ttfbStats = data.ttfb && data.ttfb[transaction] && data.ttfb[transaction].length > 0 ? 
        calculateStats(data.ttfb[transaction]) : { median: 0, p90: 0 };
      
      // Get request count for this transaction from browser_page_load_success
      let requestCount = 0;
      if (data.browser_page_load_success && data.browser_page_load_success[transaction]) {
        requestCount = data.browser_page_load_success[transaction].requests || 0;
      }
      
      state.htmlReportContent.push(`<tr>
        <td>${transaction}</td>
        <td>${requestCount}</td>
        <td>${fcpStats.median.toFixed(2)}</td>
        <td>${fcpStats.p90.toFixed(2)}</td>
        <td>${lcpStats.median.toFixed(2)}</td>
        <td>${lcpStats.p90.toFixed(2)}</td>
        <td>${clsStats.median.toFixed(4)}</td>
        <td>${clsStats.p90.toFixed(4)}</td>
        <td>${ttfbStats.median.toFixed(2)}</td>
        <td>${ttfbStats.p90.toFixed(2)}</td>
      </tr>`);
    });
    state.htmlReportContent.push('</tbody></table></div>');
  } else {
    state.htmlReportContent.push('<p>No Core Web Vitals metrics available for this test run.</p>');
  }

  // Mantle Metrics (if enabled)
  const mantleMetricsEnabledForReport = (process.env.CAPTURE_MANTLE_METRICS || 'true').toLowerCase() === 'true';
  if (mantleMetricsEnabledForReport) {
    const mantleMetricDisplayNames = {
      'browser_mantle_first_ad_load': 'Mantle First Ad Load (ms)',
      'browser_mantle_first_ad_render': 'Mantle First Ad Render (ms)',
      'browser_mantle_first_ad_request': 'Mantle First Ad Request (ms)',
      'browser_mantle_first_ad_response': 'Mantle First Ad Response (ms)',
      'browser_mantle_gtm_loaded': 'Mantle GTM Loaded (ms)',
      'browser_mantle_gpt_loaded': 'Mantle GPT Loaded (ms)',
      'browser_mantle_scroll_depth': 'Mantle Scroll Depth (%)',
      'browser_mantle_content_depth_px': 'Mantle Content Depth (px)',
      'browser_mantle_third_party_fired': 'Mantle Third Party Fired (ms)',
      'browser_mantle_deferred_fired': 'Mantle Deferred Fired (ms)',
      'browser_mantle_video_player_loaded': 'Mantle Video Player Loaded (ms)',
      'browser_mantle_ad_refresh_rate': 'Mantle Ad Refresh Rate (count)',
      'browser_mantle_ad_bidder_amount': 'Mantle Ad Bidder Amount (count)',
      'browser_mantle_first_scroll': 'Mantle First Scroll (ms)',
      'browser_mantle_adsrendered': 'Mantle Ads Rendered (count)',
      'browser_mantle_adsviewable': 'Mantle Ads Viewable (count)'
    };
    
    // Get all available Mantle metric keys from the data
    const availableMantleKeys = Object.keys(data).filter(key => 
      key.startsWith('browser_mantle_') && 
      Object.keys(data[key] || {}).length > 0
    );
    
    // Filter out any Mantle metrics that only contain fallback/sample data
    const realMantleKeys = availableMantleKeys.filter(key => {
      // Check if this metric has any real data (not just fallback data)
      if (!data[key]) return false;
      
      // Check each transaction's data to see if it's real or fallback
      for (const transaction in data[key]) {
        const values = data[key][transaction];
        // If we have values and they're not all identical (which would indicate fallback data)
        if (values && values.length > 0) {
          // Check if all values are identical (likely fallback data)
          const firstValue = values[0];
          const allSame = values.every(v => v === firstValue);
          if (!allSame) return true; // Found real data with variation
        }
      }
      return false; // No real data found for this metric
    });
    
    if (realMantleKeys.length > 0) {
      state.htmlReportContent.push('<h2 class="section-title">Mantle Custom Metrics</h2>');
      
      // Create a consolidated table with all Mantle metrics
      state.htmlReportContent.push('<div class="metrics-section">');
      state.htmlReportContent.push('<table class="mantle-metrics-table"><thead><tr><th rowspan="2">Transaction</th><th rowspan="2">Requests</th>');
      
      // Add column headers for each Mantle metric with 2 columns each
      realMantleKeys.forEach(metricKey => {
        if (mantleMetricDisplayNames[metricKey]) {
          state.htmlReportContent.push(`<th colspan="2">${mantleMetricDisplayNames[metricKey]}</th>`);
        }
      });
      
      // Add second header row with Avg, p90 or Min, Max for each metric
      state.htmlReportContent.push('</tr><tr>');
      const countBasedMetrics = ['browser_mantle_scroll_depth', 'browser_mantle_adsrendered', 'browser_mantle_adsviewable'];
      realMantleKeys.forEach(metricKey => {
        if (countBasedMetrics.includes(metricKey)) {
          state.htmlReportContent.push('<th>Min</th><th>Max</th>');
        } else {
          state.htmlReportContent.push('<th>Avg</th><th>p90</th>');
        }
      });
      
      state.htmlReportContent.push('</tr></thead><tbody>');
      
      // Add rows for each transaction
      transactions.forEach(transaction => {
        let hasDataForTransaction = false;
        let requestCount = 0;
        
        // Get the actual request count for this transaction from browser_page_load_success
        if (data.browser_page_load_success && data.browser_page_load_success[transaction]) {
          requestCount = data.browser_page_load_success[transaction].requests || 0;
          hasDataForTransaction = true;
        }
        
        // If we don't have request counts from page load success, check if we have any data for this transaction in Mantle metrics
        if (requestCount === 0) {
          for (const metricKey of realMantleKeys) {
            if (data[metricKey] && data[metricKey][transaction] && data[metricKey][transaction].length > 0) {
              hasDataForTransaction = true;
              requestCount = data[metricKey][transaction].length; // Use length of first available metric as request count
              break; // Break out of loop once we find data
            }
          }
        }
        
        if (hasDataForTransaction) {
          state.htmlReportContent.push(`<tr><td>${transaction}</td><td>${requestCount}</td>`);
          
          // Add cells for each Mantle metric
          realMantleKeys.forEach(metricKey => {
            if (mantleMetricDisplayNames[metricKey]) {
              const metricValues = data[metricKey] && data[metricKey][transaction] ? data[metricKey][transaction] : [];
              
              // Check if we have real data (not just fallback data)
              if (metricValues.length > 0) {
                // Check if all values are identical (likely fallback data)
                const firstValue = metricValues[0];
                const allSame = metricValues.every(v => v === firstValue);
                
                if (!allSame) {
                  // Real data with variation
                  const stats = calculateStats(metricValues);
                  const countBasedMetrics = ['browser_mantle_scroll_depth', 'browser_mantle_adsrendered', 'browser_mantle_adsviewable'];
                  if (countBasedMetrics.includes(metricKey)) {
                    state.htmlReportContent.push(`<td>${stats.min.toFixed(2)}</td><td>${stats.max.toFixed(2)}</td>`);
                  } else {
                    state.htmlReportContent.push(`<td>${stats.avg.toFixed(2)}</td><td>${stats.p90.toFixed(2)}</td>`);
                  }
                } else {
                  // Likely fallback data
                  state.htmlReportContent.push('<td>N/A</td><td>N/A</td>');
                }
              } else {
                state.htmlReportContent.push('<td>N/A</td><td>N/A</td>');
              }
            }
          });
          
          state.htmlReportContent.push('</tr>');
        }
      });
      
      state.htmlReportContent.push('</tbody></table></div>');
    } else {
      state.htmlReportContent.push('<h2 class="section-title">Mantle Custom Metrics</h2>');
      state.htmlReportContent.push('<p>No Mantle metrics available for this test run.</p>');
    }
  }
  
  // Add Detailed Performance Statistics and Network Resources at the bottom
  state.htmlReportContent.push('<h2 class="section-title">Detailed Performance Analysis</h2>');
  state.htmlReportContent.push(buildDetailedStatsByTransaction(data, transactions));

  state.htmlReportContent.push('<h2 class="section-title">Network Resource Analysis</h2>');
  state.htmlReportContent.push(buildTop5NetworkResourcesTable(data, transactions));
  
  // Add the legend at the bottom of the report
  state.htmlReportContent.push(buildReportLegend());
}

function buildHtmlMantleMetricsReport(data, templates, mantleMetricDisplayNames, mantleMetricKeysFromConfig, helpers) {
  // 'helpers' provides access to calculateStats if needed, or it's globally available via import
  const calculateStatsFunction = helpers && helpers.calculateStats ? helpers.calculateStats : calculateStats;
  if (!data || !templates || !Array.isArray(templates) || templates.length === 0 || !mantleMetricDisplayNames || !mantleMetricKeysFromConfig) {
    return '<p>No data available for Mantle metrics.</p>';
  }
  let reportHtml = '';
  const sortedTemplates = Array.from(templates).sort();

  sortedTemplates.forEach(templateName => {
    let hasDataForTemplate = false;
    mantleMetricKeysFromConfig.forEach(metricKey => {
      // Check if metric data exists for this template
      if (data[metricKey] && data[metricKey][templateName] && Array.isArray(data[metricKey][templateName]) && data[metricKey][templateName].length > 0) {
        hasDataForTemplate = true;
      }
    });

    if (hasDataForTemplate) {
      reportHtml += `<h3>Mantle Metrics for Template: ${templateName}</h3>`;
      reportHtml += '<table class="mantle-metrics-table"><thead><tr><th>Metric Name</th><th>Requests</th><th>Min (ms)</th><th>Max (ms)</th><th>Avg (ms)</th><th>Median (ms)</th><th>p90 (ms)</th><th>p95 (ms)</th><th>p99 (ms)</th></tr></thead><tbody>';
      mantleMetricKeysFromConfig.forEach(metricKey => {
        if (mantleMetricDisplayNames[metricKey] && data[metricKey] && data[metricKey][templateName] && Array.isArray(data[metricKey][templateName])) {
          const metricValuesForTemplate = data[metricKey][templateName];

          if (metricValuesForTemplate.length > 0) {
            const stats = calculateStatsFunction(metricValuesForTemplate);
            const displayName = mantleMetricDisplayNames[metricKey];
            reportHtml += `<tr><td>${displayName}</td><td>${stats.count}</td><td>${stats.min.toFixed(2)}</td><td>${stats.max.toFixed(2)}</td><td>${stats.avg.toFixed(2)}</td><td>${stats.median.toFixed(2)}</td><td>${stats.p90.toFixed(2)}</td><td>${stats.p95.toFixed(2)}</td><td>${stats.p99.toFixed(2)}</td></tr>`;
          }
        }
      });
      reportHtml += '</tbody></table></div>';
    }
  }); // End sortedTemplates.forEach

  return reportHtml;
} // End buildHtmlMantleMetricsReport

module.exports = {
  generateBrowserReport,
  extractCoreWebVitalsMetrics,
  extractMetricsByTransaction,
  buildPageLoadBreakdownTable,
  buildHtmlMantleMetricsReport
};
