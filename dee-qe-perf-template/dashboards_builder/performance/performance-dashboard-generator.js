/**
 * Performance Dashboard Generator for k6
 *
 * This module generates interactive dashboard HTML reports from processed k6 data.
 * It provides rich visualizations for response times, percentiles, and error data.
 */

import fs from 'fs';

// Main function to generate the performance dashboard
function generatePerformanceDashboard(processedDataPath, templatePath, outputPath) {
  console.log('Generating performance dashboard...');
  try {
    const processedData = JSON.parse(fs.readFileSync(processedDataPath, 'utf8'));
    const templateHtml = fs.readFileSync(templatePath, 'utf8');

    // Get testInfo from the correct location in the processed data
    // It's nested under summary.testInfo in the processed data
    const summary = processedData.summary || {};
    const testInfo = summary.testInfo || {};
    const chartData = processedData.detailedData ? processedData.detailedData.chartData : {};
    const errors = processedData.errors || [];

    const title = `K6 Performance Dashboard: ${testInfo.aut || 'Unknown App'} - ${testInfo.scenario || 'custom-tps'}`;
    const infoCardsHtml = generateInfoCards(summary, testInfo, chartData);
    const ttlbTableHtml = generateMetricTable(chartData.responseTimeByTx || {}, 'TTLB');
    const ttfbTableHtml = generateMetricTable(chartData.ttfbByTx || {}, 'TTFB');
    const errorTableHtml = generateErrorTable(errors);
    const chartJsCode = generateChartJs(chartData);

    let finalHtml = templateHtml
      .replace(/{{TITLE}}/g, title)
      .replace('{{INFO_CARDS}}', infoCardsHtml)
      .replace('{{TTLB_TABLE}}', ttlbTableHtml)
      .replace('{{TTFB_TABLE}}', ttfbTableHtml)
      .replace('{{SLA_THRESHOLDS_TTLB}}', generateSlaThresholdsHtml('TTLB'))
      .replace('{{SLA_THRESHOLDS_TTFB}}', generateSlaThresholdsHtml('TTFB'))
      .replace('{{ERROR_TABLE}}', errorTableHtml)
      .replace('{{CHART_JS}}', chartJsCode)
      .replace('{{TIMESTAMP}}', new Date().toLocaleString());

    fs.writeFileSync(outputPath, finalHtml);
    console.log(`Performance dashboard successfully generated: ${outputPath}`);
  } catch (error) {
    console.error('Error generating dashboard:', error);
    process.exit(1);
  }
}

// Helper functions (InfoCards, Stats, Formatting)
function generateInfoCards(summary, testInfo, chartData) {
  // Ensure we use the correct test type - force uppercase for consistency
  const testType = (testInfo.testType || 'API').toUpperCase();
  
  // Log the test type for debugging
  console.log(`Test type from processed data: ${testInfo.testType || 'Not found'}, Using: ${testType}`);
  
  // Format duration in minutes and seconds
  let durationDisplay = 'N/A';
  if (summary.testRunDuration !== undefined) {
    const totalSeconds = summary.testRunDuration;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    durationDisplay = `${minutes}m ${seconds}s`;
  }
  
  // Calculate metrics only for HTML transactions (excluding _nonhtml)
  let htmlTotalRequests = 0;
  let htmlTotalFailed = 0;
  let htmlTotalResponseTime = 0;
  let htmlTotalDataPoints = 0;
  
  // Get the response time data for HTML transactions only
  const responseTimeByTx = chartData.responseTimeByTx || {};
  Object.entries(responseTimeByTx).forEach(([txName, dataPoints]) => {
    if (!txName.endsWith('_nonhtml') && txName !== 'unknown') {
      // Count valid data points
      const validPoints = dataPoints.filter(p => p.value !== undefined && p.value !== null);
      htmlTotalDataPoints += validPoints.length;
      
      // Sum up response times
      htmlTotalResponseTime += validPoints.reduce((sum, p) => sum + p.value, 0);
      
      // Count requests
      htmlTotalRequests += validPoints.length;
    }
  });
  
  // Calculate average response time for HTML transactions only
  const htmlAvgResponseTime = htmlTotalDataPoints > 0 ? 
    (htmlTotalResponseTime / htmlTotalDataPoints).toFixed(2) + 'ms' : 'N/A';
  
  // Calculate RPS for HTML transactions
  let htmlAvgRps = 'N/A';
  if (htmlTotalRequests > 0 && summary.testRunDuration > 0) {
    htmlAvgRps = (htmlTotalRequests / summary.testRunDuration).toFixed(2);
  }
  
  // Calculate failed requests for HTML transactions
  const htmlFailedRequests = htmlTotalFailed > 0 ? htmlTotalFailed : 0;
  
  // Log the HTML-only metrics for verification
  console.log(`HTML-only metrics: ${htmlTotalRequests} requests, ${htmlFailedRequests} failed, ${htmlAvgRps} RPS, ${htmlAvgResponseTime} avg response time`);
  
  // Use the HTML-only metrics instead of the summary metrics that include non-HTML transactions
  return `
    <div class="info-card">
        <div class="info-label">Test Type</div>
        <div class="info-value">${testType}</div>
    </div>
    <div class="info-card">
        <div class="info-label">Duration</div>
        <div class="info-value">${durationDisplay}</div>
    </div>
    <div class="info-card">
        <div class="info-label">Total Requests</div>
        <div class="info-value">${htmlTotalRequests}</div>
    </div>
    <div class="info-card" style="border-left-color: ${htmlFailedRequests > 0 ? 'var(--danger-color)' : 'var(--primary-color)'}">
        <div class="info-label">Failed Requests</div>
        <div class="info-value ${htmlFailedRequests > 0 ? 'text-danger' : ''}">${htmlFailedRequests}</div>
    </div>
    <div class="info-card">
        <div class="info-label">Avg RPS</div>
        <div class="info-value">${htmlAvgRps}</div>
    </div>
    <div class="info-card">
        <div class="info-label">Avg Response Time</div>
        <div class="info-value">${htmlAvgResponseTime}</div>
    </div>
  `;
}

function calculateStats(values) {
  if (!values || values.length === 0) {
    return { min: null, max: null, avg: null, med: null, p90: null, p95: null, p99: null };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const getPercentile = (arr, p) => arr[Math.max(0, Math.ceil((p / 100) * arr.length) - 1)];
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: sorted.reduce((sum, val) => sum + val, 0) / sorted.length,
    med: getPercentile(sorted, 50),
    p90: getPercentile(sorted, 90),
    p95: getPercentile(sorted, 95),
    p99: getPercentile(sorted, 99),
  };
}

function formatValue(value) {
  if (value === null || value === undefined || isNaN(value)) {
    return 'N/A';
  }
  return value.toFixed(2);
}

function getSLABadge(value, metricType, statType) {
  if (value === null || value === undefined || isNaN(value)) {
    return formatValue(value);
  }
  const thresholds = {
    TTLB: { avg: { warn: 300, danger: 500 }, med: { warn: 250, danger: 400 }, p90: { warn: 500, danger: 800 } },
    TTFB: { avg: { warn: 150, danger: 250 }, med: { warn: 200, danger: 350 }, p90: { warn: 450, danger: 750 } },
  };
  const threshold = thresholds[metricType]?.[statType];
  if (!threshold) return formatValue(value);

  let badgeClass = 'badge-success';
  if (value >= threshold.danger) badgeClass = 'badge-danger';
  else if (value >= threshold.warn) badgeClass = 'badge-warning';
  
  return `<span class="badge ${badgeClass}">${formatValue(value)}</span>`;
}

function generateMetricTable(metricsData, metricType) {
  if (!metricsData || Object.keys(metricsData).length === 0) {
    return `<p>No ${metricType} data available.</p>`;
  }
  
  // Filter out 'unknown' and any transaction ending with '_nonhtml'
  const txNames = Object.keys(metricsData)
    .filter(name => name !== 'unknown' && !name.endsWith('_nonhtml'))
    .sort();
    
  // Log the filtered transaction names for debugging
  console.log(`Filtered ${metricType} transactions:`, txNames.join(', '));
  const rows = txNames.map(txName => {
    const dataPoints = (metricsData[txName] || []).map(p => p.value).filter(v => v !== undefined && v !== null);
    const stats = calculateStats(dataPoints);
    return `<tr>
      <td>${txName}</td>
      <td class="text-center">${dataPoints.length}</td>
      <td class="text-center">${formatValue(stats.min)}</td>
      <td class="text-center">${getSLABadge(stats.avg, metricType, 'avg')}</td>
      <td class="text-center">${getSLABadge(stats.med, metricType, 'med')}</td>
      <td class="text-center">${getSLABadge(stats.p90, metricType, 'p90')}</td>
      <td class="text-center">${formatValue(stats.p95)}</td>
      <td class="text-center">${formatValue(stats.p99)}</td>
      <td class="text-center">${formatValue(stats.max)}</td>
    </tr>`;
  }).join('');

  return `<table>
    <thead>
      <tr>
        <th>Transaction</th>
        <th class="text-center">Count</th>
        <th class="text-center">Min (ms)</th>
        <th class="text-center">Avg (ms)</th>
        <th class="text-center">Med (ms)</th>
        <th class="text-center">p90 (ms)</th>
        <th class="text-center">p95 (ms)</th>
        <th class="text-center">p99 (ms)</th>
        <th class="text-center">Max (ms)</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function generateErrorTable(errors) {
  const errorItems = Array.isArray(errors) ? errors : (errors && Array.isArray(errors.errors)) ? errors.errors : [];
  if (errorItems.length === 0) {
    return '<p>No errors detected in this test run.</p>';
  }
  const rows = errorItems.map(err => `
    <tr>
      <td>${err.status || 'N/A'}</td>
      <td>${err.transaction || 'Unknown'}</td>
      <td class="text-center">${err.count || 0}</td>
      <td>${err.error || 'Unknown error'}</td>
      <td>${err.exampleUrl || 'N/A'}</td>
    </tr>
  `).join('');
  return `<table>
    <thead>
      <tr>
        <th>Status</th>
        <th>Transaction</th>
        <th class="text-center">Count</th>
        <th>Error</th>
        <th>Example URL</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function generateSlaThresholdsHtml(metricType) {
  const thresholds = {
    TTLB: { avg: { warn: 300, danger: 500 }, med: { warn: 250, danger: 400 }, p90: { warn: 500, danger: 800 } },
    TTFB: { avg: { warn: 250, danger: 400 }, med: { warn: 350, danger: 500 }, p90: { warn: 750, danger: 900 } },
  };
  const metricThresholds = thresholds[metricType];
  if (!metricThresholds) return '';

  const statOrder = ['avg', 'med', 'p90'];
  const labels = { avg: 'AVG', med: 'MEDIAN', p90: 'P90' };

  const segments = statOrder.map(key => {
    const warn = metricThresholds[key].warn;
    const danger = metricThresholds[key].danger;
    return `${labels[key]} <span class="warn">WARN: ${warn}ms</span> <span class="danger">DANGER: ${danger}ms</span>`;
  }).join(' &nbsp; | &nbsp; ');

  return `<div class="sla-thresholds">${segments}</div>`;
}

function generateChartJs(chartData) {
  const responseTimeByTx = chartData.responseTimeByTx || {};
  const allTimestamps = Object.values(responseTimeByTx).flat().map(p => new Date(p.time).getTime());
  const testStartTime = allTimestamps.length > 0 ? Math.min(...allTimestamps) : 0;
  
  const normalizeTimestamp = (timestamp) => (new Date(timestamp).getTime() - testStartTime);

  const processPoints = (points) => {
    if (!points) return [];
    return points.map(p => ({ x: normalizeTimestamp(p.time), y: p.value }));
  };

  // Filter out 'unknown' and any transaction ending with '_nonhtml'
  const txNames = Object.keys(responseTimeByTx)
    .filter(name => name !== 'unknown' && !name.endsWith('_nonhtml'))
    .sort();
  
  console.log('Filtered chart transactions:', txNames.join(', '));
  
  const chartColors = ['#4f46e5', '#22c55e', '#f97316', '#8b5cf6', '#94a3b8', '#ef4444', '#eab308', '#06b6d4'];
  const getTransactionColor = (index) => chartColors[index % chartColors.length];

  const responseTimeDatasets = txNames.map((txName, index) => {
    const txColor = getTransactionColor(index);
    const data = processPoints(responseTimeByTx[txName]);
    return {
      label: txName,
      data: data,
      borderColor: txColor,
      backgroundColor: `GRADIENT_PLACEHOLDER_${txColor}`,
      borderWidth: 2, pointRadius: 0, tension: 0.4, fill: true
    };
  });

  const rpsData = processPoints(chartData.requestsPerSecond);
  const vuData = processPoints(chartData.activeVUs);

  // Calculate percentile data - filter out _nonhtml transactions
  const allResponseTimes = Object.entries(responseTimeByTx)
    .filter(([txName]) => !txName.endsWith('_nonhtml') && txName !== 'unknown')
    .flatMap(([, points]) => points.map(p => ({ time: normalizeTimestamp(p.time), value: p.value })));
  
  console.log(`Total response time data points after filtering: ${allResponseTimes.length}`);
  
  const bucketSize = 1000; // 1 second buckets
  const buckets = {};
  allResponseTimes.forEach(point => {
    const bucketKey = Math.floor(point.time / bucketSize) * bucketSize;
    if (!buckets[bucketKey]) buckets[bucketKey] = [];
    buckets[bucketKey].push(point.value);
  });
  
  const p50Data = [];
  const p90Data = [];
  const p95Data = [];
  const p99Data = [];
  
  Object.entries(buckets).forEach(([timeKey, values]) => {
    const time = parseInt(timeKey, 10);
    if (values.length > 0) {
      const sorted = [...values].sort((a, b) => a - b);
      const getPercentile = (arr, p) => arr[Math.max(0, Math.ceil((p / 100) * arr.length) - 1)];
      
      p50Data.push({ x: time, y: getPercentile(sorted, 50) });
      p90Data.push({ x: time, y: getPercentile(sorted, 90) });
      p95Data.push({ x: time, y: getPercentile(sorted, 95) });
      p99Data.push({ x: time, y: getPercentile(sorted, 99) });
    }
  });
  
  // Create time-series data for combined Response Time and TPS chart
  const combinedTimeData = [];
  
  // Process all response times by timestamp
  const rtByTime = {};
  const tpsByTime = {};
  
  // Get response times organized by timestamp
  for (const txName in responseTimeByTx) {
    const points = responseTimeByTx[txName];
    points.forEach(point => {
      const normalizedTime = normalizeTimestamp(point.time);
      const second = Math.floor(normalizedTime / 1000) * 1000;
      
      if (!rtByTime[second]) {
        rtByTime[second] = {
          sum: 0,
          count: 0
        };
      }
      
      rtByTime[second].sum += point.value;
      rtByTime[second].count++;
    });
  }
  
  // Get TPS data organized by timestamp
  if (chartData.requestsPerSecond) {
    chartData.requestsPerSecond.forEach(point => {
      const normalizedTime = normalizeTimestamp(point.time);
      const second = Math.floor(normalizedTime / 1000) * 1000;
      tpsByTime[second] = point.value;
    });
  }
  
  // Combine the data for the chart
  const timePoints = new Set([...Object.keys(rtByTime), ...Object.keys(tpsByTime)]);
  timePoints.forEach(timeKey => {
    const time = parseInt(timeKey, 10);
    const rt = rtByTime[timeKey] ? rtByTime[timeKey].sum / rtByTime[timeKey].count : null;
    const tps = tpsByTime[timeKey] !== undefined ? tpsByTime[timeKey] : null;
    
    if (rt !== null || tps !== null) {
      combinedTimeData.push({
        x: time,
        responseTime: rt,
        tps: tps
      });
    }
  });
  
  // Sort by time
  combinedTimeData.sort((a, b) => a.x - b.x);

  const clientData = {
    responseTimeDatasets,
    p50Data,
    p90Data,
    p95Data,
    p99Data,
    rpsData,
    vuData,
    combinedTimeData // Combined time-series data for Response Time vs TPS chart
  };

  return `
    Chart.register(ChartDataLabels, ChartZoom);

    const clientData = ${JSON.stringify(clientData)};
    const testStartTime = ${testStartTime}; // Make test start time available for absolute time formatting

    // Define the formatTime function for consistent time formatting across all charts
    function formatTime(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return minutes.toString().padStart(2, '0') + ':' + remainingSeconds.toString().padStart(2, '0');
    }

    const timeScaleOptions = {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        plugins: {
            tooltip: {
                callbacks: {
                    title: function(context) { return 'At ' + formatTime(context[0].parsed.x) + ' of test'; }
                }
            },
            legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } },
            zoom: { pan: { enabled: true, mode: 'x' }, zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' } },
            datalabels: { display: false }
        },
        scales: {
            x: {
                type: 'linear',
                title: { display: true, text: 'Test Duration (MM:SS)' },
                ticks: { 
                    callback: function(value) { 
                        // Ensure proper time formatting for all charts
                        return formatTime(value);
                    }
                },
                grid: { color: 'rgba(0, 0, 0, 0.05)' }
            },
            y: { 
                title: { display: true, text: 'Response Time (ms)' },
                grid: { color: 'rgba(0, 0, 0, 0.05)' }
            }
        }
    };

    // Response Time Chart
    if (document.getElementById('responseTimeChart')) {
      clientData.responseTimeDatasets.forEach(ds => {
        const color = ds.borderColor;
        ds.backgroundColor = (context) => {
            const chart = context.chart;
            const { ctx, chartArea } = chart;
            if (!chartArea) return null;
            const gradient = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
            gradient.addColorStop(0, color + '22');
            gradient.addColorStop(1, color + '66');
            return gradient;
        };
      });
      new Chart(document.getElementById('responseTimeChart').getContext('2d'), {
        type: 'line',
        data: { datasets: clientData.responseTimeDatasets },
        options: timeScaleOptions
      });
    }
    
    // Percentiles Chart
    if (document.getElementById('percentilesChart')) {
      new Chart(document.getElementById('percentilesChart').getContext('2d'), {
        type: 'line',
        data: {
          datasets: [
            { label: 'p50 (Median)', data: clientData.p50Data, borderColor: '#22c55e', backgroundColor: '#22c55e44', borderWidth: 2, pointRadius: 0, fill: true },
            { label: 'p90', data: clientData.p90Data, borderColor: '#a855f7', backgroundColor: '#a855f744', borderWidth: 2, pointRadius: 0, fill: true },
            { label: 'p95', data: clientData.p95Data, borderColor: '#f97316', backgroundColor: '#f9731644', borderWidth: 2, pointRadius: 0, fill: true },
            { label: 'p99', data: clientData.p99Data, borderColor: '#ef4444', backgroundColor: '#ef444444', borderWidth: 2, pointRadius: 0, fill: true }
          ]
        },
        options: timeScaleOptions
      });
    }
    
    // Response Time vs TPS Chart with dual Y-axes
    if (document.getElementById('responseTimeTpsChart')) {
      const ctx = document.getElementById('responseTimeTpsChart').getContext('2d');
      
      // Clear any previous chart elements
      if (window.rtVsTpsChart) {
        window.rtVsTpsChart.destroy();
      }
      
      // Extract data for the chart - clean up the data points
      const rtData = clientData.combinedTimeData
        .filter(point => point.responseTime !== null)
        .map(point => ({
          x: point.x,
          y: point.responseTime
        }));
      
      // Reduce the number of data points for TPS to make it cleaner
      const tpsData = clientData.combinedTimeData
        .filter(point => point.tps !== null)
        .map(point => ({
          x: point.x,
          y: point.tps
        }));
      
      // Configure dual Y-axis chart with cleaner display
      const rtVsTpsOptions = {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        elements: {
          line: {
            tension: 0.3
          },
          point: {
            radius: 0 // Hide points for cleaner lines
          }
        },
        plugins: {
          tooltip: {
            callbacks: {
              title: function(context) {
                return 'At ' + formatTime(context[0].parsed.x) + ' of test';
              },
              label: function(context) {
                const datasetLabel = context.dataset.label;
                const value = context.parsed.y;
                if (datasetLabel === 'Response Time') {
                  return datasetLabel + ': ' + value.toFixed(2) + ' ms';
                } else {
                  return datasetLabel + ': ' + value.toFixed(2);
                }
              }
            },
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            titleFont: { size: 12 },
            bodyFont: { size: 12 },
            padding: 8,
            displayColors: true
          },
          legend: {
            position: 'top',
            align: 'center',
            labels: {
              usePointStyle: true,
              boxWidth: 10,
              padding: 10,
              font: { size: 11 }
            }
          },
          datalabels: {
            display: false
          }
        },
        scales: {
          x: {
            type: 'linear',
            title: { display: true, text: 'Test Duration (MM:SS)', font: { size: 12 } },
            ticks: { 
              callback: function(value) { return formatTime(value); },
              font: { size: 10 },
              maxRotation: 0
            },
            grid: { color: 'rgba(0, 0, 0, 0.05)' }
          },
          y: {
            type: 'linear',
            display: true,
            position: 'left',
            title: { display: true, text: 'Response Time (ms)', font: { size: 12 } },
            beginAtZero: true,
            ticks: { font: { size: 10 } },
            grid: { color: 'rgba(0, 0, 0, 0.05)' }
          },
          y1: {
            type: 'linear',
            display: true,
            position: 'right',
            title: { display: true, text: 'TPS', font: { size: 12 } },
            beginAtZero: true,
            ticks: { font: { size: 10 } },
            grid: {
              drawOnChartArea: false // Only show grid lines for the left axis
            }
          }
        }
      };
      
      // Sample the data to reduce visual noise
      const sampleRate = Math.max(1, Math.floor(rtData.length / 200)); // Limit to ~200 points max
      const sampledRtData = rtData.filter((_, i) => i % sampleRate === 0);
      
      // Create the chart with dual Y-axes
      window.rtVsTpsChart = new Chart(ctx, {
        type: 'line',
        data: {
          datasets: [
            {
              label: 'Response Time',
              data: sampledRtData,
              borderColor: '#4f46e5',
              backgroundColor: function(context) {
                const chart = context.chart;
                const {ctx, chartArea} = chart;
                if (!chartArea) return null;
                const gradient = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
                gradient.addColorStop(0, 'rgba(79, 70, 229, 0.05)');
                gradient.addColorStop(1, 'rgba(79, 70, 229, 0.2)');
                return gradient;
              },
              yAxisID: 'y',
              fill: true,
              borderWidth: 1.5,
              pointRadius: 0,
              pointHoverRadius: 3
            },
            {
              label: 'TPS',
              data: tpsData,
              borderColor: '#22c55e',
              backgroundColor: 'transparent',
              yAxisID: 'y1',
              borderWidth: 1.5,
              pointRadius: 0,
              pointHoverRadius: 3,
              fill: false
            }
          ]
        },
        options: rtVsTpsOptions
      });
    }
    
    // RPS Chart
    if (document.getElementById('rpsChart')) {
      // Clone the time scale options but ensure proper formatting
      const rpsOptions = JSON.parse(JSON.stringify(timeScaleOptions));
      rpsOptions.scales.y.title.text = 'RPS';
      
      // Ensure x-axis ticks use proper time formatting
      rpsOptions.scales.x = {
        type: 'linear',
        title: { display: true, text: 'Test Duration (MM:SS)' },
        ticks: {
          callback: function(value) { 
            return formatTime(value);
          }
        },
        grid: { color: 'rgba(0, 0, 0, 0.05)' }
      };
      
      new Chart(document.getElementById('rpsChart').getContext('2d'), {
        type: 'line',
        data: { datasets: [{ label: 'RPS', data: clientData.rpsData, borderColor: '#22c55e', borderWidth: 2, pointRadius: 0, fill: true, tension: 0.4 }] },
        options: rpsOptions
      });
    }
    
    // VU Chart
    if (document.getElementById('vuChart')) {
      // Clone the time scale options but ensure proper formatting
      const vuOptions = JSON.parse(JSON.stringify(timeScaleOptions));
      vuOptions.scales.y.title.text = 'VUs';
      
      // Ensure x-axis ticks use proper time formatting
      vuOptions.scales.x = {
        type: 'linear',
        title: { display: true, text: 'Test Duration (MM:SS)' },
        ticks: {
          callback: function(value) { 
            return formatTime(value);
          }
        },
        grid: { color: 'rgba(0, 0, 0, 0.05)' }
      };
      
      new Chart(document.getElementById('vuChart').getContext('2d'), {
        type: 'line',
        data: { datasets: [{ label: 'VUs', data: clientData.vuData, borderColor: '#8b5cf6', borderWidth: 2, pointRadius: 0, fill: true, stepped: true }] },
        options: vuOptions
      });
    }
  `;
}

// Main execution block
if (import.meta.url === import.meta.main) {
  const args = process.argv.slice(2);
  const [processedDataPath, templatePath, outputPath] = args;
  
  if (!processedDataPath || !templatePath || !outputPath) {
    console.error('Usage: node performance-dashboard-generator.js <processed-data.json> <template.html> <output.html>');
    process.exit(1);
  }
  
  generatePerformanceDashboard(processedDataPath, templatePath, outputPath);
}

// Export the function for use in other modules
export { generatePerformanceDashboard };