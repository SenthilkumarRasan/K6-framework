/* eslint-env node */
/* eslint-disable indent, no-unused-vars */
/* globals require module */
const { generateReportStyles: originalStyles, buildReportLegend } = require('./report-helpers.js');

function generateReportStyles() {
  return originalStyles() + `
  <style>
    /* Tables with colored headers */
    .html-header { background-color: #e0f0ff; color: #1a56db; padding: 10px; border-radius: 4px; }
    .nonhtml-header { background-color: #e0f7ea; color: #047857; padding: 10px; border-radius: 4px; }
    .summary-header { background-color: #f3e8ff; color: #6b21a8; padding: 10px; border-radius: 4px; }
    .resource-type-header { background-color: #fee2e2; color: #b91c1c; padding: 10px; border-radius: 4px; }
    .network-analysis-header { background-color: #e0e7ff; color: #3730a3; padding: 10px; border-radius: 4px; }
    .html-performance-table th { background-color: #e0f0ff; }
    .nonhtml-performance-table th { background-color: #e0f7ea; }
  </style>
  `;
}

// --- Helper Functions ---

function formatNumber(value, decimals = 2) {
  if (value === undefined || value === null || isNaN(value)) return '0.00';
  return Number(value).toFixed(decimals);
}



function calculateStats(values = []) {
  if (!Array.isArray(values) || values.length === 0) {
    return { min: 0, max: 0, avg: 0, med: 0, p90: 0, p95: 0, p99: 0, count: 0 };
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const count = sorted.length;
  const min = sorted[0];
  const max = sorted[count - 1];
  const sum = sorted.reduce((acc, val) => acc + val, 0);
  const avg = sum / count;
  const med = sorted[Math.floor((count - 1) / 2)];
  const p90 = sorted[Math.floor((count - 1) * 0.90)];
  const p95 = sorted[Math.floor((count - 1) * 0.95)];
  const p99 = sorted[Math.floor((count - 1) * 0.99)];
  return { min, max, avg, med, p90, p95, p99, count };
}

function shortenUrl(url, maxLength = 40) {
  if (!url) return 'unknown';
  if (url.length <= maxLength) return url;

  try {
    const parsedUrl = new URL(url);
    const domain = parsedUrl.hostname;
    const path = parsedUrl.pathname;

    // If domain alone is too long, truncate it
    if (domain.length > maxLength - 5) {
      return domain.substring(0, maxLength - 5) + '...';
    }

    // Calculate how much of the path we can keep
    const maxPathLength = maxLength - domain.length - 5; // 5 for '://' and '...'
    if (maxPathLength <= 3) {
      return domain + '...';
    }

    // Truncate the path
    const shortenedPath = path.length > maxPathLength
      ? '...' + path.substring(path.length - maxPathLength)
      : path;

    return domain + shortenedPath;
  } catch (e) {
    // Fallback if URL parsing fails
    return url.substring(0, maxLength - 3) + '...';
  }
}

// --- Table Builder Functions ---

function buildOverallSummary(htmlResources, nonHtmlResources) {
  // Ensure we have valid arrays to work with
  const safeHtmlResources = Array.isArray(htmlResources) ? htmlResources : [];
  const safeNonHtmlResources = Array.isArray(nonHtmlResources) ? nonHtmlResources : [];

  // Calculate overall metrics
  const totalTransactions = [...new Set([...safeHtmlResources, ...safeNonHtmlResources].map(r => r.transaction))].filter(Boolean).length;
  const totalRequests = safeHtmlResources.length + safeNonHtmlResources.length;

  // Calculate HTML metrics
  const htmlTtfbValues = safeHtmlResources.map(r => r.ttfb || r.waiting || 0);
  const htmlTtlbValues = safeHtmlResources.map(r => r.ttlb || r.duration || 0);
  const htmlStats = {
    ttfb: calculateStats(htmlTtfbValues),
    ttlb: calculateStats(htmlTtlbValues)
  };

  // Calculate non-HTML metrics
  const nonHtmlTtfbValues = safeNonHtmlResources.map(r => r.ttfb || r.waiting || 0);
  const nonHtmlTtlbValues = safeNonHtmlResources.map(r => r.ttlb || r.duration || 0);
  const nonHtmlStats = {
    ttfb: calculateStats(nonHtmlTtfbValues),
    ttlb: calculateStats(nonHtmlTtlbValues)
  };

  // Calculate combined metrics
  const allTtfbValues = [...htmlTtfbValues, ...nonHtmlTtfbValues];
  const allTtlbValues = [...htmlTtlbValues, ...nonHtmlTtlbValues];
  const totalStats = {
    ttfb: calculateStats(allTtfbValues),
    ttlb: calculateStats(allTtlbValues),
    count: totalRequests
  };

  return `
    <div class="metrics-section">
      <h3 class="section-header overall-summary-header">Overall Performance Summary</h3>
      
      <div class="summary-stats">
        <div class="summary-stat-item">
          <div class="summary-stat-value">${totalTransactions}</div>
          <div class="summary-stat-label">Total Transactions</div>
        </div>
        <div class="summary-stat-item">
          <div class="summary-stat-value">${totalRequests}</div>
          <div class="summary-stat-label">Total Resource Requests</div>
        </div>
      </div>
      
      <table class="metrics-table overall-summary-table">
        <thead>
          <tr>
            <th rowspan="2">Resource Type</th>
            <th rowspan="2">Count</th>
            <th colspan="3">TTFB (ms)</th>
            <th colspan="3">TTLB (ms)</th>
            <th rowspan="2">Success Rate</th>
          </tr>
          <tr>
            <th>Avg</th>
            <th>Median</th>
            <th>p90</th>
            <th>Avg</th>
            <th>Median</th>
            <th>p90</th>
          </tr>
        </thead>
        <tbody>
          <tr class="html-resources-row">
            <td><span class="resource-type-badge html">HTML Resources</span></td>
            <td>${safeHtmlResources.length}</td>
            <td>${formatNumber(htmlStats.ttfb.avg)}</td>
            <td>${formatNumber(htmlStats.ttfb.med)}</td>
            <td>${formatNumber(htmlStats.ttfb.p90)}</td>
            <td>${formatNumber(htmlStats.ttlb.avg)}</td>
            <td>${formatNumber(htmlStats.ttlb.med)}</td>
            <td>${formatNumber(htmlStats.ttlb.p90)}</td>
            <td>${formatNumber(safeHtmlResources.filter(r => r.status >= 200 && r.status < 400).length / safeHtmlResources.length * 100)}%</td>
          </tr>
          <tr class="nonhtml-resources-row">
            <td><span class="resource-type-badge nonhtml">Non-HTML Resources</span></td>
            <td>${safeNonHtmlResources.length}</td>
            <td>${formatNumber(nonHtmlStats.ttfb.avg)}</td>
            <td>${formatNumber(nonHtmlStats.ttfb.med)}</td>
            <td>${formatNumber(nonHtmlStats.ttfb.p90)}</td>
            <td>${formatNumber(nonHtmlStats.ttlb.avg)}</td>
            <td>${formatNumber(nonHtmlStats.ttlb.med)}</td>
            <td>${formatNumber(nonHtmlStats.ttlb.p90)}</td>
            <td>${formatNumber(safeNonHtmlResources.filter(r => r.status >= 200 && r.status < 400).length / safeNonHtmlResources.length * 100)}%</td>
          </tr>
          <tr class="total-row">
            <td><strong>All Resources</strong></td>
            <td><strong>${totalRequests}</strong></td>
            <td><strong>${formatNumber(totalStats.ttfb.avg)}</strong></td>
            <td><strong>${formatNumber(totalStats.ttfb.med)}</strong></td>
            <td><strong>${formatNumber(totalStats.ttfb.p90)}</strong></td>
            <td><strong>${formatNumber(totalStats.ttlb.avg)}</strong></td>
            <td><strong>${formatNumber(totalStats.ttlb.med)}</strong></td>
            <td><strong>${formatNumber(totalStats.ttlb.p90)}</strong></td>
            <td><strong>${formatNumber(([...safeHtmlResources, ...safeNonHtmlResources].filter(r => r.status >= 200 && r.status < 400).length / totalRequests) * 100)}%</strong></td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
}

function buildPerformanceByTransactionTable(title, transactions, resources) {
  // Determine table class based on title
  const tableClass = title.toLowerCase().includes('html') ?
    (title.toLowerCase().includes('non-html') ? 'nonhtml-performance-table' : 'html-performance-table') :
    'metrics-table';

  // Determine header class based on title
  const headerClass = title.toLowerCase().includes('html') ?
    (title.toLowerCase().includes('non-html') ? 'nonhtml-performance-header' : 'html-performance-header') :
    'section-header';

  return `
    <div class="metrics-section">
      <h3 class="section-header ${headerClass}">${title}</h3>
      <table class="metrics-table ${tableClass}">
        <thead>
          <tr>
            <th>Transaction</th>
            <th>Requests</th>
            <th>Success Rate</th>
            <th>Avg TTFB (ms)</th>
            <th>Avg TTLB (ms)</th>
            <th>p90 TTFB (ms)</th>
            <th>p90 TTLB (ms)</th>
          </tr>
        </thead>
        <tbody>
          ${transactions.map(txn => {
    const txnResources = resources.filter(r => r.transaction === txn);
    if (txnResources.length === 0) return '';

    const ttfbValues = txnResources.map(r => r.ttfb || r.waiting || 0);
    const ttlbValues = txnResources.map(r => r.ttlb || r.duration || 0);
    const stats = {
      ttfb: calculateStats(ttfbValues),
      ttlb: calculateStats(ttlbValues)
    };
    const successCount = txnResources.filter(r => r.status >= 200 && r.status < 400).length;
    const successRate = txnResources.length > 0 ? (successCount / txnResources.length * 100) : 100;

    return `
              <tr>
                <td>${txn}</td>
                <td>${txnResources.length}</td>
                <td>${formatNumber(successRate)}%</td>
                <td>${formatNumber(stats.ttfb.avg)}</td>
                <td>${formatNumber(stats.ttlb.avg)}</td>
                <td>${formatNumber(stats.ttfb.p90)}</td>
                <td>${formatNumber(stats.ttlb.p90)}</td>
              </tr>
            `;
  }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function buildResourceTypeByTransactionTable(transactions, resources) {
  // Remove font type as requested, focus on core resource types
  const resourceTypes = ['js', 'css', 'image'];
  const typeMapping = {
    'js': 'JS',
    'css': 'CSS',
    'image': 'Image',
    'font': 'Font',
    'other': 'Other',
    'img': 'Image'
  };

  return `
    <div class="metrics-section">
      <h3 class="section-header resource-type-header">Resource Types by Transaction</h3>
      <div class="resource-type-legend">
        <div class="resource-type-legend-item" style="margin-right: 1.5rem;">
          <span class="resource-type js" style="margin-right: 0.5rem;">J</span>
          <span>JS</span>
        </div>
        <div class="resource-type-legend-item" style="margin-right: 1.5rem;">
          <span class="resource-type css" style="margin-right: 0.5rem;">C</span>
          <span>CSS</span>
        </div>
        <div class="resource-type-legend-item" style="margin-right: 1.5rem;">
          <span class="resource-type image" style="margin-right: 0.5rem;">I</span>
          <span>Image</span>
        </div>
      </div>
      <table class="metrics-table resource-type-table">
        <thead>
          <tr>
            <th rowspan="2">Transaction</th>
            ${resourceTypes.map(type => `<th colspan="5">${typeMapping[type]}</th>`).join('')}
          </tr>
          <tr>
            ${resourceTypes.map(() => `
              <th>Reqs</th>
              <th>Avg TTFB</th>
              <th>Avg TTLB</th>
              <th>p90</th>
              <th>Success</th>
            `).join('')}
          </tr>
        </thead>
        <tbody>
          ${transactions.map(txn => {
    const txnResources = resources.filter(r => r.transaction === txn);
    if (txnResources.length === 0) return '';

    return `
              <tr>
                <td>${txn}</td>
                ${resourceTypes.map(type => {
    // Get resources of this type (only JS, CSS and image)
    const typeResources = txnResources.filter(r => {
      if (type === 'image') return r.type === 'image' || r.type === 'img';
      return r.type === type;
    });

    // Calculate stats
    const count = typeResources.length;
    const ttfbValues = typeResources.map(r => r.ttfb || r.waiting || 0);
    const ttlbValues = typeResources.map(r => r.ttlb || r.duration || 0);
    const ttfbStats = calculateStats(ttfbValues);
    const ttlbStats = calculateStats(ttlbValues);
    const successRate = count > 0 ?
      (typeResources.filter(r => r.status >= 200 && r.status < 400).length / count * 100) : 100;

    return `
                    <td>${count}</td>
                    <td>${formatNumber(ttfbStats.avg)}</td>
                    <td>${formatNumber(ttlbStats.avg)}</td>
                    <td>${formatNumber(ttlbStats.p90)}</td>
                    <td>${formatNumber(successRate)}%</td>
                  `;
  }).join('')}
              </tr>
            `;
  }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function buildNetworkResourceAnalysisTable(transactions, resources) {
  return `
    <div class="metrics-section">
      <h3 class="section-header network-analysis-header">Network Resource Analysis</h3>
      <table class="metrics-table network-analysis-table">
        <thead>
          <tr>
            <th>Transaction</th>
            <th>Total Requests</th>
            <th>Avg Size (KB)</th>
            <th>Avg Time (ms)</th>
            <th>p90 Time (ms)</th>
            <th>Success Rate</th>
            <th>Top 5 Resources (By Avg Size)</th>
            <th>Top 5 Resources (By Avg Time)</th>
          </tr>
        </thead>
        <tbody>
          ${transactions.map(txn => {
    const txnResources = resources.filter(r => r.transaction === txn);
    if (txnResources.length === 0) return '';

    // Calculate metrics
    const reqCount = txnResources.length;
    const avgSize = reqCount > 0 ? txnResources.reduce((sum, r) => sum + (r.size || 0), 0) / reqCount / 1024 : 0;
    const avgTime = reqCount > 0 ? txnResources.reduce((sum, r) => sum + r.duration, 0) / reqCount : 0;

    // Calculate p90 time
    const sortedDurations = [...txnResources].map(r => r.duration).sort((a, b) => a - b);
    const p90Index = Math.floor(sortedDurations.length * 0.9);
    const p90Time = sortedDurations[p90Index] || 0;

    // Calculate success rate
    const successCount = txnResources.filter(r => r.status >= 200 && r.status < 400).length;
    const successRate = reqCount > 0 ? (successCount / reqCount) * 100 : 100;

    // Calculate top 5 resources by size and time - exclude font and other types
    const filteredResources = txnResources.filter(r => ['js', 'css', 'image', 'img', 'html'].includes(r.type));
    const top5BySize = [...filteredResources].sort((a, b) => (b.size || 0) - (a.size || 0)).slice(0, 5);
    const top5ByTime = [...filteredResources].sort((a, b) => (b.duration || 0) - (a.duration || 0)).slice(0, 5);

    // Render resource cards for top resources
    const renderResourceCards = (resources, metric) => {
      return resources.map(r => {
        const type = r.type || 'other';
        const typeClass = type.toLowerCase();
        const typeLabel = type.charAt(0).toUpperCase();
        const shortUrl = shortenUrl(r.url, 25); // Shorter URL for better display

        // Calculate success rate for this resource
        const successRate = r.status >= 200 && r.status < 400 ? 100 : 0;

        return `
                  <div class="resource-card" title="${r.url}">
                    <div class="resource-type ${typeClass}">${typeLabel}</div>
                    <div class="resource-info">
                      <div class="resource-url" data-tooltip="${r.url}">${shortUrl}</div>
                      <div class="resource-stats">
                        <div>Reqs: ${r.count || 1} | ${metric === 'size' ?
  `Size: ${formatNumber(r.size / 1024)} KB` :
  `Time: ${formatNumber(r.duration)} ms`}</div>
                        <div>Success: ${successRate}% | TTFB: ${formatNumber(r.ttfb || r.waiting || 0)} ms</div>
                      </div>
                    </div>
                  </div>
                `;
      }).join('');
    };

    return `
              <tr>
                <td>${txn}</td>
                <td>${reqCount}</td>
                <td>${formatNumber(avgSize)}</td>
                <td>${formatNumber(avgTime)}</td>
                <td>${formatNumber(p90Time)}</td>
                <td>${formatNumber(successRate)}%</td>
                <td class="resource-cards-cell">${renderResourceCards(top5BySize, 'size')}</td>
                <td class="resource-cards-cell">${renderResourceCards(top5ByTime, 'time')}</td>
              </tr>
            `;
  }).join('')}
        </tbody>
      </table>
    </div>
  `;
}


// --- Main Report Generator ---

function generateProtocolReport(data, inputHtmlTransactions, inputNonHtmlTransactions, state) {
  // Move legend to the bottom by adding it at the end of HTML content instead of beginning
  // Flatten all resources from data.resource_details into a single array and ensure type is defined
  const allResources = Object.values(data.resource_details || {}).flat().map(r => ({
    ...r,
    type: r.type || 'other'
  }));

  // Check if a transaction name follows the nonhtml naming convention (ends with _nonhtml)
  // This function is currently not used but kept for future reference
  /* const isNonHtmlTransaction = (txName) => {
    return txName && typeof txName === 'string' && txName.toLowerCase().endsWith('_nonhtml');
  }; */

  // Enhanced transaction performance table with split TTFB and TTLB columns
  function buildPerformanceByTransactionTable(title, transactions, resources, resourceType = 'html') {
    // Determine table class based on resource type
    const tableClass = resourceType === 'html' ? 'html-performance-table' : 'nonhtml-performance-table';

    // Determine header class based on resource type for color styling
    const headerClass = resourceType === 'html' ? 'html-header' : 'nonhtml-header';

    return `
      <div class="metrics-section">
        <h3 class="section-header ${headerClass}">${title}</h3>
        <table class="metrics-table ${tableClass}">
          <thead>
            <tr>
              <th rowspan="2">Transaction</th>
              <th rowspan="2">Requests</th>
              <th rowspan="2">Success Rate</th>
              <th colspan="3" class="ttfb-header">TTFB (ms)</th>
              <th colspan="3" class="ttlb-header">TTLB (ms)</th>
            </tr>
            <tr>
              <th>Avg</th>
              <th>Median</th>
              <th>p90</th>
              <th>Avg</th>
              <th>Median</th>
              <th>p90</th>
            </tr>
          </thead>
          <tbody>
            ${transactions.map(txn => {
    const txnResources = resources.filter(r => r.transaction === txn);
    if (txnResources.length === 0) return '';

    // Calculate success rate
    const successCount = txnResources.filter(r => r.status >= 200 && r.status < 400).length;
    const successRate = txnResources.length > 0 ? (successCount / txnResources.length * 100) : 100;

    // Calculate TTFB stats
    const ttfbValues = txnResources.map(r => r.ttfb || r.waiting || 0);
    const ttfbStats = calculateStats(ttfbValues);

    // Calculate TTLB stats
    const ttlbValues = txnResources.map(r => r.ttlb || r.duration || 0);
    const ttlbStats = calculateStats(ttlbValues);

    return `
                <tr>
                  <td>${txn.replace('_nonhtml', '')}</td>
                  <td>${txnResources.length}</td>
                  <td>${formatNumber(successRate)}%</td>
                  <td>${formatNumber(ttfbStats.avg)}</td>
                  <td>${formatNumber(ttfbStats.med)}</td>
                  <td>${formatNumber(ttfbStats.p90)}</td>
                  <td>${formatNumber(ttlbStats.avg)}</td>
                  <td>${formatNumber(ttlbStats.med)}</td>
                  <td>${formatNumber(ttlbStats.p90)}</td>
                </tr>
              `;
  }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // Strict separation of resources based on the transaction name suffix.
  // This is the correct approach now that we've fixed the data collection.
  const htmlResources = allResources.filter(r => !r.transaction || !r.transaction.endsWith('_nonhtml'));
  const nonHtmlResources = allResources.filter(r => r.transaction && r.transaction.endsWith('_nonhtml'));

  // Get unique transaction names from the resources
  let htmlTransactions = [...new Set(htmlResources.map(r => r.transaction))].filter(Boolean).sort();
  let nonHtmlTransactions = [...new Set(nonHtmlResources.map(r => r.transaction))].filter(Boolean).sort();

  // Log the categorization results
  console.log(`Processing ${htmlResources.length} HTML resources across ${htmlTransactions.length} HTML transactions`);
  console.log(`Processing ${nonHtmlResources.length} non-HTML resources across ${nonHtmlTransactions.length} non-HTML transactions`);
  console.log(`Processing ${htmlResources.length} HTML resources and ${nonHtmlResources.length} non-HTML resources`);

  // Build report sections in proper order
  state.htmlReportContent.push(buildOverallSummary(htmlResources, nonHtmlResources));

  // Separate HTML and non-HTML transaction tables with enhanced columns
  state.htmlReportContent.push(buildPerformanceByTransactionTable('HTML Resources by Transaction', htmlTransactions, htmlResources, 'html'));
  state.htmlReportContent.push(buildPerformanceByTransactionTable('Non-HTML Resources by Transaction', nonHtmlTransactions, nonHtmlResources, 'nonhtml'));

  // Resource types table (JS, CSS, image only)
  state.htmlReportContent.push(buildResourceTypeByTransactionTable(nonHtmlTransactions, nonHtmlResources));

  // Network resource analysis with top 5 resources (excluding font/other)
  state.htmlReportContent.push(buildNetworkResourceAnalysisTable(nonHtmlTransactions, nonHtmlResources));

  // Add legend at the BOTTOM as requested
  state.htmlReportContent.push(buildReportLegend());

  // Add styles at the beginning
  state.htmlReportContent.unshift(generateReportStyles());
}



function generateApiReport(data, inputHtmlTransactions, state) {
  // Flatten all resources from data.resource_details into a single array and ensure type is defined
  const allResources = Object.values(data.resource_details || {}).flat().map(r => ({
    ...r,
    type: r.type || 'other'
  }));

  // For API report, we only care about HTML resources (direct API calls)
  const apiResources = allResources.filter(r => !r.transaction || !r.transaction.endsWith('_nonhtml'));

  // Get unique transaction names from the resources
  let apiTransactions = [...new Set(apiResources.map(r => r.transaction))].filter(Boolean).sort();

  // Log the API resources being processed
  console.log(`API Report: Processing ${apiResources.length} API requests across ${apiTransactions.length} transactions`);

  // Build API-specific overall summary
  function buildApiOverallSummary(resources) {
    // Ensure we have valid arrays to work with
    const safeResources = Array.isArray(resources) ? resources : [];

    // Calculate overall metrics
    const totalTransactions = [...new Set(safeResources.map(r => r.transaction))].filter(Boolean).length;
    const totalRequests = safeResources.length;

    // Calculate API metrics
    const ttfbValues = safeResources.map(r => r.ttfb || r.waiting || 0);
    const ttlbValues = safeResources.map(r => r.ttlb || r.duration || 0);
    const apiStats = {
      ttfb: calculateStats(ttfbValues),
      ttlb: calculateStats(ttlbValues)
    };

    // Calculate success rate
    const successCount = safeResources.filter(r => r.status >= 200 && r.status < 400).length;
    const successRate = safeResources.length > 0 ? (successCount / safeResources.length * 100) : 100;

    return `
      <div class="metrics-section">
        <h3 class="section-header summary-header">API Performance Summary</h3>
        
        <div class="summary-stats">
          <div class="summary-stat-item">
            <div class="summary-stat-value">${totalTransactions}</div>
            <div class="summary-stat-label">Total API Endpoints</div>
          </div>
          <div class="summary-stat-item">
            <div class="summary-stat-value">${totalRequests}</div>
            <div class="summary-stat-label">Total API Requests</div>
          </div>
        </div>
        
        <table class="metrics-table overall-summary-table">
          <thead>
            <tr>
              <th rowspan="2">API Requests</th>
              <th rowspan="2">Count</th>
              <th rowspan="2">Success Rate</th>
              <th colspan="3">TTFB (ms)</th>
              <th colspan="3">TTLB (ms)</th>
            </tr>
            <tr>
              <th>Avg</th>
              <th>Median</th>
              <th>p90</th>
              <th>Avg</th>
              <th>Median</th>
              <th>p90</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>All API Endpoints</strong></td>
              <td><strong>${totalRequests}</strong></td>
              <td><strong>${formatNumber(successRate)}%</strong></td>
              <td><strong>${formatNumber(apiStats.ttfb.avg)}</strong></td>
              <td><strong>${formatNumber(apiStats.ttfb.med)}</strong></td>
              <td><strong>${formatNumber(apiStats.ttfb.p90)}</strong></td>
              <td><strong>${formatNumber(apiStats.ttlb.avg)}</strong></td>
              <td><strong>${formatNumber(apiStats.ttlb.med)}</strong></td>
              <td><strong>${formatNumber(apiStats.ttlb.p90)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  }

  // Build API performance by transaction table
  function buildApiPerformanceByTransactionTable(transactions, resources) {
    return `
      <div class="metrics-section">
        <h3 class="section-header html-header">API Performance by Endpoint</h3>
        <table class="metrics-table html-performance-table">
          <thead>
            <tr>
              <th rowspan="2">Endpoint</th>
              <th rowspan="2">Requests</th>
              <th rowspan="2">Success Rate</th>
              <th colspan="3" class="ttfb-header">TTFB (ms)</th>
              <th colspan="3" class="ttlb-header">TTLB (ms)</th>
            </tr>
            <tr>
              <th>Avg</th>
              <th>Median</th>
              <th>p90</th>
              <th>Avg</th>
              <th>Median</th>
              <th>p90</th>
            </tr>
          </thead>
          <tbody>
            ${transactions.map(txn => {
    const txnResources = resources.filter(r => r.transaction === txn);
    if (txnResources.length === 0) return '';

    // Calculate success rate
    const successCount = txnResources.filter(r => r.status >= 200 && r.status < 400).length;
    const successRate = txnResources.length > 0 ? (successCount / txnResources.length * 100) : 100;

    // Calculate TTFB stats
    const ttfbValues = txnResources.map(r => r.ttfb || r.waiting || 0);
    const ttfbStats = calculateStats(ttfbValues);

    // Calculate TTLB stats
    const ttlbValues = txnResources.map(r => r.ttlb || r.duration || 0);
    const ttlbStats = calculateStats(ttlbValues);

    return `
                <tr>
                  <td>${txn}</td>
                  <td>${txnResources.length}</td>
                  <td>${formatNumber(successRate)}%</td>
                  <td>${formatNumber(ttfbStats.avg)}</td>
                  <td>${formatNumber(ttfbStats.med)}</td>
                  <td>${formatNumber(ttfbStats.p90)}</td>
                  <td>${formatNumber(ttlbStats.avg)}</td>
                  <td>${formatNumber(ttlbStats.med)}</td>
                  <td>${formatNumber(ttlbStats.p90)}</td>
                </tr>
              `;
  }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // Add styles at the beginning
  state.htmlReportContent.unshift(generateReportStyles());

  // Build report sections in proper order
  state.htmlReportContent.push(buildApiOverallSummary(apiResources));
  state.htmlReportContent.push(buildApiPerformanceByTransactionTable(apiTransactions, apiResources));

  // Add API-specific metrics legend at the bottom with improved styling
  state.htmlReportContent.push(`
    <style>
      .api-metrics-legend {
        margin-top: 40px;
        padding: 20px;
        background-color: #f8fafc;
        border-radius: 8px;
        border-left: 4px solid #6366f1;
        box-shadow: 0 2px 6px rgba(0,0,0,0.05);
        font-size: 13px;
      }
      .api-metrics-legend h3 {
        margin-top: 0;
        margin-bottom: 16px;
        color: #1e293b;
        font-size: 18px;
        font-weight: 600;
      }
      .metrics-table-container {
        width: 100%;
        overflow-x: auto;
      }
      .metrics-definition-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
      }
      .metrics-definition-table tr:nth-child(even) {
        background-color: rgba(0,0,0,0.02);
      }
      .metrics-definition-table th {
        text-align: left;
        padding: 8px 12px;
        background-color: #e2e8f0;
        color: #334155;
        font-weight: 600;
        white-space: nowrap;
      }
      .metrics-definition-table td {
        padding: 8px 12px;
        color: #475569;
        line-height: 1.4;
        vertical-align: top;
        border-bottom: 1px solid #e2e8f0;
      }
      .metric-name {
        font-weight: 600;
        color: #334155;
        white-space: nowrap;
      }
    </style>
    <div class="api-metrics-legend">
      <h3>API Metrics Legend</h3>
      <div class="metrics-table-container">
        <table class="metrics-definition-table">
          <thead>
            <tr>
              <th>Metric</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="metric-name">Requests</td>
              <td>Total number of API calls made to this endpoint during the test.</td>
            </tr>
            <tr>
              <td class="metric-name">Success Rate</td>
              <td>Percentage of API calls that returned a successful HTTP status code (2xx or 3xx).</td>
            </tr>
            <tr>
              <td class="metric-name">TTFB<br><span style="font-weight:normal;font-size:11px">(Time To First Byte)</span></td>
              <td>Time elapsed between sending the request and receiving the first byte of the response. This measures server processing time and network latency.</td>
            </tr>
            <tr>
              <td class="metric-name">TTLB<br><span style="font-weight:normal;font-size:11px">(Time To Last Byte)</span></td>
              <td>Total time elapsed between sending the request and receiving the complete response. This includes TTFB plus the time to download the entire response.</td>
            </tr>
            <tr>
              <td class="metric-name">Avg<br><span style="font-weight:normal;font-size:11px">(Average)</span></td>
              <td>The mean value of all measurements for this metric.</td>
            </tr>
            <tr>
              <td class="metric-name">Median</td>
              <td>The middle value of all measurements for this metric when sorted. Less affected by outliers than the average.</td>
            </tr>
            <tr>
              <td class="metric-name">p90<br><span style="font-weight:normal;font-size:11px">(90th Percentile)</span></td>
              <td>90% of measurements were at or below this value. Useful for understanding the experience of most users while excluding extreme outliers.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `);
}

module.exports = { generateProtocolReport, generateApiReport };
