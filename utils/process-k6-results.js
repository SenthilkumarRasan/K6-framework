const fs = require('fs');

const inputFile = 'results/results.json';

function processK6Output() {
  console.log(`Processing k6 output from ${inputFile}`);

  try {
    const fileContent = fs.readFileSync(inputFile, 'utf8');
    const lines = fileContent.split('\n').filter(line => line.trim());

    const templates = new Set();
    const templateData = {
      lcp: {},
      fcp: {},
      cls: {},
      ttfb_browser: {},
      page_load: {},
      browser_page_load_success: {}
    };

    let totalMetricsProcessed = 0;
    let browserMetricsFound = 0;

    // Detect test type (BROWSER or API)
    let testType = 'API';
    for (const line of lines) {
      if (line.includes('browser_page_load_time') || line.includes('browser_lcp')) {
        testType = 'BROWSER';
        break;
      }
    }

    lines.forEach((line) => {
      try {
        const dataPoint = JSON.parse(line);
        totalMetricsProcessed++;

        let metricType = null;
        if (dataPoint.metric === 'browser_lcp') {
          metricType = 'lcp';
          browserMetricsFound++;
        } else if (dataPoint.metric === 'browser_fcp') {
          metricType = 'fcp';
          browserMetricsFound++;
        } else if (dataPoint.metric === 'browser_cls') {
          metricType = 'cls';
          browserMetricsFound++;
        } else if (dataPoint.metric === 'browser_ttfb') {
          metricType = 'ttfb_browser';
          browserMetricsFound++;
        } else if (dataPoint.metric === 'browser_page_load_time') {
          metricType = 'page_load';
          browserMetricsFound++;
        } else if (dataPoint.metric === 'browser_page_load_success') {
          metricType = 'browser_page_load_success';
          browserMetricsFound++;
        }

        if (
          dataPoint.type === 'Point' &&
          metricType &&
          ['lcp', 'fcp', 'cls', 'ttfb_browser', 'page_load', 'browser_page_load_success'].includes(metricType)
        ) {
          const value = typeof dataPoint.value === 'number'
            ? dataPoint.value
            : (dataPoint.data && typeof dataPoint.data.value === 'number' ? dataPoint.data.value : undefined);
          if (typeof value !== 'number') return;

          let template = null;
          if (dataPoint.tags && dataPoint.tags.template) {
            template = dataPoint.tags.template;
          } else if (dataPoint.data && dataPoint.data.tags && dataPoint.data.tags.template) {
            template = dataPoint.data.tags.template;
          }
          if (!template || template === '') {
            template = 'unknown_template';
          }
          templates.add(template);

          if (!templateData[metricType][template]) {
            if (metricType === 'browser_page_load_success') {
              templateData[metricType][template] = { values: [], count: 0 };
            } else {
              templateData[metricType][template] = { durations: [], count: 0 };
            }
          }
          if (metricType === 'browser_page_load_success') {
            templateData[metricType][template].values.push(value);
            templateData[metricType][template].count++;
          } else {
            templateData[metricType][template].durations.push(value);
            templateData[metricType][template].count++;
          }
        }
      } catch (err) {
        // Skip invalid JSON lines
      }
    });

    console.log(`Processed ${totalMetricsProcessed} data points (${browserMetricsFound} browser metrics)`);

    // Helper/statistics
    function calculateStats(data) {
      const stats = {};
      for (const [key, metricsData] of Object.entries(data)) {
        const durations = metricsData.durations || [];
        if (durations.length === 0) continue;
        durations.sort((a, b) => a - b);
        const count = metricsData.count || 0;
        const safeNumber = num => (typeof num === 'number' && !isNaN(num)) ? num : 0;
        const safeFixed = (num, places) => safeNumber(num).toFixed(places);
        stats[key] = {
          requests: count,
          min: safeFixed(durations[0], 2),
          max: safeFixed(durations[durations.length - 1], 2),
          avg: safeFixed(durations.reduce((sum, val) => sum + val, 0) / durations.length, 2),
          median: safeFixed(calculatePercentile(durations, 0.5), 2),
          p90: safeFixed(calculatePercentile(durations, 0.9), 2),
          p95: safeFixed(calculatePercentile(durations, 0.95), 2),
          p99: safeFixed(calculatePercentile(durations, 0.99), 2)
        };
      }
      return stats;
    }

    // Calculate statistics
    const templateLcpStats = calculateStats(templateData.lcp);
    const templateFcpStats = calculateStats(templateData.fcp);
    const templateClsStats = calculateStats(templateData.cls);
    const templateTtfbBrowserStats = calculateStats(templateData.ttfb_browser);
    const templatePageLoadStats = calculateStats(templateData.page_load);

    // Enhanced reporting: include Requests, Passes, Fails, Failure % in all tables
    function printMetricTable(title, stats, metricName, passFailData) {
      console.log(`\n=== ${title} - ${metricName} ===\n`);
      console.log('| Name                | Requests | Passes   | Fails    | Failure % | Min (ms) | Max (ms) | Avg (ms) | Median (ms) | p90 (ms) | p95 (ms) | p99 (ms) |');
      console.log('|---------------------|----------|----------|----------|-----------|----------|----------|----------|-------------|----------|----------|----------|');
      for (const [key, stat] of Object.entries(stats)) {
        const passFail = passFailData[key] || { count: 0, values: [] };
        const total = passFail.count;
        const passes = passFail.values ? passFail.values.reduce((a, b) => a + b, 0) : 0;
        const fails = total - passes;
        const failurePct = total > 0 ? (fails / total * 100).toFixed(2) + '%' : '0.00%';
        console.log(
          `| ${key.padEnd(20)} | ${total.toString().padEnd(8)} | ${passes.toString().padEnd(8)} | ${fails.toString().padEnd(8)} | ${failurePct.padEnd(9)} | ${stat.min.padEnd(8)} | ${stat.max.padEnd(8)} | ${stat.avg.padEnd(8)} | ${stat.median.padEnd(11)} | ${stat.p90.padEnd(8)} | ${stat.p95.padEnd(8)} | ${stat.p99.padEnd(8)} |`
        );
      }
    }

    // Browser test reporting
    if (testType === 'BROWSER') {
      const passFailData = templateData['browser_page_load_success'];
      printMetricTable('Per-Template', templateLcpStats, 'LCP (Largest Contentful Paint)', passFailData);
      printMetricTable('Per-Template', templateFcpStats, 'FCP (First Contentful Paint)', passFailData);
      printMetricTable('Per-Template', templateClsStats, 'CLS (Cumulative Layout Shift)', passFailData);
      printMetricTable('Per-Template', templateTtfbBrowserStats, 'TTFB Browser (Time To First Byte)', passFailData);
      printMetricTable('Per-Template', templatePageLoadStats, 'Page Load Time', passFailData);

      // Page load success/failure summary
      if (Object.keys(passFailData).length > 0) {
        console.log('\n=== Per-Template - Page Load Pass/Fail ===\n');
        console.log('| Name                | Requests | Passes   | Fails    | Error Rate |');
        console.log('|---------------------|----------|----------|----------|------------|');
        for (const [template, data] of Object.entries(passFailData)) {
          const total = data.count;
          const passes = data.values.reduce((a, b) => a + b, 0);
          const fails = total - passes;
          const errorRate = total > 0 ? (fails / total * 100).toFixed(2) + '%' : '0.00%';
          console.log(`| ${template.padEnd(20)} | ${total.toString().padEnd(8)} | ${passes.toString().padEnd(8)} | ${fails.toString().padEnd(8)} | ${errorRate.padEnd(10)} |`);
        }
      }
    }

    // Legend
    console.log("\nLegend:");
    console.log("- LCP: Largest Contentful Paint (browser_lcp)");
    console.log("- FCP: First Contentful Paint (browser_fcp)");
    console.log("- CLS: Cumulative Layout Shift (browser_cls)");
    console.log("- TTFB Browser: Time To First Byte from browser (browser_ttfb)");
    console.log("- Page Load Time: Page load time (browser_page_load_time)");
    console.log("- Page Load Pass/Fail: Pass/fail rate from browser_page_load_success");
  } catch (error) {
    console.error(`Error processing the input file: ${error}`);
  }
}

// Helper function to calculate percentiles
function calculatePercentile(sortedValues, percentile) {
  if (!sortedValues || sortedValues.length === 0) return 0;
  const index = Math.ceil(sortedValues.length * percentile) - 1;
  return sortedValues[Math.max(0, Math.min(sortedValues.length - 1, index))];
}

// Run the processing
processK6Output();