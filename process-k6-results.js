const fs = require('fs');

const inputFile = 'results/results.json';

// Helper function to safely get template name from tags
function getTemplateName(tags) {
  if (tags && tags.template) {
    return tags.template;
  }
  if (tags && tags.name && tags.name.includes('Template')) { // Fallback for some cases
    return tags.name;
  }
  return 'ALL'; // Default if no template tag found
}

function processK6Output() {
  console.log(`Processing k6 output from ${inputFile}`);

  // Determine test type (e.g., from environment variable)
  const testType = (process.env.K6_REPORT_TEST_TYPE || 'BROWSER').toUpperCase();
  console.log(`Detected Test Type: ${testType}`);

  try {
    const fileContent = fs.readFileSync(inputFile, 'utf8');
    const lines = fileContent.split('\n').filter(line => line.trim());

    const templates = new Set();
    let templateData = {}; // Initialize as empty object

    if (testType === 'BROWSER') {
      console.log('Initializing data structures for BROWSER test type...');
      templateData = {
        lcp: {},
        fcp: {},
        cls: {},
        ttfb_browser: {}, // This is browser_web_vital_ttfb
        page_load_time: {}, // This is likely your custom browser_page_load_time
        browser_page_load_success: {} // For pass/fail rate
      };
    } else if (testType === 'PROTOCOL' || testType === 'API') {
      console.log(`Initializing data structures for ${testType} test type...`);
      templateData = {
        protocol_ttfb: {}, // From http_req_waiting
        protocol_ttlb: {}, // From http_req_duration
        protocol_req_success_rate: {} // Based on checks or http_req_failed
      };
    } else {
      console.error(`Unknown test type: ${testType}. Defaulting to BROWSER metrics structure.`);
      // Default or error handling
      templateData = { lcp: {}, fcp: {}, /* ... browser defaults ... */ };
    }

    let totalMetricsProcessed = 0;
    // browserMetricsFound might not be relevant for protocol tests, or renamed
    let relevantMetricsFound = 0; 

    // Placeholder for where the main processing loop begins
    console.log('Starting to process metric lines...');

    lines.forEach(line => {
      try {
        const metric = JSON.parse(line);
        totalMetricsProcessed++;

        if (metric.type === 'Point' && metric.data && metric.data.tags) {
          const templateName = getTemplateName(metric.data.tags);
          templates.add(templateName);

          if (testType === 'BROWSER') {
            relevantMetricsFound++; // Or a more specific counter
            // --- Current BROWSER metric processing ---
            if (metric.metric === 'browser_lcp' && templateData.lcp) { 
              if (!templateData.lcp[templateName]) templateData.lcp[templateName] = [];
              templateData.lcp[templateName].push(metric.data.value);
            } else if (metric.metric === 'browser_fcp' && templateData.fcp) { 
              if (!templateData.fcp[templateName]) templateData.fcp[templateName] = [];
              templateData.fcp[templateName].push(metric.data.value);
            } else if (metric.metric === 'browser_cls' && templateData.cls) { 
              if (!templateData.cls[templateName]) templateData.cls[templateName] = [];
              templateData.cls[templateName].push(metric.data.value);
            } else if (metric.metric === 'browser_ttfb' && templateData.ttfb_browser) { 
              if (!templateData.ttfb_browser[templateName]) templateData.ttfb_browser[templateName] = [];
              templateData.ttfb_browser[templateName].push(metric.data.value);
            } else if (metric.metric === 'browser_page_load_time' && templateData.page_load_time) { // Assuming this is your custom Trend metric
              if (!templateData.page_load_time[templateName]) templateData.page_load_time[templateName] = [];
              templateData.page_load_time[templateName].push(metric.data.value);
            } else if (metric.metric === 'browser_page_load_success' && templateData.browser_page_load_success) { // Assuming this is your Rate/Counter
                if (!templateData.browser_page_load_success[templateName]) {
                    templateData.browser_page_load_success[templateName] = { requests: 0, passes: 0, fails: 0 };
                }
                templateData.browser_page_load_success[templateName].requests++;
                if (metric.data.value === 1) {
                    templateData.browser_page_load_success[templateName].passes++;
                } else {
                    templateData.browser_page_load_success[templateName].fails++;
                }
            }
          } else if (testType === 'PROTOCOL' || testType === 'API') {
            relevantMetricsFound++; // Or a more specific counter
            // --- PROTOCOL/API metric processing (inspired by your copy) ---
            if (metric.metric === 'http_req_waiting' && templateData.protocol_ttfb) {
              if (!templateData.protocol_ttfb[templateName]) templateData.protocol_ttfb[templateName] = [];
              templateData.protocol_ttfb[templateName].push(metric.data.value);
            } else if (metric.metric === 'http_req_duration' && templateData.protocol_ttlb) {
              if (!templateData.protocol_ttlb[templateName]) templateData.protocol_ttlb[templateName] = [];
              templateData.protocol_ttlb[templateName].push(metric.data.value);
            } else if (metric.metric === 'checks' && templateData.protocol_req_success_rate) {
              // This part is tricky, assuming one main check per request that determines pass/fail for the request itself.
              // This might need adjustment based on your actual check structure in protocol tests.
              // The http_req_failed logic below is generally more reliable for overall request success.
              if (!templateData.protocol_req_success_rate[templateName]) {
                templateData.protocol_req_success_rate[templateName] = { requests: 0, passes: 0, fails: 0 };
              }
              // Incrementing requests here based on checks might lead to overcounting if multiple checks per URL.
              // It's better to count total requests from http_req_duration entries (done later).
              // This specific block for 'checks' might only be for very specific check-based success rates.
              // For now, let's assume it's one critical check per request.
              // templateData.protocol_req_success_rate[templateName].requests++; 
              if (metric.data.value === 1) { 
                // templateData.protocol_req_success_rate[templateName].passes++;
              } else { 
                // templateData.protocol_req_success_rate[templateName].fails++;
              }
            }
          }
        } else if (metric.type === 'Point' && metric.metric === 'http_req_failed' && (testType === 'PROTOCOL' || testType === 'API')) {
            const templateName = getTemplateName(metric.data.tags);
            templates.add(templateName);
            if (!templateData.protocol_req_success_rate[templateName]) {
                templateData.protocol_req_success_rate[templateName] = { requests: 0, passes: 0, fails: 0 };
            }
            if (metric.data.value === 1) { // if http_req_failed is 1, it's a failure
                templateData.protocol_req_success_rate[templateName].fails = (templateData.protocol_req_success_rate[templateName].fails || 0) + 1;
            }
        }
      } catch (e) {
        // console.error(`Skipping invalid JSON line: ${line}`, e);
      }
    });

    console.log(`Processed ${totalMetricsProcessed} lines from results file.`);
    console.log(`Found ${relevantMetricsFound} relevant metric points for test type ${testType}.`);
    console.log('Templates found:', Array.from(templates));

    // --- Adjusting total request counts for protocol_req_success_rate ---
    if (testType === 'PROTOCOL' || testType === 'API') {
        Object.keys(templateData.protocol_ttlb || {}).forEach(templateName => {
            if (!templateData.protocol_req_success_rate[templateName] && (templateData.protocol_ttlb[templateName] && templateData.protocol_ttlb[templateName].length > 0)) {
                 templateData.protocol_req_success_rate[templateName] = { requests: 0, passes: 0, fails: 0 };
            }
            if (templateData.protocol_req_success_rate[templateName]) {
                const totalRequests = (templateData.protocol_ttlb[templateName] || []).length;
                templateData.protocol_req_success_rate[templateName].requests = totalRequests;
                templateData.protocol_req_success_rate[templateName].passes = totalRequests - (templateData.protocol_req_success_rate[templateName].fails || 0);
            } 
        });
         // Ensure all templates found in protocol_ttfb also have a success_rate entry
        Object.keys(templateData.protocol_ttfb || {}).forEach(templateName => {
            if (!templateData.protocol_req_success_rate[templateName]) {
                const totalRequests = (templateData.protocol_ttfb[templateName] || []).length;
                if (totalRequests > 0) {
                    templateData.protocol_req_success_rate[templateName] = { requests: totalRequests, passes: totalRequests, fails: 0 };
                }
            }
        });
    }


    // --- Call table generation functions ---
    if (testType === 'BROWSER') {
      generateBrowserReport(templateData, templates);
    } else if (testType === 'PROTOCOL' || testType === 'API') {
      generateProtocolOrApiReport(templateData, templates, testType);
    }

  } catch (error) {
    console.error('Error processing k6 output:', error);
  }
}

// TODO: User needs to integrate their existing browser report generation logic here.
function generateBrowserReport(data, templates) {
  console.log('\n=== Per-Template - LCP (Largest Contentful Paint) ===\n');
  printTable('LCP (ms)', data.lcp, templates, calculateStats);
  console.log('\n=== Per-Template - FCP (First Contentful Paint) ===\n');
  printTable('FCP (ms)', data.fcp, templates, calculateStats);
  console.log('\n=== Per-Template - CLS (Cumulative Layout Shift) ===\n');
  printTable('CLS', data.cls, templates, calculateStats); // CLS is unitless
  console.log('\n=== Per-Template - TTFB Browser (Time To First Byte) ===\n');
  printTable('TTFB Browser (ms)', data.ttfb_browser, templates, calculateStats);
  console.log('\n=== Per-Template - Page Load Time ===\n');
  printTable('Page Load Time (ms)', data.page_load_time, templates, calculateStats);
  console.log('\n=== Per-Template - Page Load Pass/Fail ===\n');
  printPassFailTable(data.browser_page_load_success, templates);
  console.log('\nLegend:\n- LCP: Largest Contentful Paint (browser_lcp)\n- FCP: First Contentful Paint (browser_fcp)\n- CLS: Cumulative Layout Shift (browser_cls)\n- TTFB Browser: Time To First Byte from browser (browser_ttfb)\n- Page Load Time: Page load time (browser_page_load_time)\n- Page Load Pass/Fail: Pass/fail rate from browser_page_load_success');
}

// New function for Protocol/API reports
// TODO: User needs to ensure printTable and printPassFailTable are correctly defined and used.
function generateProtocolOrApiReport(data, templates, testType) {
  console.log(`\n=== Per-Template - ${testType} TTFB (http_req_waiting) ===\n`);
  printTable('TTFB (ms)', data.protocol_ttfb, templates, calculateStats);
  console.log(`\n=== Per-Template - ${testType} TTLB (http_req_duration) ===\n`);
  printTable('TTLB (ms)', data.protocol_ttlb, templates, calculateStats);
  console.log(`\n=== Per-Template - ${testType} Request Pass/Fail ===\n`);
  printPassFailTable(data.protocol_req_success_rate, templates);

  console.log(`\nLegend:\n- ${testType} TTFB: Time to First Byte (http_req_waiting)\n- ${testType} TTLB: Time to Last Byte (http_req_duration)\n- ${testType} Request Pass/Fail: Success rate for HTTP requests`);
}

// --- Utility functions (ensure calculateStats, printTable, printPassFailTable exist or are defined) ---
function calculateStats(values) {
  if (!values || values.length === 0) return { min: 0, max: 0, avg: 0, median: 0, p90: 0, p95: 0, p99: 0, requests: 0 };
  values.sort((a, b) => a - b);
  const sum = values.reduce((acc, val) => acc + val, 0);
  const avg = sum / values.length;
  return {
    min: values[0],
    max: values[values.length - 1],
    avg: avg,
    median: calculatePercentile(values, 0.50),
    p90: calculatePercentile(values, 0.90),
    p95: calculatePercentile(values, 0.95),
    p99: calculatePercentile(values, 0.99),
    requests: values.length
  };
}

function printTable(metricNameDisplay, metricData, templates, statCalculator) {
  console.log(`| Name                | Requests | Min (${metricNameDisplay.includes('CLS') ? '' : 'ms'}) | Max (${metricNameDisplay.includes('CLS') ? '' : 'ms'}) | Avg (${metricNameDisplay.includes('CLS') ? '' : 'ms'}) | Median (${metricNameDisplay.includes('CLS') ? '' : 'ms'}) | p90 (${metricNameDisplay.includes('CLS') ? '' : 'ms'}) | p95 (${metricNameDisplay.includes('CLS') ? '' : 'ms'}) | p99 (${metricNameDisplay.includes('CLS') ? '' : 'ms'}) |`);
  console.log(`|---------------------|----------|----------|----------|----------|-------------|----------|----------|----------|`);

  const sortedTemplates = Array.from(templates).sort();
  sortedTemplates.forEach(template => {
    const values = metricData[template] || [];
    const stats = statCalculator(values);
    if (stats.requests > 0) {
      const unitSuffix = metricNameDisplay.includes('CLS') ? '' : ''; // CLS is unitless
      console.log(
        `| ${template.padEnd(19)} | ${String(stats.requests).padEnd(8)} | ` +
        `${stats.min.toFixed(metricNameDisplay.includes('CLS') ? 2 : 2)}${unitSuffix.padEnd(8 - stats.min.toFixed(metricNameDisplay.includes('CLS') ? 2 : 2).length)} | ` +
        `${stats.max.toFixed(metricNameDisplay.includes('CLS') ? 2 : 2)}${unitSuffix.padEnd(8 - stats.max.toFixed(metricNameDisplay.includes('CLS') ? 2 : 2).length)} | ` +
        `${stats.avg.toFixed(metricNameDisplay.includes('CLS') ? 2 : 2)}${unitSuffix.padEnd(8 - stats.avg.toFixed(metricNameDisplay.includes('CLS') ? 2 : 2).length)} | ` +
        `${stats.median.toFixed(metricNameDisplay.includes('CLS') ? 2 : 2)}${unitSuffix.padEnd(11 - stats.median.toFixed(metricNameDisplay.includes('CLS') ? 2 : 2).length)} | ` +
        `${stats.p90.toFixed(metricNameDisplay.includes('CLS') ? 2 : 2)}${unitSuffix.padEnd(8 - stats.p90.toFixed(metricNameDisplay.includes('CLS') ? 2 : 2).length)} | ` +
        `${stats.p95.toFixed(metricNameDisplay.includes('CLS') ? 2 : 2)}${unitSuffix.padEnd(8 - stats.p95.toFixed(metricNameDisplay.includes('CLS') ? 2 : 2).length)} | ` +
        `${stats.p99.toFixed(metricNameDisplay.includes('CLS') ? 2 : 2)}${unitSuffix.padEnd(8 - stats.p99.toFixed(metricNameDisplay.includes('CLS') ? 2 : 2).length)} |`
      );
    }
  });
}

function printPassFailTable(metricData, templates) {
    console.log(`| Name                | Requests | Passes   | Fails    | Error Rate |`);
    console.log(`|---------------------|----------|----------|----------|------------|`);
    const sortedTemplates = Array.from(templates).sort();
    sortedTemplates.forEach(template => {
        const data = metricData[template] || { requests: 0, passes: 0, fails: 0 };
        if (data.requests > 0) {
            const errorRate = data.requests > 0 ? (data.fails / data.requests * 100).toFixed(2) + '%' : '0.00%';
            console.log(
                `| ${template.padEnd(19)} | ${String(data.requests).padEnd(8)} | ` +
                `${String(data.passes).padEnd(8)} | ${String(data.fails).padEnd(8)} | ` +
                `${errorRate.padEnd(10)} |`
            );
        }
    });
}

function calculatePercentile(sortedValues, percentile) {
  if (!sortedValues || sortedValues.length === 0) return 0;
  const p = Math.max(0, Math.min(1, percentile));
  const index = Math.ceil(sortedValues.length * p) - 1;
  return sortedValues[Math.max(0, Math.min(sortedValues.length - 1, index))];
}

processK6Output();