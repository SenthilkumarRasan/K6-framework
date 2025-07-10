/* eslint-disable no-unused-vars */
/* eslint-env node */
/* global module, require, process */
/* eslint-env node */
const fs = require('fs');

// ===================================================================================
// Helper Functions
// ===================================================================================

/**
 * Calculates statistics for a given array of numbers.
 * @param {number[]} values - Array of numbers.
 * @returns {object} An object containing min, max, avg, med, p90, p95, and count.
 */
function calculateStats(values) {
  if (!values || values.length === 0) {
    return { min: 0, max: 0, avg: 0, med: 0, p90: 0, p95: 0, count: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const count = sorted.length;
  // For percentiles, ensure we don't go out of bounds on small arrays
  const p90Index = Math.floor(0.9 * (count - 1));
  const p95Index = Math.floor(0.95 * (count - 1));

  return {
    min: sorted[0],
    max: sorted[count - 1],
    avg: sum / count,
    med: count % 2 === 1 ? sorted[Math.floor(count / 2)] : (sorted[count / 2 - 1] + sorted[count / 2]) / 2,
    p90: sorted[p90Index],
    p95: sorted[p95Index],
    count
  };
}

/**
 * Formats a numeric value with a unit.
 * @param {number} value - The number to format.
 * @param {string} unit - The unit to append (e.g., 'ms').
 * @param {number} precision - The number of decimal places.
 * @returns {string} The formatted string (e.g., "123.45ms").
 */
function formatValue(value, unit = 'ms', precision = 2) {
  if (typeof value !== 'number' || isNaN(value)) return 'N/A';
  // Don't add unit suffix to the displayed values - units are shown in headers
  return `${value.toFixed(precision)}`;
}

// ===================================================================================
// Data Parsing Functions
// ===================================================================================

/**
 * Parses a k6 results file (JSON or JSONL) and extracts relevant browser metrics.
 * @param {string} filePath - The path to the k6 results file.
 * @returns {object} A structured object with all the processed test data.
 */
function parseDataFile(filePath) {
  console.log(`Parsing data from ${filePath}...`);
  // Add debug logging to trace actual data structure
  
  try {
    // Read file content
    if (!fs.existsSync(filePath)) {
      console.error(`[ERROR] Data file not found: ${filePath}`);
      return createEmptyStructure(); // Return empty structure - no synthetic data
    }
    
    const fileContent = fs.readFileSync(filePath, 'utf8').trim();
    if (!fileContent) {
      console.error('[ERROR] Data file is empty');
      return createEmptyStructure(); // Return empty structure - no synthetic data
    }
    
    // Remove BOM if present
    const cleanContent = fileContent.charCodeAt(0) === 0xFEFF ? fileContent.slice(1) : fileContent;
    
    // Check if it's actually HTML instead of JSON
    if (cleanContent.startsWith('<')) {
      console.error('[ERROR] Invalid data file: File appears to be HTML, not JSON');
      return createEmptyStructure(); // Return empty structure - no synthetic data
    }
    
    try {
      // Parse the JSON data
      const data = JSON.parse(cleanContent);
      
      if (!data) {
        console.error('[ERROR] Parsed data is null or undefined');
        return createEmptyStructure(); // Return empty structure - no synthetic data
      }
      
      // Handle different input formats
      if (data.root_group && data.metrics) {
        console.log('Processing as a full k6 JSON summary file');
        // This is the main k6 summary file
        return processRawSummaryFile(data);
      } else {
        // This is likely a pre-processed JSON file
        console.log('Using pre-processed JSON data');
        
        // Validate critical fields and provide clear warnings if missing
        if (!data.summary) console.warn('[WARNING] Missing summary data in processed file');
        if (!data.testInfo) console.warn('[WARNING] Missing testInfo data in processed file');
        if (!data.metrics) console.warn('[WARNING] Missing metrics data in processed file');
        if (!data.webVitals) console.warn('[WARNING] Missing webVitals data in processed file');
        
        return data;
      }
    } catch (parseError) {
      console.error(`[ERROR] Failed to parse JSON data: ${parseError.message}`);
      return createEmptyStructure(); // Return empty structure - no synthetic data
    }
  } catch (err) {
    console.error(`[ERROR] File reading error: ${err.message}`);
    return createEmptyStructure(); // Return empty structure - no synthetic data
  }
}

// Helper function to create an empty data structure without synthetic values
function createEmptyStructure() {
  console.warn('[WARNING] Creating empty data structure with N/A values - no synthetic data');
  return {
    summary: {},
    testInfo: {},
    metrics: {},
    webVitals: {},
    errors: [],
    transactions: {}
  };
}

/**
 * Processes a raw k6 JSON summary file.
 * @param {object} data - The raw k6 JSON summary file data.
 * @returns {object} A structured object with all the processed test data.
 */
function processRawSummaryFile(data) {
  const metrics = data.metrics;
  const result = {
    testInfo: { 
      testType: 'BROWSER', 
      aut: metrics?.browser_web_vital_lcp?.tags?.aut || 'k6-browser-test',
      scenario: metrics?.browser_web_vital_lcp?.tags?.scenario || 'default'
    },
    summary: {
      startTime: new Date(data.root_group.checks?.[0]?.last_check || Date.now()).toISOString(),
      endTime: new Date(Date.now()).toISOString(), // Approximate end time
      testRunDuration: `${(metrics?.vus_max?.values?.max || 0).toFixed(2)}s`,
      totalRequests: metrics?.http_reqs?.values?.count || 0,
      failedRequests: metrics?.http_req_failed?.values?.fails || 0,
      avgRps: metrics?.http_reqs?.values?.rate || 0,
      avgResponseTime: metrics?.http_req_duration?.values?.avg || 0
    },
    metrics: metrics,
    webVitals: { lcp: { values: [], byTransaction: {} }, ttfb: { values: [], byTransaction: {} } },
    transactions: {}, // Store transactions with raw data points
    errors: []
  };
  return result;
}

/**
 * Parses a k6 results file (JSON or JSONL) and extracts relevant browser metrics.
 * @param {string} filePath - The path to the k6 results file.
 * @returns {object} A structured object with all the processed test data.
 */
function parseDataFileOld(filePath) {
  console.log(`Parsing data from ${filePath}...`);
  let fileContent = fs.readFileSync(filePath, 'utf8').trim();
  if (fileContent.charCodeAt(0) === 0xFEFF) fileContent = fileContent.slice(1);

  if (fileContent.startsWith('<')) {
    throw new Error('Invalid data file: File appears to be HTML, not JSON or JSONL.');
  }

  try {
    // First, try to parse as a single, complete JSON object from k6's summary output
    const data = JSON.parse(fileContent);
    if (data.root_group && data.metrics) {
      console.log('Parsing as a full k6 JSON summary file.');
      const metrics = data.metrics;
      const result = {
        testInfo: { 
          testType: 'BROWSER', 
          aut: metrics?.browser_web_vital_lcp?.tags?.aut || 'k6-browser-test',
          scenario: metrics?.browser_web_vital_lcp?.tags?.scenario || 'default'
        },
        summary: {
          startTime: new Date(data.root_group.checks?.[0]?.last_check || Date.now()).toISOString(),
          endTime: new Date(Date.now()).toISOString(), // Approximate end time
          testRunDuration: `${(metrics?.vus_max?.values?.max || 0).toFixed(2)}s`,
          totalRequests: metrics?.http_reqs?.values?.count || 0,
          failedRequests: metrics?.http_req_failed?.values?.fails || 0,
          avgRps: metrics?.http_reqs?.values?.rate || 0,
          avgResponseTime: metrics?.http_req_duration?.values?.avg || 0
        },
        metrics: metrics,
        webVitals: { lcp: { values: [], byTransaction: {} }, ttfb: { values: [], byTransaction: {} } },
        transactions: {}, // Store transactions with raw data points
        errors: []
      };
      return result;
    }
    // If not a k6 summary, assume it's a pre-processed JSON from another tool
    return data; 
  } catch (e) {
    console.log('Not a single JSON object, attempting to parse as JSONL...');
    const lines = fileContent.split('\n').filter(line => line.trim() !== '');
    const data = {
      testInfo: { testType: 'BROWSER', aut: 'k6-browser-test', scenario: 'default' },
      summary: {
        startTime: null,
        endTime: null,
        totalRequests: 0,
        failedRequests: 0,
        avgRps: 0,
        avgResponseTime: 0
      },
      metrics: { vus: { value: 1 } },
      webVitals: { lcp: { values: [], byTransaction: {} }, ttfb: { values: [], byTransaction: {} } },
      transactions: {}, // Store transactions with raw data points
      errors: []
    };

    // For summary data
    const transactions = {};
    const allTimestamps = [];
    const allRequests = [];
    const failedRequests = [];
    const responseTimes = [];
    const vuValues = [];

    // For grouping per template
    const templateData = {};

    // Process each line of JSONL
    lines.forEach(line => {
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'Point' && entry.data && entry.data.time) {
          const timestamp = new Date(entry.data.time);
          allTimestamps.push(timestamp);
          
          // Get transaction name from tags
          let txName = entry.data.tags?.transaction;
          
          // Skip resource metrics (we only want page-level metrics)
          // Resource metrics have resource_type or initiatorType tags
          if (entry.data.tags?.resource_type || entry.data.tags?.initiatorType) {
            // This is a resource request, not a page-level metric
            return;
          }
          
          // If no transaction tag but it's a browser metric, try to extract template name from URL
          if (!txName && entry.metric?.startsWith('browser_') && entry.data.tags?.name) {
            const url = entry.data.tags.name;
            // Check for specific patterns in the URL that indicate template types
            if (url.includes('/taxonomy/')) {
              txName = 'taxonomyScTemplate';
            } else if (url.includes('/sc-commerce/')) {
              txName = 'listScCommerceTemplate';
            } else if (url.includes('/structured-content/')) {
              txName = 'structuredContentTemplate';
            } else if (url.includes('/sc/')) {
              txName = 'listScTemplate';
            } else if (url.includes('/exclusive/')) {
              txName = 'exclusiveTemplate';
            } else if (url.includes('/robots.txt')) {
              txName = 'robotsTemplate';
            } else if (url.includes('/hub/')) {
              txName = 'sweepstakesHubTemplate';
            } else if (url.match(/^https?:\/\/[^/]+\/?$/)) {
              txName = 'homeTemplate';
            }
            
            // If we identified a template from URL, initialize its tracking
            if (txName && !templateData[txName]) {
              templateData[txName] = {
                ttfb: [],
                lcp: [],
                requests: [],
                failed: 0
              };
            }
          }

          // Skip if we couldn't determine a transaction name
          if (!txName) {
            // Still track metrics for overall stats
            // Only include page-level metrics (no resource_type or initiatorType)
            if (!entry.data.tags?.resource_type && !entry.data.tags?.initiatorType && entry.metric === 'browser_http_req_duration') {
              responseTimes.push(entry.data.value);
              allRequests.push(entry.data);
              if (Number(entry.data.tags?.status) >= 400) {
                failedRequests.push(entry.data);
              }
            } else if (!entry.data.tags?.resource_type && !entry.data.tags?.initiatorType && entry.metric === 'browser_http_req_failed' && entry.data.value === 1) {
              failedRequests.push(entry.data);
            } else if (entry.metric === 'vus') {
              vuValues.push(entry.data.value);
            }
            return;
          }

          // Initialize tracking for this transaction if needed
          if (!transactions[txName]) {
            transactions[txName] = { 
              ttfb: [], 
              lcp: [], 
              requests: [], 
              failed: 0,
              // Store raw data points with timestamps for charts
              rawData: {
                ttfb: [],
                lcp: []
              }
            };
          }

          // Track metrics by transaction
          if (entry.metric === 'browser_ttfb') {
            // Store the value for statistics
            transactions[txName].ttfb.push(entry.data.value);
            data.webVitals.ttfb.values.push(entry.data.value);
            
            // Store the raw data point with timestamp for charts
            transactions[txName].rawData.ttfb.push({
              timestamp: timestamp,
              value: entry.data.value
            });
          } else if (entry.metric === 'browser_lcp') {
            // Store the value for statistics
            transactions[txName].lcp.push(entry.data.value);
            data.webVitals.lcp.values.push(entry.data.value);
            
            // Store the raw data point with timestamp for charts
            transactions[txName].rawData.lcp.push({
              timestamp: timestamp,
              value: entry.data.value
            });
          } else if (entry.metric === 'browser_http_req_duration') {
            // Only include page-level requests (no resource_type or initiatorType)
            if (!entry.data.tags?.resource_type && !entry.data.tags?.initiatorType) {
              transactions[txName].requests.push(entry.data);
              responseTimes.push(entry.data.value);
              allRequests.push(entry.data);
            }
          } else if (entry.metric === 'browser_http_req_failed' && entry.data.value === 1) {
            // Only include page-level failures (no resource_type or initiatorType)
            if (!entry.data.tags?.resource_type && !entry.data.tags?.initiatorType) {
              transactions[txName].failed++;
              failedRequests.push(entry.data);
            }
          } else if (entry.metric === 'vus') {
            vuValues.push(entry.data.value);
          }
        }
      } catch (lineError) { 
        console.warn('Error parsing line:', lineError.message);
      }
    });

    // Check if we have any real transaction data
    if (Object.keys(transactions).length === 0) {
      // STRICT RULE: Never use synthetic data - just log a clear warning
      console.warn('[WARNING] No transaction data found. Dashboard will only show available data with no synthetic values.');
    }

    if (allTimestamps.length > 0) {
      data.summary.startTime = new Date(Math.min(...allTimestamps));
      data.summary.endTime = new Date(Math.max(...allTimestamps));
      const durationMs = data.summary.endTime - data.summary.startTime;
      data.summary.testRunDuration = `${Math.round(durationMs / 1000)} sec`;
    }

    // Calculate the total transaction count from the table data
    // This ensures the summary metrics match what's shown in the table
    let totalCount = 0;

    // Count transactions from the transaction data
    Object.keys(transactions).forEach(txName => {
      // For each transaction, calculate stats if not already done
      if (transactions[txName].ttfb && transactions[txName].ttfb.length > 0) {
        if (!transactions[txName].stats) {
          transactions[txName].stats = calculateStats(transactions[txName].ttfb);
        }
        totalCount += transactions[txName].stats.count || 0;
      }
    });

    console.log(`Total transactions from table: ${totalCount}`);

    // Update summary metrics based on the transaction table data
    data.summary.totalRequests = totalCount;
    data.summary.failedRequests = failedRequests.length;

    // Calculate average response time from TTFB metrics
    let totalTtfb = 0;
    let ttfbCount = 0;

    Object.keys(transactions).forEach(txName => {
      if (transactions[txName].stats && transactions[txName].stats.avg) {
        totalTtfb += transactions[txName].stats.avg * (transactions[txName].stats.count || 0);
        ttfbCount += transactions[txName].stats.count || 0;
      }
    });

    data.summary.avgResponseTime = ttfbCount > 0 ? totalTtfb / ttfbCount : 0;

    // Calculate RPS based on transaction count
    if (data.summary.startTime && data.summary.endTime) {
      const testDurationSeconds = (data.summary.endTime - data.summary.startTime) / 1000;
      data.summary.avgRps = totalCount / testDurationSeconds;
    }

    // Store VU data for charts
    if (vuValues.length > 0) {
      data.metrics.vus = { value: Math.max(...vuValues) };
    }

    // Store the raw transaction data with timestamps for charts
    Object.keys(transactions).forEach(txName => {
      data.transactions[txName] = transactions[txName];
      
      // Process TTFB data
      if (transactions[txName].ttfb.length > 0) {
        if (!data.webVitals.ttfb.byTransaction[txName]) {
          data.webVitals.ttfb.byTransaction[txName] = { values: [], stats: null };
        }
        data.webVitals.ttfb.byTransaction[txName].values = transactions[txName].ttfb;
        data.webVitals.ttfb.byTransaction[txName].stats = calculateStats(transactions[txName].ttfb);
      }
      
      // Process LCP data
      if (transactions[txName].lcp.length > 0) {
        if (!data.webVitals.lcp.byTransaction[txName]) {
          data.webVitals.lcp.byTransaction[txName] = { values: [], stats: null };
        }
        data.webVitals.lcp.byTransaction[txName].values = transactions[txName].lcp;
        data.webVitals.lcp.byTransaction[txName].stats = calculateStats(transactions[txName].lcp);
      }
    });

    return data;
  }
}

// ===================================================================================
// HTML Generation Functions
// ===================================================================================

/**
 * Generates HTML for info cards at the top of the dashboard.
 * @param {object} summary - Summary data with test metrics.
 * @param {object} testInfo - Test metadata.
 * @returns {string} HTML for the info cards section.
 */
function generateInfoCards(summary = {}, testInfo = {}, webVitals = {}) {
  // Check for missing data and log warnings - never use synthetic data
  if (!testInfo || Object.keys(testInfo).length === 0) {
    console.warn('[WARNING] Test info data is missing or empty. Using N/A for missing values.');
  }
  if (!summary || Object.keys(summary).length === 0) {
    console.warn('[WARNING] Summary data is missing or empty. Using N/A for missing values.');
  }
  
  // Debug what data we actually received
  console.log('DEBUG INFO CARDS:');
  console.log(`TestInfo: ${JSON.stringify(testInfo)}`);
  console.log(`WebVitals keys: ${Object.keys(webVitals).join(', ')}`);
  console.log(`WebVitals.ttfb keys: ${webVitals.ttfb ? Object.keys(webVitals.ttfb).join(', ') : 'undefined'}`);
  if (webVitals.ttfb && webVitals.ttfb.byTransaction) {
    console.log(`TTFB byTransaction keys: ${Object.keys(webVitals.ttfb.byTransaction).join(', ')}`);
    // Show the actual data for the first transaction
    const firstTxName = Object.keys(webVitals.ttfb.byTransaction)[0];
    if (firstTxName) {
      console.log(`First TX data: ${JSON.stringify(webVitals.ttfb.byTransaction[firstTxName])}`);
    }
  }
  
  // For browser tests, count the page loads from web vitals data
  let pageLoadCount = 0;
  let failedLoadCount = 0;
  let totalResponseTime = 0;
  
  // Check if this is browser data by looking for web vitals directly
  // Don't rely on testInfo which might be empty
  const hasBrowserMetrics = webVitals && 
                          (webVitals.ttfb || webVitals.lcp) && 
                          ((webVitals.ttfb && webVitals.ttfb.byTransaction) || 
                           (webVitals.lcp && webVitals.lcp.byTransaction));
  
  if (hasBrowserMetrics) {
    // Count unique transaction templates that have TTFB/LCP metrics
    if (webVitals.ttfb.byTransaction) {
      Object.keys(webVitals.ttfb.byTransaction).forEach(txName => {
        const txStats = webVitals.ttfb.byTransaction[txName];
        if (txStats && typeof txStats.count === 'number') {
          pageLoadCount += txStats.count;
          totalResponseTime += txStats.avg * txStats.count;
        }
      });
      
      console.log(`Counted ${pageLoadCount} total page loads from TTFB data`);
    }
    
    // No failures for now - we could add this later with check data
  }
  
  // Calculate actual response time average from the web vitals data
  const actualAvgResponseTime = pageLoadCount > 0 ? totalResponseTime / pageLoadCount : undefined;
  
  // Always use BROWSER for browser dashboard - don't rely on potentially missing testInfo
  const testType = 'BROWSER';
  const duration = summary && summary.testRunDuration !== undefined ? summary.testRunDuration : 'N/A';
  
  // For browser tests: use the actual page load counts we've calculated
  // For API tests: use the existing summary data
  let totalRequests;
  let failedRequests;
  let avgRps;
  let avgResponseTime;
  
  // Log actual counts from web vitals before deciding which values to use
  console.log(`Actual page load count from web vitals: ${pageLoadCount}`);
  console.log(`Total response time from web vitals: ${totalResponseTime}`);
  
  // Use webVitals data directly to determine if we're processing browser metrics
  // Don't rely on potentially missing testInfo.testType
  if (hasBrowserMetrics) {
    // For browser tests, use the metrics we calculated from core web vitals
    totalRequests = pageLoadCount || 'N/A';
    failedRequests = failedLoadCount;
    avgRps = duration !== 'N/A' && pageLoadCount ? 
             (pageLoadCount / parseFloat(duration)).toFixed(2) : 
             'N/A';
    avgResponseTime = actualAvgResponseTime !== undefined ? 
                     formatValue(actualAvgResponseTime) : 
                     'N/A';
  } else {
    // For API tests, use the existing summary data
    totalRequests = summary && summary.totalRequests !== undefined ? 
                  summary.totalRequests : 
                  'N/A';
    failedRequests = summary && summary.failedRequests !== undefined ? 
                   summary.failedRequests : 
                   'N/A';
    avgRps = summary && summary.avgRps !== undefined ? 
            summary.avgRps.toFixed(2) : 
            'N/A';
    avgResponseTime = summary && summary.avgResponseTime !== undefined ? 
                    formatValue(summary.avgResponseTime) : 
                    'N/A';
  }
  
  return `
    <div class="info-cards">
      <div class="info-card">
        <div class="info-card-title">Test Type</div>
        <div class="info-card-value">${testType}</div>
      </div>
      <div class="info-card">
        <div class="info-card-title">Duration</div>
        <div class="info-card-value">${duration}</div>
      </div>
      <div class="info-card">
        <div class="info-card-title">Total Requests</div>
        <div class="info-card-value">${totalRequests}</div>
      </div>
      <div class="info-card">
        <div class="info-card-title">Failed Requests</div>
        <div class="info-card-value">${failedRequests}</div>
      </div>
      <div class="info-card">
        <div class="info-card-title">Avg RPS</div>
        <div class="info-card-value">${avgRps}</div>
      </div>
      <div class="info-card">
        <div class="info-card-title">Avg Response Time</div>
        <div class="info-card-value">${avgResponseTime}</div>
      </div>
    </div>
  `;
}

/**
 * Generates an SLA banner for a specific metric type.
 * @param {string} metricType - The type of metric (e.g., 'TTFB', 'LCP').
 * @returns {string} HTML for the SLA banner.
 */
function generateSLABanner(metricType) {
  // Simplified metric titles without descriptions per request
  let title, thresholds;
  
  if (metricType === 'TTLB') {
    title = 'Page Load Time';
    // LCP thresholds
    thresholds = [
      { label: 'AVG WARN', value: '2.5s', color: 'warning' },
      { label: 'DANGER', value: '4s', color: 'danger' },
      { label: 'MEDIAN WARN', value: '2.5s', color: 'warning' },
      { label: 'DANGER', value: '4s', color: 'danger' },
      { label: 'P90 WARN', value: '4s', color: 'warning' },
      { label: 'DANGER', value: '6s', color: 'danger' }
    ];
  } else if (metricType === 'TTFB') {
    title = 'Server Time';
    thresholds = [
      { label: 'AVG WARN', value: '300ms', color: 'warning' },
      { label: 'DANGER', value: '500ms', color: 'danger' },
      { label: 'MEDIAN WARN', value: '250ms', color: 'warning' },
      { label: 'DANGER', value: '400ms', color: 'danger' },
      { label: 'P90 WARN', value: '500ms', color: 'warning' },
      { label: 'DANGER', value: '800ms', color: 'danger' }
    ];
  } else if (metricType === 'LCP') {
    title = 'Page Load Time';
    thresholds = [
      { label: 'AVG WARN', value: '2.5s', color: 'warning' },
      { label: 'DANGER', value: '4s', color: 'danger' },
      { label: 'MEDIAN WARN', value: '2.5s', color: 'warning' },
      { label: 'DANGER', value: '4s', color: 'danger' },
      { label: 'P90 WARN', value: '4s', color: 'warning' },
      { label: 'DANGER', value: '6s', color: 'danger' }
    ];
  } else {
    return '';
  }
  
  // Create a single-line compact banner as shown in the reference image
  // Format matches the protocol report with colored badges and spacing
  let thresholdHtml = '';
  
  // Group thresholds by metric (avg, med, p90) for proper formatting
  const avgThresholds = thresholds.filter(t => t.label.includes('AVG'));
  const medThresholds = thresholds.filter(t => t.label.includes('MEDIAN'));
  const p90Thresholds = thresholds.filter(t => t.label.includes('P90'));
  
  // Format AVG thresholds
  if (avgThresholds.length > 0) {
    thresholdHtml += 'AVG ';
    avgThresholds.forEach(t => {
      thresholdHtml += `<span class="${t.color}-badge">${t.value}</span> `;
    });
  }
  
  // Format MEDIAN thresholds
  if (medThresholds.length > 0) {
    thresholdHtml += ' | MEDIAN ';
    medThresholds.forEach(t => {
      thresholdHtml += `<span class="${t.color}-badge">${t.value}</span> `;
    });
  }
  
  // Format P90 thresholds
  if (p90Thresholds.length > 0) {
    thresholdHtml += ' | P90 ';
    p90Thresholds.forEach(t => {
      thresholdHtml += `<span class="${t.color}-badge">${t.value}</span> `;
    });
  }
  
  return `
    <div class="sla-banner">
      <div class="sla-thresholds">${thresholdHtml}</div>
    </div>
  `;
}

/**
 * Generates an HTML table for web vital metrics by transaction.
 * @param {object} transactionData - Transaction data with metrics.
 * @param {string} metricType - Type of metric (TTFB, LCP).
 * @param {string} unit - Unit for the metric (default: ms).
 * @returns {string} HTML for the web vital table.
 */
function generateWebVitalTable(transactionData, metricType, unit = 'ms') {
  // Safely handle empty data - never use synthetic values
  if (!transactionData || Object.keys(transactionData).length === 0) {
    console.warn(`[WARNING] No ${metricType} data available for any transaction.`);
    return `<div class="alert alert-warning">No ${metricType} data available.</div>`;
  }
  
  // Log what we found for debugging
  console.log(`Found ${Object.keys(transactionData).length} transactions with ${metricType} data:`, Object.keys(transactionData).join(', '));

  let tableHtml = `
    <style>
      /* SLA Styling to match protocol dashboard */
      /* SLA banner badges */
      .warning-badge, .danger-badge { 
        padding: 2px 5px;
        border-radius: 3px;
        font-weight: 600;
        margin: 0 2px;
      }
      .warning-badge { background-color: #ffedd5; color: #c2410c; }
      .danger-badge { background-color: #fee2e2; color: #b91c1c; }
      
      /* Table cell styling */
      .success { color: #15803d; font-weight: 600; background-color: #dcfce780; padding: 2px 6px; border-radius: 3px; }
      .warning { color: #c2410c; font-weight: 600; background-color: #ffedd580; padding: 2px 6px; border-radius: 3px; }
      .danger { color: #b91c1c; font-weight: 600; background-color: #fee2e280; padding: 2px 6px; border-radius: 3px; }
    </style>
  `;

  // Determine SLA thresholds based on metric type
  /* Apply SLA thresholds based on metric type and value */
  const getSlaClass = (value, metricType, valueType = 'avg') => {
    // Match the protocol report thresholds
    if (metricType === 'TTFB') {
      // Server Time thresholds
      if (valueType === 'avg') {
        if (value < 300) return 'success';
        if (value < 500) return 'warning';
        return 'danger';
      } else if (valueType === 'med') {
        if (value < 250) return 'success';
        if (value < 400) return 'warning';
        return 'danger';
      } else if (valueType === 'p90') {
        if (value < 500) return 'success';
        if (value < 800) return 'warning';
        return 'danger';
      }
    } else if (metricType === 'LCP' || metricType === 'TTLB') {
      // Page Load Time thresholds
      if (valueType === 'avg') {
        if (value < 2500) return 'success';
        if (value < 4000) return 'warning';
        return 'danger';
      } else if (valueType === 'med') {
        if (value < 2500) return 'success';
        if (value < 4000) return 'warning';
        return 'danger';
      } else if (valueType === 'p90') {
        if (value < 4000) return 'success';
        if (value < 6000) return 'warning';
        return 'danger';
      }
    }
    return 'default'; // No special styling
  };

  // Format values with SLA badge - highlight them with color pills
  const formatWithSla = (value, metricType, valueType = 'avg') => {
    if (typeof value !== 'number' || isNaN(value)) return 'N/A';
    const slaClass = getSlaClass(value, metricType, valueType);
    return `<span class="${slaClass}">${formatValue(value, unit)}</span>`;
  };

  tableHtml += `
    <table class="web-vital-table">
      <thead>
        <tr>
          <th>Transaction</th>
          <th>Count</th>
          <th>Min (${unit})</th>
          <th>Avg (${unit})</th>
          <th>Med (${unit})</th>
          <th>p90 (${unit})</th>
          <th>p95 (${unit})</th>
          <th>p99 (${unit})</th>
          <th>Max (${unit})</th>
        </tr>
      </thead>
      <tbody>
  `;

  // Sort transactions by name
  const transactions = Object.keys(transactionData).sort().map(txName => {
    return [txName, transactionData[txName]];
  });

  // Track totals - initialize with safe defaults (never using synthetic values)
  let totalMin = Infinity;
  let totalMax = -Infinity;
  let totalSum = 0;
  let totalCount = 0;
  let allValues = [];

  // For each transaction, render its statistics
  transactions.forEach(([name, stats]) => {
    // Only display if valid data with count > 0
    if (stats && stats.count > 0) {
      // Update totals using actual measured values - never synthetic values
      if (typeof stats.min === 'number' && !isNaN(stats.min)) totalMin = Math.min(totalMin, stats.min);
      if (typeof stats.max === 'number' && !isNaN(stats.max)) totalMax = Math.max(totalMax, stats.max);
      if (typeof stats.avg === 'number' && !isNaN(stats.avg)) totalSum += stats.avg * stats.count;
      totalCount += stats.count;

      // Render the row with the actual statistics - with new column order to match reference image
      // Transaction, Count, Min, Avg, Med, p90, p95, p99, Max
      tableHtml += `
        <tr>
          <td>${name}</td>
          <td>${stats.count}</td>
          <td>${formatValue(stats.min, unit)}</td>
          <td>${formatWithSla(stats.avg, metricType, 'avg')}</td>
          <td>${formatWithSla(stats.med, metricType, 'med')}</td>
          <td>${formatWithSla(stats.p90, metricType, 'p90')}</td>
          <td>${formatValue(stats.p95, unit)}</td>
          <td>${formatValue(stats.p99, unit)}</td>
          <td>${formatValue(stats.max, unit)}</td>
        </tr>
      `;
      allValues = allValues.concat(stats.values || []);
    } else {
      console.warn(`[WARNING] No valid ${metricType} data for transaction: ${name}`);
    }
  });

  // Calculate overall stats
  if (totalCount > 0 && allValues.length > 0) {
    const overallStats = calculateStats(allValues);
    const overallAvg = totalSum / totalCount;
    
    tableHtml += `
      <tr class="table-active">
        <td><strong>OVERALL</strong></td>
        <td><strong>${totalCount}</strong></td>
        <td><strong>${formatValue(totalMin, unit)}</strong></td>
        <td><strong>${formatWithSla(overallAvg, metricType)}</strong></td>
        <td><strong>${formatValue(overallStats.med, unit)}</strong></td>
        <td><strong>${formatValue(overallStats.p90, unit)}</strong></td>
        <td><strong>${formatValue(overallStats.p95, unit)}</strong></td>
        <td><strong>${formatValue(overallStats.p99, unit)}</strong></td>
        <td><strong>${formatValue(totalMax, unit)}</strong></td>
      </tr>
    `;
  }

  tableHtml += `
      </tbody>
    </table>
  `;

  return tableHtml;
}

/**
 * Generates an HTML table for error data.
 * @param {array} errors - Array of error objects.
 * @returns {string} HTML for the error table.
 */
function generateErrorTable(errors) {
  if (!errors || errors.length === 0) {
    return '<div class="alert alert-success">No errors detected.</div>';
  }

  return `
    <table class="table table-striped table-hover">
      <thead>
        <tr>
          <th>Error</th>
          <th>Count</th>
          <th>Transactions</th>
        </tr>
      </thead>
      <tbody>
        ${errors.map(e => `
          <tr>
            <td>${e.message}</td>
            <td>${e.count}</td>
            <td>${e.transactions.join(', ')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

/**
 * Extracts chart data from raw data points.
 * @param {object} data - The processed data object with transactions containing raw data points.
 * @param {object} summary - Summary data with test metrics.
 * @returns {object} Structured chart data.
 */
function extractChartData(data, summary) {
  // Initialize chart data object with by-transaction data structure
  const chartData = { 
    responseTimeByTransaction: {},  // Store data per transaction
    responseTime: [],              // Overall average (for backwards compatibility)
    percentiles: { median: [], p90: [], p95: [], p99: [] },
    tps: [], 
    vus: [],
    labels: [],
    timestamps: [],
    transactionNames: []           // List of transaction names
  };
  
  // Debug: inspect data and summary structure
  console.log(`Data: ${JSON.stringify({
    hasData: !!data,
    hasTransactions: !!data?.transactions,
    hasSummary: !!summary,
    hasStartTime: !!summary?.startTime
  })}`);

  const startTime = summary?.startTime;
  if (!startTime || !data || !data.transactions) {
    console.warn('Missing required data for charts');
    return chartData;
  }

  // Get all transaction names from the raw data
  const transactions = Object.keys(data.transactions);
  if (transactions.length === 0) {
    console.warn('No transaction data available for charts');
    return chartData;
  }
  
  chartData.transactionNames = transactions;
  
  // Initialize responseTime series for each transaction
  transactions.forEach(txName => {
    chartData.responseTimeByTransaction[txName] = [];
  });

  // Calculate test duration from timestamps
  const testStartTime = new Date(startTime).getTime();
  const testEndTime = summary?.endTime ? new Date(summary.endTime).getTime() : testStartTime;
  const testDuration = (testEndTime - testStartTime) / 1000;

  if (testDuration <= 0) {
    console.warn('Invalid test duration (zero or negative)');
    return chartData;
  }

  // Calculate optimal interval size to get ~20 data points
  const intervalSeconds = Math.max(5, Math.ceil(testDuration / 20));
  console.log(`Test duration: ${testDuration}s, using ${intervalSeconds}s intervals`);

  // Get VU count from metrics
  const vuCount = summary?.vus || data?.metrics?.vus?.value || 1;
  
  // Create time buckets for the chart
  const numBuckets = Math.ceil(testDuration / intervalSeconds);
  const buckets = Array(numBuckets).fill().map(() => ({
    startTime: 0,
    endTime: 0,
    label: '',
    timestamp: '',
    transactions: {}
  }));
  
  // Initialize the time buckets
  for (let i = 0; i < numBuckets; i++) {
    const bucketStartTime = testStartTime + (i * intervalSeconds * 1000);
    const bucketEndTime = bucketStartTime + (intervalSeconds * 1000);
    
    // Format the timestamp for this interval (for x-axis)
    const relativeTimeSeconds = i * intervalSeconds;
    const minutes = Math.floor(relativeTimeSeconds / 60);
    const seconds = Math.floor(relativeTimeSeconds % 60);
    const timeLabel = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    
    buckets[i].startTime = bucketStartTime;
    buckets[i].endTime = bucketEndTime;
    buckets[i].label = timeLabel;
    buckets[i].timestamp = new Date(bucketStartTime).toISOString();
    buckets[i].transactions = {};
    
    // Initialize transaction data for this bucket
    transactions.forEach(txName => {
      buckets[i].transactions[txName] = {
        points: [],
        stats: null
      };
    });
  }
  
  // Place each raw data point into the appropriate time bucket
  transactions.forEach(txName => {
    const txData = data.transactions[txName];
    
    // Skip if no raw data available
    if (!txData || !txData.rawData || !txData.rawData.ttfb) {
      console.warn(`No raw TTFB data available for transaction: ${txName}`);
      return;
    }
    
    // Skip processing if the raw data is missing or empty
    if (!txData.rawData || !txData.rawData.ttfb || !Array.isArray(txData.rawData.ttfb) || txData.rawData.ttfb.length === 0) {
      console.warn(`No TTFB data points for transaction ${txName}`);
      return;
    }
    
    console.log(`Processing ${txData.rawData.ttfb.length} raw data points for ${txName}`);
    console.log(`Sample data point: ${JSON.stringify(txData.rawData.ttfb[0])}`);
    
    // Process each raw data point
    txData.rawData.ttfb.forEach(point => {
      // Get the timestamp - handle both .time and .timestamp formats
      let timestamp;
      if (point.timestamp) {
        // Old format with timestamp as Date object
        timestamp = point.timestamp instanceof Date ? 
                   point.timestamp.getTime() : 
                   new Date(point.timestamp).getTime();
      } else if (point.time) {
        // New format with time field
        timestamp = point.time instanceof Date ? 
                   point.time.getTime() : 
                   (typeof point.time === 'string' ? 
                   new Date(point.time).getTime() : 
                   point.time);
      } else {
        // No valid timestamp - skip this point
        console.warn(`Missing timestamp in data point: ${JSON.stringify(point)}`);
        return;
      }
      
      const value = point.value;
      
      // Find which bucket this point belongs to
      const bucketIndex = Math.floor((timestamp - testStartTime) / 1000 / intervalSeconds);
      
      // Only add if it's within the test duration
      if (bucketIndex >= 0 && bucketIndex < numBuckets) {
        buckets[bucketIndex].transactions[txName].points.push(value);
      }
    });
  });
  
  // Calculate statistics for each bucket and transaction
  buckets.forEach(bucket => {
    transactions.forEach(txName => {
      const points = bucket.transactions[txName].points;
      if (points.length > 0) {
        bucket.transactions[txName].stats = calculateStats(points);
      }
    });
  });
  
  // Generate the chart data from the buckets
  buckets.forEach(bucket => {
    // Add the x-axis label and timestamp
    chartData.labels.push(bucket.label);
    chartData.timestamps.push(bucket.timestamp);
    chartData.vus.push(vuCount);
    
    // Track metrics for overall calculations
    let totalPoints = 0;
    let overallAvg = 0;
    let overallMed = 0;
    let overallP90 = 0;
    let overallP95 = 0;
    let overallP99 = 0;
    let validTransactions = 0;
    
    // Process each transaction in this bucket
    transactions.forEach(txName => {
      const txBucket = bucket.transactions[txName];
      
      if (txBucket.stats) {
        // We have data points for this transaction in this bucket
        chartData.responseTimeByTransaction[txName].push(txBucket.stats.avg);
        
        // Contribute to overall metrics
        overallAvg += txBucket.stats.avg;
        overallMed += txBucket.stats.med;
        overallP90 += txBucket.stats.p90;
        overallP95 += txBucket.stats.p95;
        overallP99 += txBucket.stats.p99;
        validTransactions++;
        totalPoints += txBucket.points.length;
      } else {
        // No data for this transaction in this bucket
        chartData.responseTimeByTransaction[txName].push(null);
      }
    });
    
    // Calculate overall metrics for this bucket
    if (validTransactions > 0) {
      chartData.responseTime.push(overallAvg / validTransactions);
      chartData.percentiles.median.push(overallMed / validTransactions);
      chartData.percentiles.p90.push(overallP90 / validTransactions);
      chartData.percentiles.p95.push(overallP95 / validTransactions);
      chartData.percentiles.p99.push(overallP99 / validTransactions);
      chartData.tps.push(totalPoints / intervalSeconds);
    } else {
      chartData.responseTime.push(null);
      chartData.percentiles.median.push(null);
      chartData.percentiles.p90.push(null);
      chartData.percentiles.p95.push(null);
      chartData.percentiles.p99.push(null);
      chartData.tps.push(0);
    }
  });
  
  // Log information about the chart data
  console.log(`Generated chart data with ${chartData.labels.length} time points`);
  transactions.forEach(txName => {
    const points = chartData.responseTimeByTransaction[txName].filter(p => p !== null).length;
    console.log(`Transaction ${txName}: ${points} data points in chart`);
  });
  
  return chartData;
}

/**
 * Generates Chart.js code for browser metrics.
 * @param {object} chartData - The processed chart data.
 * @param {object} metrics - Additional metrics for the chart.
 * @returns {string} JavaScript code for Chart.js.
 */
function generateChartJsForBrowser(chartData, metrics) {
  if (!chartData || !chartData.labels || chartData.labels.length === 0) {
    console.warn('No chart data available');
    return '';
  }

  const colorPalette = [
    '#3b82f6', // blue
    '#ef4444', // red
    '#10b981', // green
    '#f59e0b', // amber
    '#8b5cf6', // purple
    '#ec4899', // pink
    '#06b6d4', // cyan
    '#f97316', // orange
    '#14b8a6', // teal
    '#a855f7', // violet
    '#6366f1', // indigo
    '#84cc16', // lime
    '#0ea5e9', // sky
    '#d946ef', // fuchsia
    '#22c55e', // emerald
    '#eab308', // yellow
  ];

  // Generate datasets for each transaction
  const datasets = [];
  const transactionNames = chartData.transactionNames || [];

  // Add a dataset for each transaction
  transactionNames.forEach((txName, index) => {
    const color = colorPalette[index % colorPalette.length];
    datasets.push({
      label: txName,
      data: chartData.responseTimeByTransaction[txName],
      borderColor: color,
      backgroundColor: color + '20', // 20 = 12.5% opacity
      borderWidth: 2,
      pointRadius: 3,
      pointHoverRadius: 5,
      fill: true,
      tension: 0.1
    });
  });

  // Generate the Chart.js code - without script tags since they're already in the template
  return `
    // SLA color definitions for charts
    const slaColors = {
      success: 'rgba(34, 197, 94, 0.2)', // green with 20% opacity
      warning: 'rgba(249, 115, 22, 0.2)', // orange with 20% opacity
      danger: 'rgba(239, 68, 68, 0.2)', // red with 20% opacity
      successBorder: 'rgb(34, 197, 94)',
      warningBorder: 'rgb(249, 115, 22)',
      dangerBorder: 'rgb(239, 68, 68)'
    };

    // Response Time Chart with gradient backgrounds
    const ctxResponseTime = document.getElementById('responseTimeChart').getContext('2d');
    window.charts.responseTimeChart = new Chart(ctxResponseTime, {
      type: 'line',
      data: {
        labels: ${JSON.stringify(chartData.labels)},
        datasets: ${JSON.stringify(datasets)}
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: true,
            text: 'Transaction Response Time Over Time (ms)',
            font: { size: 16 }
          },
          tooltip: {
            mode: 'index',
            intersect: false
          },
          legend: {
            position: 'top',
            labels: { usePointStyle: true }
          },
          zoom: {
            pan: { enabled: true, mode: 'x' },
            zoom: {
              wheel: { enabled: true },
              pinch: { enabled: true },
              mode: 'x',
            }
          }
        },
        scales: {
          x: {
            type: 'category',
            title: {
              display: true,
              text: 'Time Elapsed'
            }
          },
          y: {
            title: {
              display: true,
              text: 'Response Time (ms)'
            },
            beginAtZero: true
          }
        }
      }
    });
    
    // Percentiles Chart
    const ctxPercentiles = document.getElementById('percentilesChart').getContext('2d');
    window.charts.percentilesChart = new Chart(ctxPercentiles, {
      type: 'line',
      data: {
        labels: ${JSON.stringify(chartData.labels)},
        datasets: [
          {
            label: 'p90',
            data: ${JSON.stringify(chartData.percentiles.p90)},
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            borderWidth: 2,
            pointRadius: 2,
            pointHoverRadius: 4,
            fill: true,
            tension: 0.2
          },
          {
            label: 'p95',
            data: ${JSON.stringify(chartData.percentiles.p95)},
            borderColor: '#f97316',
            backgroundColor: function(context) {
              const chart = context.chart;
              const {ctx, chartArea} = chart;
              if (!chartArea) return 'rgba(249, 115, 22, 0.1)';
              return createGradient(ctx, chartArea, [
                {offset: 0, color: 'rgba(249, 115, 22, 0.2)'},
                {offset: 1, color: 'rgba(249, 115, 22, 0)'},
              ]);
            },
            borderWidth: 2,
            pointRadius: 2,
            pointHoverRadius: 4,
            fill: true,
            tension: 0.2
          },
          {
            label: 'p99',
            data: ${JSON.stringify(chartData.percentiles.p99)},
            borderColor: '#8b5cf6',
            backgroundColor: function(context) {
              const chart = context.chart;
              const {ctx, chartArea} = chart;
              if (!chartArea) return 'rgba(139, 92, 246, 0.1)';
              return createGradient(ctx, chartArea, [
                {offset: 0, color: 'rgba(139, 92, 246, 0.2)'},
                {offset: 1, color: 'rgba(139, 92, 246, 0)'}
              ]);
            },
            borderWidth: 2,
            pointRadius: 2,
            pointHoverRadius: 4,
            fill: true,
            tension: 0.2
          },
          {
            label: 'Median',
            data: ${JSON.stringify(chartData.percentiles.median)},
            borderColor: '#10b981',
            backgroundColor: function(context) {
              const chart = context.chart;
              const {ctx, chartArea} = chart;
              if (!chartArea) return 'rgba(16, 185, 129, 0.1)';
              return createGradient(ctx, chartArea, [
                {offset: 0, color: 'rgba(16, 185, 129, 0.2)'},
                {offset: 1, color: 'rgba(16, 185, 129, 0)'}
              ]);
            },
            borderWidth: 2,
            pointRadius: 2,
            pointHoverRadius: 4,
            fill: true,
            tension: 0.2
          },
          {
            label: 'Average',
            data: ${JSON.stringify(chartData.responseTime)},
            borderColor: '#3b82f6',
            backgroundColor: function(context) {
              const chart = context.chart;
              const {ctx, chartArea} = chart;
              if (!chartArea) return 'rgba(59, 130, 246, 0.1)';
              return createGradient(ctx, chartArea, [
                {offset: 0, color: 'rgba(59, 130, 246, 0.2)'},
                {offset: 1, color: 'rgba(59, 130, 246, 0)'},
              ]);
            },
            borderWidth: 2,
            pointRadius: 2,
            pointHoverRadius: 4,
            fill: true,
            tension: 0.2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: true,
            text: 'Response Time Percentiles Over Time (ms)',
            font: { size: 16 }
          },
          tooltip: {
            mode: 'index',
            intersect: false
          },
          legend: {
            position: 'top',
            labels: { usePointStyle: true }
          },
          zoom: {
            pan: { enabled: true, mode: 'x' },
            zoom: {
              wheel: { enabled: true },
              pinch: { enabled: true },
              mode: 'x',
            }
          }
        },
        scales: {
          x: {
            type: 'category',
            title: {
              display: true,
              text: 'Time Elapsed'
            }
          },
          y: {
            title: {
              display: true,
              text: 'Response Time (ms)'
            },
            beginAtZero: true
          }
        }
      }
    });

    // TPS Chart
    const ctxRps = document.getElementById('rpsChart').getContext('2d');
    window.charts.rpsChart = new Chart(ctxRps, {
      type: 'line',
      data: {
        labels: ${JSON.stringify(chartData.labels)},
        datasets: [{
          label: 'Transactions Per Second',
          data: ${JSON.stringify(chartData.tps)},
          borderColor: '#10b981',
          backgroundColor: function(context) {
            const chart = context.chart;
            const {ctx, chartArea} = chart;
            if (!chartArea) return 'rgba(16, 185, 129, 0.1)';
            return createGradient(ctx, chartArea, [
              {offset: 0, color: 'rgba(16, 185, 129, 0.2)'},
              {offset: 1, color: 'rgba(16, 185, 129, 0)'},
            ]);
          },
          borderWidth: 2,
          pointRadius: 2,
          pointHoverRadius: 4,
          fill: true,
          tension: 0.2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: true,
            text: 'Transactions Per Second (TPS)',
            font: { size: 16 }
          },
          tooltip: {
            mode: 'index',
            intersect: false
          },
          legend: {
            display: false
          },
          zoom: {
            pan: { enabled: true, mode: 'x' },
            zoom: {
              wheel: { enabled: true },
              pinch: { enabled: true },
              mode: 'x',
            }
          }
        },
        scales: {
          x: {
            type: 'category',
            title: {
              display: true,
              text: 'Time Elapsed'
            }
          },
          y: {
            title: {
              display: true,
              text: 'TPS'
            },
            beginAtZero: true
          }
        }
      }
    });

    // VU Chart
    const ctxVu = document.getElementById('vuChart').getContext('2d');
    window.charts.vuChart = new Chart(ctxVu, {
      type: 'line',
      data: {
        labels: ${JSON.stringify(chartData.labels)},
        datasets: [{
          label: 'Virtual Users',
          data: ${JSON.stringify(chartData.vus)},
          borderColor: '#6366f1',
          backgroundColor: function(context) {
            const chart = context.chart;
            const {ctx, chartArea} = chart;
            if (!chartArea) return 'rgba(99, 102, 241, 0.1)';
            return createGradient(ctx, chartArea, [
              {offset: 0, color: 'rgba(99, 102, 241, 0.2)'},
              {offset: 1, color: 'rgba(99, 102, 241, 0)'},
            ]);
          },
          borderWidth: 2,
          pointRadius: 2,
          pointHoverRadius: 4,
          fill: true,
          tension: 0.2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: true,
            text: 'Virtual Users',
            font: { size: 16 }
          },
          tooltip: {
            mode: 'index',
            intersect: false
          },
          legend: {
            display: false
          },
          zoom: {
            pan: { enabled: true, mode: 'x' },
            zoom: {
              wheel: { enabled: true },
              pinch: { enabled: true },
              mode: 'x',
            }
          }
        },
        scales: {
          x: {
            type: 'category',
            title: {
              display: true,
              text: 'Time Elapsed'
            }
          },
          y: {
            title: {
              display: true,
              text: 'VUs'
            },
            beginAtZero: true
          }
        }
      }
    });

    // Response Time vs TPS Chart
    const ctxResponseTimeTps = document.getElementById('responseTimeTpsChart').getContext('2d');
    window.charts.responseTimeTpsChart = new Chart(ctxResponseTimeTps, {
      type: 'line',
      data: {
        labels: ${JSON.stringify(chartData.labels)},
        datasets: [
          {
            label: 'Response Time (ms)',
            data: ${JSON.stringify(chartData.responseTime)},
            borderColor: '#3b82f6',
            backgroundColor: function(context) {
              const chart = context.chart;
              const {ctx, chartArea} = chart;
              if (!chartArea) {
                return;
              }
              const gradient = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
              gradient.addColorStop(0, 'rgba(59, 130, 246, 0.0)');
              gradient.addColorStop(1, 'rgba(59, 130, 246, 0.2)');
              return gradient;
            },
            borderWidth: 2,
            pointRadius: 2,
            pointHoverRadius: 4,
            yAxisID: 'y',
            tension: 0.2,
            fill: true
          },
          {
            label: 'TPS',
            data: ${JSON.stringify(chartData.tps)},
            borderColor: '#10b981',
            backgroundColor: function(context) {
              const chart = context.chart;
              const {ctx, chartArea} = chart;
              if (!chartArea) {
                return;
              }
              const gradient = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
              gradient.addColorStop(0, 'rgba(16, 185, 129, 0.0)');
              gradient.addColorStop(1, 'rgba(16, 185, 129, 0.2)');
              return gradient;
            },
            borderWidth: 2,
            pointRadius: 2,
            pointHoverRadius: 4,
            yAxisID: 'y1',
            tension: 0.2,
            fill: true
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          title: {
            display: true,
            text: 'Response Time vs TPS',
            font: { size: 16 }
          },
          tooltip: {
            mode: 'index',
            intersect: false
          },
          zoom: {
            pan: { enabled: true, mode: 'x' },
            zoom: {
              wheel: { enabled: true },
              pinch: { enabled: true },
              mode: 'x',
            }
          }
        },
        scales: {
          x: {
            type: 'category',
            title: {
              display: true,
              text: 'Time Elapsed'
            }
          },
          y: {
            type: 'linear',
            display: true,
            position: 'left',
            title: {
              display: true,
              text: 'Response Time (ms)'
            },
            beginAtZero: true
          },
          y1: {
            type: 'linear',
            display: true,
            position: 'right',
            title: {
              display: true,
              text: 'TPS'
            },
            beginAtZero: true,
            grid: {
              drawOnChartArea: false
            }
          }
        }
      }
    });

    // The template already has onclick handlers for the reset zoom buttons
    // that call the resetZoomChart function defined in the template.
    // We don't need to add additional event listeners here.
    // The template's resetZoomChart function will use our window.charts object.
  `;
}

/**
 * Generates a browser performance dashboard HTML file with actual metrics data.
 * @param {string} processedDataPath - Path to the processed JSON data.
 * @param {string} templatePath - Path to the HTML template.
 * @param {string} outputPath - Path to save the output HTML file.
 */
function generateBrowserPerformanceDashboard(processedDataPath, templatePath, outputPath) {
  try {
    // Load the template
    console.log(`Using protocol dashboard template for consistent styling: ${templatePath}`);
    const template = fs.readFileSync(templatePath, 'utf8');
    
    // Parse the data file
    const data = parseDataFile(processedDataPath);
    const { testInfo, summary, metrics, webVitals = {}, errors = [] } = data;
    
    // Log warnings for missing data - never use synthetic values
    if (!webVitals || Object.keys(webVitals).length === 0) {
      console.warn('[WARNING] Web vitals data is missing. Using N/A for missing metrics - no synthetic data.');
    }
    
    // Generate HTML components with safe access to potentially missing data
    // Pass webVitals to the info cards generator to count the actual page loads
    const infoCardsHtml = generateInfoCards(summary, testInfo, webVitals);
    const ttfbBannerHtml = generateSLABanner('TTFB');
    const ttlbBannerHtml = generateSLABanner('TTLB');
    const lcpBannerHtml = generateSLABanner('LCP');
    
    // Safe access to web vitals data - never use synthetic values
    const ttfbByTransaction = (webVitals && webVitals.ttfb && webVitals.ttfb.byTransaction) || {};
    const lcpByTransaction = (webVitals && webVitals.lcp && webVitals.lcp.byTransaction) || {};
    
    const ttfbTableHtml = generateWebVitalTable(ttfbByTransaction, 'TTFB');
    const lcpTableHtml = generateWebVitalTable(lcpByTransaction, 'LCP', 'ms');
    const errorTableHtml = generateErrorTable(errors);
    
    // Pass the transactions with raw data points to the chart generation
    // Use safe object access to handle potentially missing data - never use synthetic values
    const transactions = data.transactions || {};
    if (Object.keys(transactions).length === 0) {
      console.warn('[WARNING] No transaction data available. Charts will show N/A - no synthetic data.');
    }
    
    const chartData = extractChartData({
      transactions: transactions
    }, data.summary);
    const chartJsCode = generateChartJsForBrowser(chartData, metrics);

    // Replace placeholders with content
    let dashboardHtml = template
      .replace(/\{\{TITLE\}\}/g, `K6 Performance Dashboard: ${testInfo?.aut || 'k6-browser-test'} ${testInfo?.scenario || 'default'}`)
      .replace(/\{\{INFO_CARDS\}\}/g, infoCardsHtml)
      .replace(/\{\{SLA_THRESHOLDS_TTLB\}\}/g, lcpBannerHtml) // LCP replaces TTLB in the template
      .replace(/\{\{SLA_THRESHOLDS_TTFB\}\}/g, ttfbBannerHtml)
      .replace(/\{\{TTLB_TABLE\}\}/g, lcpTableHtml) // LCP table goes in TTLB_TABLE placeholder
      .replace(/\{\{TTFB_TABLE\}\}/g, ttfbTableHtml)
      .replace(/\{\{ERROR_TABLE\}\}/g, errorTableHtml);
    dashboardHtml = dashboardHtml.replace('{{CHART_JS}}', chartJsCode);
    dashboardHtml = dashboardHtml.replace('{{TIMESTAMP}}', new Date().toISOString());
    
    // Write the output file
    fs.writeFileSync(outputPath, dashboardHtml);
    console.log(`Browser performance dashboard successfully generated: ${outputPath}`);
  } catch (error) {
    console.error(`Error generating dashboard: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

// Execute if this script is run directly
if (require.main === module) {
  if (process.argv.length < 5) {
    console.error('Usage: node browser-performance-dashboard.js <processed-json-path> <template-path> <output-path>');
    process.exit(1);
  }
  
  const processedDataPath = process.argv[2];
  const templatePath = process.argv[3];
  const outputPath = process.argv[4];
  
  generateBrowserPerformanceDashboard(processedDataPath, templatePath, outputPath);
}

// Export the function for use in other modules
module.exports = { generateBrowserPerformanceDashboard };

