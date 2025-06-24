/* globals module */
/**
 * Shared utility functions for K6 report generation
 * 
 * This module provides common utility functions used by both browser and protocol report generators.
 * It includes functions for statistical calculations, transaction name extraction, and report styling.
 * The module implements defensive coding to prevent "Cannot read property 'toFixed' of undefined"
 * errors by safely handling empty arrays and undefined values.
 * 
 * @module report-helpers
 */

// From original report-utils.js
function calculateStats(values) {
  if (!values || values.length === 0) {
    return {
      min: 0,
      max: 0,
      avg: 0,
      median: 0,
      p90: 0,
      p95: 0,
      p99: 0,
      count: 0
    };
  }

  const sorted = values.slice().sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const count = sorted.length;
  
  return {
    min: sorted[0],
    max: sorted[count - 1],
    avg: sum / count,
    median: count % 2 === 1 ? sorted[Math.floor(count / 2)] : (sorted[count / 2 - 1] + sorted[count / 2]) / 2,
    p90: sorted[Math.floor(0.9 * count)],
    p95: sorted[Math.floor(0.95 * count)],
    p99: sorted[Math.floor(0.99 * count)],
    count
  };
}

function calculateAggregateStats(metricData) {
  const allValues = [];
  if (metricData) {
    Object.values(metricData).forEach(values => {
      if (Array.isArray(values)) {
        allValues.push(...values);
      }
    });
  }
  return calculateStats(allValues);
}

function getTransactionName(tags) {
  if (!tags) return 'unknown';
  const tagObj = tags.tags || tags; // Handle if tags are nested under a 'tags' property
  
  // First check for transaction tag
  if (tagObj.transaction) {
    return tagObj.transaction;
  }
  return 'unknown';
}

function generateReportStyles() {
  return `
  <style>
    /* Base Styles */
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      line-height: 1.6;
      color: #374151;
      max-width: 1200px;
      margin: 0 auto;
      padding: 24px;
      background-color: #f9fafb;
    }
    
    h1, h2, h3, h4 {
      color: #111827;
      margin-top: 1.5em;
      margin-bottom: 0.75em;
    }
    
    h1 {
      font-size: 1.75rem;
      border-bottom: 3px solid #4f46e5;
      padding-bottom: 0.5rem;
      display: inline-block;
    }
    
    h3.section-header {
      font-size: 1.25rem;
      margin-top: 2rem;
      margin-bottom: 1rem;
      padding-bottom: 0.5rem;
      border-bottom: 2px solid;
    }
    
    h3.section-header.overall-summary-header {
      border-color: #4338ca;
    }
    
    h3.section-header.html-performance-header {
      border-color: #065f46;
    }
    
    h3.section-header.nonhtml-performance-header {
      border-color: #4338ca;
    }
    
    h3.section-header.resource-type-header {
      border-color: #991b1b;
    }
    
    h3.section-header.network-analysis-header {
      border-color: #6b21a8;
    }

    /* Modern Table Styling */
    table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      margin-bottom: 32px;
      font-size: 14px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
      border-radius: 8px;
      overflow: hidden;
    }
    
    th {
      color: #fff;
      padding: 14px 16px;
      text-align: left;
      font-weight: 600;
      letter-spacing: 0.025em;
    }
    
    /* Table header gradient styles for different table types */
    .overall-summary-table th { background: linear-gradient(to right, #3730a3, #4338ca); }
    .html-performance-table th { background: linear-gradient(to right, #065f46, #047857); }
    .nonhtml-performance-table th { background: linear-gradient(to right, #4338ca, #4f46e5); }
    .resource-type-table th { background: linear-gradient(to right, #991b1b, #b91c1c); }
    .network-analysis-table th { background: linear-gradient(to right, #6b21a8, #7e22ce); }
    
    /* Table header gradient styles for different table types */
    .core-web-vitals-table th { background: linear-gradient(to right, #991b1b, #b91c1c); }
    .mantle-metrics-table th { background: linear-gradient(to right, #b45309, #d97706); }
    .pageload-table th { background: linear-gradient(to right, #065f46, #047857); }
    .protocol-ttfb-table th { background: linear-gradient(to right, #4338ca, #4f46e5); }
    .protocol-ttlb-table th { background: linear-gradient(to right, #6b21a8, #7e22ce); }
    .resource-type-table th { background: linear-gradient(to right, #991b1b, #b91c1c); }
    .top-resources-table th { background: linear-gradient(to right, #6b21a8, #7e22ce); }
    td {
      padding: 14px 16px;
      border-bottom: 1px solid #e5e7eb;
      background-color: #fff;
      transition: background-color 0.2s ease;
    }
    tr:nth-child(even) td { 
      background-color: #f9fafb;
    }
    /* Enhanced row hover effect with data visualization */
    tr {
      position: relative;
    }
    tr:hover td { 
      background-color: #eef2ff !important;
      transform: translateY(-1px);
      box-shadow: 0 2px 4px rgba(0,0,0,0.05);
    }
    
    /* Add data visualization with bars for numeric cells */
    td:nth-child(n+2) {
      position: relative;
    }
    
    td:nth-child(n+2)::before {
      content: '';
      position: absolute;
      left: 0;
      bottom: 0;
      height: 3px;
      width: 0;
      background: linear-gradient(to right, #3b82f6, #10b981);
      opacity: 0.5;
      transition: width 0.3s ease;
    }
    
    /* Show the bars on hover */
    tr:hover td:nth-child(n+2)::before {
      width: calc(100% * var(--data-percent, 0.5));
    }
    .metrics-section {
      margin-bottom: 32px;
    }

    /* Enhanced Section Title Style */
    .section-title, .metrics-header, .section-header {
      color: #111827;
      font-size: 22px;
      font-weight: 700;
      margin: 48px 0 16px 0;
      position: relative;
      display: inline-block;
      padding-bottom: 8px;
      background-color: transparent !important;
      border: none !important;
    }
    .section-title::after, .metrics-header::after, .section-header::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 0;
      width: 60px;
      height: 4px;
      background: linear-gradient(90deg, #6366f1, #8b5cf6);
      border-radius: 4px;
    }

    /* Subtle Medium Table Header Colors */
    .overall-head th, .overall-table th, .overall-summary-table th { 
      background: linear-gradient(to right, #4338ca, #4f46e5) !important; /* subtle indigo */
    }
    .html-head th, .timing-breakdown th { 
      background: linear-gradient(to right, #065f46, #047857) !important; /* subtle green */
    }
    .nonhtml-head th, .mantle-metrics-table th, .transaction-stats-table th { 
      background: linear-gradient(to right, #b45309, #d97706) !important; /* subtle amber */
    }
    .resource-head th, .resource-type-table th, .core-web-vitals-table th { 
      background: linear-gradient(to right, #991b1b, #b91c1c) !important; /* subtle red */
    }
    .network-head th, .top-resources-table th { 
      background: linear-gradient(to right, #6b21a8, #7e22ce) !important; /* subtle purple */
    }

    /* Compact Top Legend Styles */
    .color-legend {
      display: flex;
      flex-wrap: wrap;
      margin: 0 0 24px 0;
      gap: 10px;
      padding: 12px 16px;
      border-radius: 8px;
      background-color: #f9fafb;
      box-shadow: 0 2px 6px rgba(0,0,0,0.05);
    }
    .color-legend-item { 
      display: flex;
      align-items: center;
      font-size: 13px;
      margin-right: 8px;
      font-weight: 500;
      color: #4b5563;
    }
    .swatch { 
      width: 14px;
      height: 14px;
      margin-right: 6px;
      border-radius: 3px;
      flex-shrink: 0;
    }
    /* Match swatches to table header colors */
    .color-legend-item:nth-child(1) .swatch { background: linear-gradient(to right, #4338ca, #4f46e5); }
    .color-legend-item:nth-child(2) .swatch { background: linear-gradient(to right, #065f46, #047857); }
    .color-legend-item:nth-child(3) .swatch { background: linear-gradient(to right, #b45309, #d97706); }
    .color-legend-item:nth-child(4) .swatch { background: linear-gradient(to right, #991b1b, #b91c1c); }
    .color-legend-item:nth-child(5) .swatch { background: linear-gradient(to right, #6b21a8, #7e22ce); }
    
    /* Compact Bottom Legend Styles */
    .metrics-legend {
      margin-top: 40px;
      padding: 16px;
      background-color: #f9fafb;
      border-radius: 8px;
      border-left: 3px solid #6366f1;
      box-shadow: 0 2px 6px rgba(0,0,0,0.05);
      font-size: 12px;
    }
    .metrics-legend h3 {
      margin-top: 0;
      margin-bottom: 12px;
      color: #111827;
      font-size: 16px;
      font-weight: 600;
    }
    .metrics-legend dl {
      display: grid;
      grid-template-columns: 1fr 3fr;
      row-gap: 10px;
      column-gap: 16px;
      margin: 0;
    }
    .metrics-legend dt {
      font-weight: 600;
      color: #374151;
      font-size: 12px;
    }
    .metrics-legend dd {
      margin-left: 0;
      color: #4b5563;
      font-size: 12px;
      line-height: 1.5;
    }
    
    /* Enhanced Resource Icons */
    .resource-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      margin-right: 8px;
      vertical-align: middle;
      border-radius: 6px;
      color: white;
      font-size: 13px;
      font-weight: 600;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    .resource-icon:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 6px rgba(0,0,0,0.15);
    }
    .resource-icon.js { background: linear-gradient(135deg, #f7df1e, #eac100); color: #323330; }
    .resource-icon.css { background: linear-gradient(135deg, #2965f1, #2050d3); }
    .resource-icon.img { background: linear-gradient(135deg, #4ade80, #22c55e); }
    .resource-icon.font { background: linear-gradient(135deg, #fb923c, #ea580c); }
    .resource-icon.html { background: linear-gradient(135deg, #e34c26, #c53d1e); }
    .resource-icon.other { background: linear-gradient(135deg, #94a3b8, #64748b); }
    
    /* Enhanced Alert Messages */
    .alert {
      padding: 16px 20px;
      margin: 20px 0;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.05);
    }
    .alert-warning {
      background-color: #fffbeb;
      border-left: 5px solid #f59e0b;
      color: #92400e;
    }
    
    /* Enhanced Badge Styles */
    .badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      margin-left: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.05);
    }
    .badge-primary {
      background: linear-gradient(135deg, #e0e7ff, #c7d2fe);
      color: #4338ca;
    }
    .badge-success {
      background: linear-gradient(135deg, #dcfce7, #bbf7d0);
      color: #15803d;
    }

    /* Resource Details Hover Card */
    .resource-details {
      padding: 10px;
      margin-bottom: 8px;
      border-radius: 8px;
      border: 1px solid #e5e7eb;
      transition: all 0.2s ease;
    }
    .resource-details:hover {
      background-color: #f0f9ff;
      border-color: #bfdbfe;
      box-shadow: 0 4px 12px rgba(59, 130, 246, 0.1);
      transform: translateY(-2px);
    }
    .resource-details strong {
      color: #1e40af;
    }
    .resource-details small {
      display: block;
      margin-top: 4px;
      color: #64748b;
    }
    
    /* Legend Styles */
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 15px;
      margin-bottom: 25px;
      padding: 15px;
      background: #fff;
      border-radius: 8px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.05);
    }
    .legend-section {
      margin-bottom: 2rem;
      padding: 1.5rem;
      background-color: #fff;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }

    .legend-container {
      display: flex;
      flex-wrap: wrap;
      gap: 1.5rem;
      margin-bottom: 1.5rem;
    }

    .legend-item {
      display: flex;
      align-items: center;
      margin-right: 1.5rem;
    }

    .legend-color {
      width: 16px;
      height: 16px;
      border-radius: 4px;
      margin-right: 8px;
    }
    
    .metrics-legend {
      margin-top: 1.5rem;
      border-top: 1px solid #e5e7eb;
      padding-top: 1.5rem;
    }
    
    /* Resource type legend */
    .resource-type-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
      margin-bottom: 1rem;
      padding: 0.75rem;
      background-color: #f9fafb;
      border-radius: 0.5rem;
    }
    
    .resource-type-legend-item {
      display: flex;
      align-items: center;
      font-size: 0.85rem;
    }
    
    /* Header styles matching browser report */
    .overall-summary-header {
      background: linear-gradient(to right, #4f46e5, #6366f1);
      color: white;
      padding: 0.75rem 1rem;
      border-radius: 0.5rem 0.5rem 0 0;
    }
    
    .html-performance-header {
      background: linear-gradient(to right, #065f46, #047857);
      color: white;
      padding: 0.75rem 1rem;
      border-radius: 0.5rem 0.5rem 0 0;
    }
    
    .nonhtml-performance-header {
      background: linear-gradient(to right, #4338ca, #4f46e5);
      color: white;
      padding: 0.75rem 1rem;
      border-radius: 0.5rem 0.5rem 0 0;
    }
    
    .resource-type-header {
      background: linear-gradient(to right, #991b1b, #b91c1c);
      color: white;
      padding: 0.75rem 1rem;
      border-radius: 0.5rem 0.5rem 0 0;
    }
    
    .network-analysis-header {
      background: linear-gradient(to right, #6b21a8, #7e22ce);
      color: white;
      padding: 0.75rem 1rem;
      border-radius: 0.5rem 0.5rem 0 0;
    }
    
    .top-resources-header {
      background: linear-gradient(to right, #b45309, #d97706);
      color: white;
      padding: 0.75rem 1rem;
      border-radius: 0.5rem 0.5rem 0 0;
    }
    
    .metrics-legend h4 {
      margin-top: 0;
      margin-bottom: 1rem;
      font-size: 1.1rem;
    }
    
    .metrics-legend dl {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 1rem;
      margin: 0;
    }
    
    .metrics-legend dt {
      font-weight: 600;
      color: #4b5563;
      margin-bottom: 0.25rem;
    }
    
    .metrics-legend dd {
      margin-left: 0;
      margin-bottom: 1rem;
      color: #6b7280;
      font-size: 0.9rem;
    }
    
    /* Resource cards styling */
    .resource-cards-cell {
      padding: 0 !important;
    }
    
    /* Resource type badges */
    .resource-type-badge {
      display: inline-block;
      padding: 0.25rem 0.5rem;
      border-radius: 0.25rem;
      font-size: 0.85rem;
      font-weight: 500;
      color: white;
    }
    
    .resource-type-badge.html {
      background-color: #047857;
    }
    
    .resource-type-badge.nonhtml {
      background-color: #4f46e5;
    }
    
    /* Tooltip styles */
    [data-tooltip] {
      position: relative;
      cursor: pointer;
    }
    
    [data-tooltip]:hover:after {
      content: attr(data-tooltip);
      position: absolute;
      bottom: 100%;
      left: 0;
      background-color: #333;
      color: white;
      padding: 5px 8px;
      border-radius: 4px;
      white-space: nowrap;
      font-size: 12px;
      z-index: 10;
      max-width: 300px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    
    /* Metrics explanation styles */
    .metrics-explanation {
      margin-top: 1.5rem;
      padding: 1.5rem;
      border-radius: 0.5rem;
      background-color: #f5f7ff;
      border-left: 4px solid #4338ca;
    }
    
    .metrics-explanation h4 {
      margin-top: 0;
      margin-bottom: 1rem;
      color: #1f2937;
    }
    
    .metrics-explanation-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 1.5rem;
    }
    
    .metrics-explanation-item h5 {
      margin-top: 0;
      margin-bottom: 0.5rem;
      color: #4338ca;
      font-weight: 600;
    }
    
    .metrics-explanation-item p {
      margin: 0;
      color: #4b5563;
      font-size: 0.9rem;
      line-height: 1.5;
    }
    
    /* Summary stats styles */
    .summary-stats {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin: 1.5rem 0;
    }
    
    .summary-stat-item {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
    }
    
    .summary-stat-value {
      font-size: 2rem;
      font-weight: 700;
      color: #1f2937;
      line-height: 1;
    }
    
    .summary-stat-label {
      font-size: 1rem;
      color: #6b7280;
      margin-top: 0.25rem;
    }
    
    .resource-card {
      display: flex;
      padding: 0.75rem;
      border-bottom: 1px solid #f3f4f6;
    }
    
    .resource-card:last-child {
      border-bottom: none;
    }
    
    .resource-type {
      width: 24px;
      height: 24px;
      border-radius: 4px;
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      margin-right: 0.75rem;
      flex-shrink: 0;
    }
    
    .resource-type.js {
      background-color: #f59e0b;
    }
    
    .resource-type.css {
      background-color: #3b82f6;
    }
    
    .resource-type.image, .resource-type.img {
      background-color: #10b981;
    }
    
    .resource-type.font {
      background-color: #8b5cf6;
    }
    
    .resource-type.other {
      background-color: #6b7280;
    }
    
    .resource-info {
      flex: 1;
      min-width: 0;
    }
    
    .resource-url {
      font-size: 0.85rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: #4b5563;
    }
    
    .resource-stats {
      font-size: 0.8rem;
      color: #6b7280;
      margin-top: 0.25rem;
    }
    

    /* Interactive tooltip styles */
    [data-tooltip] {
      position: relative;
      cursor: help;
    }
    [data-tooltip]:before {
      content: attr(data-tooltip);
      position: absolute;
      bottom: 100%;
      left: 50%;
      transform: translateX(-50%);
      margin-bottom: 8px;
      padding: 8px 12px;
      border-radius: 6px;
      background-color: #334155;
      color: white;
      text-align: center;
      font-size: 13px;
      font-weight: normal;
      line-height: 1.4;
      z-index: 100;
      white-space: nowrap;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      opacity: 0;
      visibility: hidden;
      transition: all 0.2s ease;
    }
    [data-tooltip]:hover:before {
      opacity: 1;
      visibility: visible;
    }
  </style>
  `;
}

// From process-k6-results.js
function buildHtmlMetricsTable(metricNameDisplay, metricData, templates, statCalculator) {
  if (!metricData || !templates || !Array.isArray(templates) || templates.length === 0) {
    return '<p>No data available for this metric.</p>';
  }
  const precision = metricNameDisplay.includes('CLS') ? 4 : 2;
  const unitSuffix = metricNameDisplay.includes('CLS') ? '' : ' (ms)';
  
  let tableClass = '';
  if (metricNameDisplay.includes('LCP') || metricNameDisplay.includes('FCP') || 
      metricNameDisplay.includes('CLS') || metricNameDisplay.includes('TTFB Browser')) {
    tableClass = 'core-web-vitals-table';
  } else if (metricNameDisplay.includes('Mantle')) {
    tableClass = 'mantle-metrics-table';
  } else if (metricNameDisplay.includes('Page Load Time')) {
    tableClass = 'pageload-table';
  } else if (metricNameDisplay.includes('TTFB')) {
    tableClass = 'protocol-ttfb-table';
  } else if (metricNameDisplay.includes('TTLB')) {
    tableClass = 'protocol-ttlb-table';
  }
  
  let table = `<table class="${tableClass}"><thead><tr><th>Template</th><th>Requests</th><th>Min${unitSuffix}</th><th>Max${unitSuffix}</th><th>Avg${unitSuffix}</th><th>Median${unitSuffix}</th><th>p90${unitSuffix}</th><th>p95${unitSuffix}</th><th>p99${unitSuffix}</th></tr></thead><tbody>`;
  
  let hasAnyData = false;
  const sortedTemplates = Array.from(templates).sort();
  
  sortedTemplates.forEach(template => {
    const values = metricData[template] || [];
    if (values.length > 0) {
      hasAnyData = true;
      const stats = statCalculator(values.some(v => v > 0) ? values : [0]);
      table += `<tr><td>${template}</td><td>${stats.count}</td><td>${stats.min.toFixed(precision)}</td><td>${stats.max.toFixed(precision)}</td><td>${stats.avg.toFixed(precision)}</td><td>${stats.median.toFixed(precision)}</td><td>${stats.p90.toFixed(precision)}</td><td>${stats.p95.toFixed(precision)}</td><td>${stats.p99.toFixed(precision)}</td></tr>`;
    }
  });
  
  table += '</tbody></table>';
  
  if (!hasAnyData) {
    return '<p>No data available for this metric.</p>';
  }
  
  return table;
}

function buildHtmlPassFailMetricsTable(metricData, templates, cssClass = '') {
  if (!metricData || !templates || !Array.isArray(templates) || templates.length === 0) {
    return '<p>No data available for pass/fail metrics.</p>';
  }
  
  let tableClass = cssClass || 'pageload-table';
  let table = `<table class="${tableClass}"><thead><tr><th>Template</th><th>Requests</th><th>Passes</th><th>Fails</th><th>Pass Rate</th></tr></thead><tbody>`;
  
  let hasAnyData = false;
  const sortedTemplates = Array.from(templates).sort();
  
  sortedTemplates.forEach(template => {
    if (metricData[template]) {
      let requests = 0;
      let passes = 0;
      let fails = 0;
      
      if (Array.isArray(metricData[template])) {
        requests = metricData[template].length;
        passes = metricData[template].filter(v => v === 1).length;
        fails = metricData[template].filter(v => v === 0).length;
      } else {
        requests = metricData[template].requests || 0;
        passes = metricData[template].passes || 0;
        fails = metricData[template].fails || 0;
      }
      
      if (requests > 0) {
        hasAnyData = true;
        const passRate = (passes / requests * 100).toFixed(2) + '%';
        table += `<tr><td>${template}</td><td>${requests}</td><td>${passes}</td><td>${fails}</td><td>${passRate}</td></tr>`;
      }
    }
  });
  
  table += '</tbody></table>';
  
  if (!hasAnyData) {
    return '<p>No data available for pass/fail metrics.</p>';
  }
  
  return table;
}

function buildPageLoadBreakdownTable(data, templates, stat = null, tableClass = 'timing-breakdown') {
  const getStats = (metricName, transaction) => {
    if (!data[metricName] || 
        !data[metricName][transaction] || 
        !Array.isArray(data[metricName][transaction]) || 
        data[metricName][transaction].length === 0) {
      return { avg: 0, p90: 0 };
    }
    // calculateStats is imported in report-helpers.js
    const statsSummary = calculateStats(data[metricName][transaction]);
    return { avg: statsSummary.avg, p90: statsSummary.p90 };
  };
  
  // If stat is specified, use the old single-column format
  if (stat === 'avg' || stat === 'p90') {
    let html = `<table class="${tableClass}"><thead><tr>` +
      '<th>Template</th>' +
      '<th>Network Transfer Time (ms)</th>' +
      '<th>Server Processing (ms)</th>' +
      '<th>DOM Processing (ms)</th>' +
      '<th>Script Parsing (ms)</th>' +
      '<th>Script Execution (ms)</th>' +
      '<th>Other Client Processing (ms)</th>' +
      '<th>Total Page Load Time (ms)</th>' +
      '</tr></thead><tbody>';
      
    templates.forEach(tmpl => {
      const network = getStats('networkTime', tmpl)[stat];
      const server = getStats('serverProcessingTime', tmpl)[stat];
      const dom = getStats('domProcessingTime', tmpl)[stat];
      const scriptParse = getStats('scriptParsingTime', tmpl)[stat];
      const scriptExec = getStats('scriptExecutionTime', tmpl)[stat];
      const total = getStats('pageLoadTime', tmpl)[stat];
      
      const client = total - server;
      const measured = Math.max(0, network - server) + dom + scriptParse + scriptExec;
      const other = Math.max(0, client - measured);
      
      html += `<tr><td>${tmpl}</td><td>${Math.max(0, network - server).toFixed(2)}</td><td>${server.toFixed(2)}</td><td>${dom.toFixed(2)}</td><td>${scriptParse.toFixed(2)}</td><td>${scriptExec.toFixed(2)}</td><td>${other.toFixed(2)}</td><td>${total.toFixed(2)}</td></tr>`;
    });
    
    html += '</tbody></table>';
    return html;
  }
  
  // New format with both avg and p90 columns for each metric
  let html = `<table class="${tableClass}"><thead><tr>` +
    '<th rowspan="2">Template</th>' +
    '<th colspan="2">Network Transfer</th>' +
    '<th colspan="2">Server Processing</th>' +
    '<th colspan="2">DOM Processing</th>' +
    '<th colspan="2">Script Parsing</th>' +
    '<th colspan="2">Script Execution</th>' +
    '<th colspan="2">Other Client</th>' +
    '<th colspan="2">Total Page Load</th>' +
    '</tr><tr>' +
    '<th>Avg</th><th>p90</th>' +
    '<th>Avg</th><th>p90</th>' +
    '<th>Avg</th><th>p90</th>' +
    '<th>Avg</th><th>p90</th>' +
    '<th>Avg</th><th>p90</th>' +
    '<th>Avg</th><th>p90</th>' +
    '<th>Avg</th><th>p90</th>' +
    '</tr></thead><tbody>';
    
  templates.forEach(tmpl => {
    const network = getStats('networkTime', tmpl);
    const server = getStats('serverProcessingTime', tmpl);
    const dom = getStats('domProcessingTime', tmpl);
    const scriptParse = getStats('scriptParsingTime', tmpl);
    const scriptExec = getStats('scriptExecutionTime', tmpl);
    const total = getStats('pageLoadTime', tmpl);
    
    // Calculate client-side metrics for both avg and p90
    const client = {
      avg: total.avg - server.avg,
      p90: total.p90 - server.p90
    };
    
    const measured = {
      avg: Math.max(0, network.avg - server.avg) + dom.avg + scriptParse.avg + scriptExec.avg,
      p90: Math.max(0, network.p90 - server.p90) + dom.p90 + scriptParse.p90 + scriptExec.p90
    };
    
    const other = {
      avg: Math.max(0, client.avg - measured.avg),
      p90: Math.max(0, client.p90 - measured.p90)
    };
    
    const networkTransfer = {
      avg: Math.max(0, network.avg - server.avg),
      p90: Math.max(0, network.p90 - server.p90)
    };
    
    html += `<tr>
      <td>${tmpl}</td>
      <td>${networkTransfer.avg.toFixed(2)}</td>
      <td>${networkTransfer.p90.toFixed(2)}</td>
      <td>${server.avg.toFixed(2)}</td>
      <td>${server.p90.toFixed(2)}</td>
      <td>${dom.avg.toFixed(2)}</td>
      <td>${dom.p90.toFixed(2)}</td>
      <td>${scriptParse.avg.toFixed(2)}</td>
      <td>${scriptParse.p90.toFixed(2)}</td>
      <td>${scriptExec.avg.toFixed(2)}</td>
      <td>${scriptExec.p90.toFixed(2)}</td>
      <td>${other.avg.toFixed(2)}</td>
      <td>${other.p90.toFixed(2)}</td>
      <td>${total.avg.toFixed(2)}</td>
      <td>${total.p90.toFixed(2)}</td>
    </tr>`;
  });
  
  html += '</tbody></table>';
  return html;
}

function buildEnhancedSummaryTable(data, templates) {
  const serverStats = calculateAggregateStats(data.server_processing_time);
  const totalStats = calculateAggregateStats(data.page_load_time);
  
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
  
  let html = '<h3>Page Load Performance Summary</h3><div class="color-legend"><div class="legend-container">';
  
  html += `
    <div class="legend-item">
      <span class="legend-color" style="background: linear-gradient(to right, #065f46, #047857);"></span>
      <span class="legend-label">HTML Resources</span>
    </div>
    <div class="legend-item">
      <span class="legend-color" style="background: linear-gradient(to right, #4338ca, #4f46e5);"></span>
      <span class="legend-label">Non-HTML Resources</span>
    </div>
    <div class="legend-item">
      <span class="legend-color" style="background: linear-gradient(to right, #6b21a8, #7e22ce);"></span>
      <span class="legend-label">Resource Analysis</span>
    </div>
    <div class="legend-item">
      <span class="legend-color" style="background: linear-gradient(to right, #991b1b, #b91c1c);"></span>
      <span class="legend-label">Resource Types</span>
    </div>
    <div class="legend-item">
      <span class="legend-color" style="background: linear-gradient(to right, #b45309, #d97706);"></span>
      <span class="legend-label">Top Resources</span>
    </div>
  `;
  
  html += '</div></div>';

  html += '<table class="overall-summary-table"><thead><tr><th>Component</th><th>Avg (ms)</th><th>Median (ms)</th><th>p90 (ms)</th><th>% of Total</th></tr></thead><tbody>';
  
  html += `<tr class="total-row"><td>Total Page Load Time</td><td>${totalStats.avg.toFixed(2)}</td><td>${totalStats.median.toFixed(2)}</td><td>${totalStats.p90.toFixed(2)}</td><td>100.0%</td></tr>`;
  
  const serverPct = totalStats.avg > 0 ? (serverStats.avg / totalStats.avg * 100).toFixed(1) : '0.0';
  html += `<tr class="server-row"><td>Server Processing (TTFB)</td><td>${serverStats.avg.toFixed(2)}</td><td>${serverStats.median.toFixed(2)}</td><td>${serverStats.p90.toFixed(2)}</td><td>${serverPct}%</td></tr>`;
  
  const clientPct = totalStats.avg > 0 ? (clientSideStats.avg / totalStats.avg * 100).toFixed(1) : '0.0';
  html += `<tr class="client-row"><td>Client-Side Processing</td><td>${clientSideStats.avg.toFixed(2)}</td><td>${clientSideStats.median.toFixed(2)}</td><td>${clientSideStats.p90.toFixed(2)}</td><td>${clientPct}%</td></tr>`;
  
  html += '</tbody></table>';
  
  html += '<h3>Client-Side Timing Breakdown (Average)</h3>';
  html += buildPageLoadBreakdownTable(data, templates, 'avg', 'core-web-vitals-table');
  html += '<h3>Client-Side Timing Breakdown (90th Percentile)</h3>';
  html += buildPageLoadBreakdownTable(data, templates, 'p90', 'core-web-vitals-table');

  // Legend removed as requested

  if (data.resource_details) {
    html += '<h3 class="core-web-vitals-table">Network Resources Statistics By Transaction</h3>';
    
    templates.forEach(transaction => {
      html += `<h4>Transaction: ${transaction}</h4>`;
      html += '<table class="top-resource-table transaction-resources core-web-vitals-table"><thead><tr><th>Resource Type</th><th>Request Count</th><th>Total Size (KB)</th><th>Avg Size (KB)</th><th>Time (Avg ms)</th><th>Time (Median ms)</th><th>Time (p90 ms)</th><th>Success Rate</th></tr></thead><tbody>';
      
      const resourceTypeStats = {
        js: { type: 'JavaScript', times: [], sizes: [], errors: 0, totalRequests: 0 },
        css: { type: 'CSS', times: [], sizes: [], errors: 0, totalRequests: 0 },
        img: { type: 'Images', times: [], sizes: [], errors: 0, totalRequests: 0 },
        font: { type: 'Fonts', times: [], sizes: [], errors: 0, totalRequests: 0 },
        other: { type: 'Other', times: [], sizes: [], errors: 0, totalRequests: 0 }
      };
      
      ['js', 'css', 'img', 'font', 'other'].forEach(type => {
        if (data.resource_details[type]) {
          data.resource_details[type].forEach(r => {
            const resourceTransaction = r.tags?.transaction || getTransactionName(r.tags || {});
            if (resourceTransaction !== transaction) return;
            
            resourceTypeStats[type].totalRequests++;
            resourceTypeStats[type].times.push(r.duration);
            resourceTypeStats[type].sizes.push(r.size || 0);
            
            if (r.status && r.status >= 400) {
              resourceTypeStats[type].errors++;
            }
          });
        }
      });
      
      const resourceStats = Object.entries(resourceTypeStats).map(([, stats]) => {
        if (stats.times.length === 0) return null;
        
        const sorted = stats.times.slice().sort((a,b)=>a-b);
        const avg = sorted.reduce((a,b)=>a+b,0)/sorted.length || 0;
        const median = sorted.length ? (sorted.length % 2 === 1 ? sorted[Math.floor(sorted.length/2)] : (sorted[sorted.length/2-1] + sorted[sorted.length/2])/2) : 0;
        const p90 = sorted.length ? sorted[Math.floor(0.9*sorted.length)] : 0;
        const totalKB = stats.sizes.reduce((a,b)=>a+b,0)/1024;
        const avgKB = stats.totalRequests ? totalKB/stats.totalRequests : 0;
        const successRate = stats.totalRequests ? ((stats.totalRequests - stats.errors) / stats.totalRequests * 100).toFixed(1) : '100.0';
        
        return {
          type: stats.type,
          requests: stats.totalRequests,
          totalKB,
          avgKB,
          avg,
          median,
          p90,
          successRate
        };
      }).filter(Boolean);
      
      resourceStats.sort((a,b) => b.requests - a.requests);
      
      if (resourceStats.length === 0) {
        html += '<tr><td colspan="8">No network resource data found for this transaction. Ensure your browser script emits browser_resource_* metrics with proper transaction tags.</td></tr>';
      } else {
        resourceStats.forEach(stat => {
          const getTimeColor = (time) => {
            if (time > 1000) return 'red';
            if (time > 500) return 'orange';
            return 'green';
          };
          
          const avgTimeColor = getTimeColor(stat.avg);
          const medianTimeColor = getTimeColor(stat.median);
          const p90TimeColor = getTimeColor(stat.p90);
          
          const successRateNum = parseFloat(stat.successRate);
          const successRateColor = successRateNum < 95 ? 'red' : 'green';
          
          html += `
          <tr>
            <td><strong>${stat.type}</strong></td>
            <td>${stat.requests}</td>
            <td>${stat.totalKB.toFixed(1)} KB</td>
            <td>${stat.avgKB.toFixed(1)} KB</td>
            <td style="color:${avgTimeColor};">${stat.avg.toFixed(0)}</td>
            <td style="color:${medianTimeColor};">${stat.median.toFixed(0)}</td>
            <td style="color:${p90TimeColor};">${stat.p90.toFixed(0)}</td>
            <td style="color:${successRateColor};">${stat.successRate}%</td>
          </tr>`;
        });
      }
      
      html += '</tbody></table>';
      
      if (data.page_load_time && data.page_load_time[transaction] && data.page_load_time[transaction].length > 0 &&
          data.server_processing_time && data.server_processing_time[transaction] && data.server_processing_time[transaction].length > 0) {
        
        const pageLoadTimes = data.page_load_time[transaction].slice().sort((a, b) => a - b);
        const serverTimes = data.server_processing_time[transaction].slice().sort((a, b) => a - b);
        
        const avgPageLoad = pageLoadTimes.reduce((a, b) => a + b, 0) / pageLoadTimes.length;
        const avgServer = serverTimes.reduce((a, b) => a + b, 0) / serverTimes.length;
        const avgClient = avgPageLoad - avgServer;
        
        const clientPct = avgPageLoad > 0 ? (avgClient / avgPageLoad * 100).toFixed(1) : '0.0';
        
        html += `<div class="template-summary">Client-side processing accounts for <strong>${clientPct}%</strong> of the total page load time for this transaction.</div>`;
      }
    });
    
    html += `<div class="legend">
      <b>Top 5 Network Resources Per Transaction</b>: This table shows the slowest network resources for each transaction (similar to Chrome's Network tab).
      <ul>
        <li><strong>Type</strong>: Resource type (js, css, img, font, other)</li>
        <li><strong>Resource URL</strong>: The resource filename, domain, and full URL</li>
        <li><strong>Requests</strong>: Number of times this resource was requested</li>
        <li><strong>Size</strong>: Total KB downloaded for this resource</li>
        <li><strong>Time</strong>: Download time in ms (Average, Median, 90th percentile)</li>
        <li><strong>Status</strong>: HTTP status code (green = success, red = error)</li>
      </ul>
      <p>Times are color-coded: <span style="color:green;">green</span> = under 500ms, <span style="color:orange;">orange</span> = 500ms-1s, <span style="color:red;">red</span> = over 1s</p>
    </div>`;
  }

  html += `
  <style>
    /* Styles moved to generateReportStyles */
  </style>
  `;
  
  return html;
}

function buildResourceTypeByTransactionTable(data, templates) {
  if (!data || !templates || !Array.isArray(templates) || templates.length === 0 || !data.resource_details) {
    return '<p>No resource data available.</p>';
  }
  
  // Build the table header with resource types using modern styling
  let html = `
  <table class="top-resources-table">
  <thead class="network-head">
    <tr>
      <th>Transaction</th>
      <th>Total Requests</th>
      <th>Avg Size</th>
      <th>Avg Time</th>
      <th>p90 Time</th>
      <th>Success Rate</th>
      <th>Top 5 Resources (By Avg Size)</th>
      <th>Top 5 Resources (By Avg Time)</th>
    </tr>
  </thead>
  <tbody>`;
  
  const resourceTypes = ['js', 'css', 'img', 'font', 'other', 'html'];
  const typeLabels = {
    js: '<span class="resource-icon js-icon"></span> JavaScript',
    css: '<span class="resource-icon css-icon"></span> CSS',
    img: '<span class="resource-icon img-icon"></span> Images',
    font: '<span class="resource-icon font-icon"></span> Fonts',
    html: '<span class="resource-icon html-icon"></span> HTML',
    other: '<span class="resource-icon other-icon"></span> Other'
  };
  
  let hasAnyData = false;
  
  templates.forEach(template => {
    let firstRow = true;
    let hasResourcesForTemplate = false;
    
    resourceTypes.forEach(type => {
      const resources = Array.isArray(data.resource_details[type]) ? 
        data.resource_details[type].filter(r => {
          const resourceTransaction = r.transaction || 
                                     (r.tags ? (r.tags.transaction || getTransactionName(r.tags)) : null);
          return resourceTransaction === template;
        }) : [];
      
      if (resources.length > 0) {
        hasAnyData = true;
        hasResourcesForTemplate = true;
        
        const times = resources.map(r => r.duration).filter(t => t !== undefined && t !== null);
        const sizes = resources.map(r => r.size).filter(s => s !== undefined && s !== null);
        
        const timeStats = calculateStats(times.length > 0 ? times : [0]);
        const totalSize = sizes.reduce((sum, size) => sum + size, 0) / 1024;
        const avgSize = sizes.length > 0 ? totalSize / sizes.length : 0;
        
        const successCount = resources.filter(r => r.status >= 200 && r.status < 400).length;
        const successRate = resources.length > 0 ? (successCount / resources.length) * 100 : 100;
        
        html += `<tr>
          <td>${firstRow ? template : ''}</td>
          <td>${typeLabels[type]}</td>
          <td>${resources.length}</td>
          <td>${totalSize.toFixed(2)}</td>
          <td>${avgSize.toFixed(2)}</td>
          <td>${timeStats.avg.toFixed(2)}</td>
          <td>${successRate.toFixed(2)}%</td>
        </tr>`;
        
        firstRow = false;
      }
    });
    
    if (hasResourcesForTemplate && templates.indexOf(template) < templates.length - 1) {
      html += '<tr><td colspan="7" style="height: 10px; background-color: #f0f0f0;"></td></tr>';
    }
  });
  
  html += '</tbody></table>';
  
  if (!hasAnyData) {
    return '<p>No resource data available for these transactions.</p>';
  }
  
  return html;
}

function buildTop5NetworkResourcesTable(data, templates = [], resourceTypes = ['js', 'css', 'img', 'font', 'other', 'html']) {
  // Create a global map of all resources by URL across all transactions
  const globalResourcesByUrl = {};
  if (!data || !data.resource_details) {
    return '<p>No network resource data available.</p>';
  }
  
  // First, populate the global resource map with all resources across all transactions
  resourceTypes.forEach(type => {
    if (data.resource_details[type]) {
      data.resource_details[type].forEach(resource => {
        const url = resource.url;
        if (!globalResourcesByUrl[url]) {
          globalResourcesByUrl[url] = {
            type: type,
            requests: [],
            transactionCounts: {}
          };
        }
        globalResourcesByUrl[url].requests.push(resource);
        
        // Track requests per transaction
        const transaction = resource.transaction || 'unknown';
        if (!globalResourcesByUrl[url].transactionCounts[transaction]) {
          globalResourcesByUrl[url].transactionCounts[transaction] = 0;
        }
        globalResourcesByUrl[url].transactionCounts[transaction]++;
      });
    }
  });
  
  // Use the provided templates or extract unique transactions from resources
  const uniqueTransactions = templates.length > 0 ? templates : [];
  if (uniqueTransactions.length === 0) {
    resourceTypes.forEach(type => {
      if (data.resource_details[type]) {
        data.resource_details[type].forEach(resource => {
          let transactionName = 'N/A';
          if (resource.transaction && typeof resource.transaction === 'string') {
            transactionName = resource.transaction;
          } else if (resource.tags && resource.tags.transaction && typeof resource.tags.transaction === 'string') {
            transactionName = resource.tags.transaction;
          } else if (resource.tags && typeof resource.tags.template === 'string') {
            transactionName = resource.tags.template;
          }
          
          if (transactionName !== 'N/A' && !uniqueTransactions.includes(transactionName)) {
            uniqueTransactions.push(transactionName);
          }
        });
      }
    });
  }
  
  if (uniqueTransactions.length === 0) {
    return '<p>No transaction data found in resources.</p>';
  }

  // Create a single table with one row per transaction
  let html = ''; // Remove duplicate heading since it's added in the main report generator
  
  // Add table opening tags with proper styling
  html += '<table class="top-resources-table"><thead class="network-head"><tr><th>Transaction</th><th>Total Requests</th><th>Avg Size</th><th>Avg Time</th><th>p90 Time</th><th>Success Rate</th><th>Top 5 Resources (By Avg Size)</th><th>Top 5 Resources (By Avg Time)</th></tr></thead><tbody>';
  
  // We've centralized all CSS in generateReportStyles() function, so no need for inline styles here
  
  // Function to get a short URL display
  const getShortUrl = (url) => {
    if (!url || url === 'N/A') return 'N/A';
    
    try {
      // Try to parse as URL
      const urlObj = new URL(url);
      
      // Get the filename from the path
      const pathParts = urlObj.pathname.split('/');
      let filename = pathParts[pathParts.length - 1];
      
      // If no filename, use the hostname
      if (!filename || filename === '') {
        return urlObj.hostname;
      }
      
      // If filename is very short, add some path context
      if (filename.length < 8 && pathParts.length > 1) {
        const parentDir = pathParts[pathParts.length - 2];
        if (parentDir && parentDir !== '') {
          filename = parentDir + '/' + filename;
        }
      }
      
      // Limit to 15 chars max
      if (filename.length > 15) {
        filename = filename.substring(0, 12) + '...';
      }
      
      return filename;
    } catch {
      // If URL parsing fails, just take the last part of the path
      const parts = url.split('/');
      let filename = parts[parts.length - 1] || url;
      
      // Limit to 15 chars
      if (filename.length > 15) {
        filename = filename.substring(0, 12) + '...';
      }
      
      return filename;
    }
  };
  
  // Process each transaction
  uniqueTransactions.forEach(transaction => {
    // Collect all resources for this transaction
    let allTransactionResources = []; // Initialize here
    
    resourceTypes.forEach(type => {
      if (data.resource_details[type]) {
        // Match both exact transaction name and transaction_nonHTML
        const resourcesForTransaction = data.resource_details[type].filter(resource => 
          resource.transaction === transaction || 
          resource.transaction === `${transaction}_nonHTML`
        );
        allTransactionResources = allTransactionResources.concat(resourcesForTransaction.map(r => ({ ...r, type, size: r.size || 0 })));
      }
    });

    // Count the total number of non-HTML resource requests for this transaction
    // This should be the total count of all resource requests (JS, CSS, images, etc.) for this transaction
    let overallTotalRequests = 0;
    let nonHtmlResources = [];
    
    // Count all non-HTML resources for this transaction
    if (allTransactionResources && allTransactionResources.length > 0) {
      // Determine top 5 resources by average size (KB) and by avg time
      nonHtmlResources = allTransactionResources.filter(res => res.type !== 'html');
      
      // Use the actual count of non-HTML resources for this transaction
      overallTotalRequests = nonHtmlResources.length;
      

    }
    const overallDurations = nonHtmlResources.map(r => r.duration || 0);
    const overallTimeStats = calculateStats(overallDurations);
    const overallSizes = nonHtmlResources.map(r => r.size || 0); // Use actual size, defaulting to 0
    const overallTotalSizeBytes = overallSizes.reduce((sum, size) => sum + size, 0);
    const overallTotalSizeKB = overallTotalSizeBytes / 1024;
    const overallAvgSizeKB = overallTotalRequests > 0 ? overallTotalSizeKB / overallTotalRequests : 0;
    const overallSuccessfulRequests = nonHtmlResources.filter(r => r.status < 400).length;
    const overallSuccessRate = overallTotalRequests > 0 ? (overallSuccessfulRequests / overallTotalRequests) * 100 : 100;

    // Group resources by URL for this transaction - only use non-HTML resources
    const resourcesByUrl = {};
    nonHtmlResources.forEach(res => {
      const urlKey = res.url || res.originalUrl || res.requestUrl;
      if (!urlKey) return; // skip truly missing
      if (!resourcesByUrl[urlKey]) {
        resourcesByUrl[urlKey] = {
          url: urlKey,
          type: res.type,
          requests: [], // Store all individual requests for this URL
          totalRequests: 0,
          totalDuration: 0,
          totalSize: 0,
          successfulRequests: 0,
          // Add a map to track requests per transaction
          transactionCounts: {}
        };
      }
      resourcesByUrl[urlKey].requests.push(res);
      resourcesByUrl[urlKey].totalRequests++;
      resourcesByUrl[urlKey].totalDuration += (res.duration || 0);
      resourcesByUrl[urlKey].totalSize += (res.size || 0); // Use actual size, defaulting to 0
      
      // Track requests per transaction
      if (!resourcesByUrl[urlKey].transactionCounts[transaction]) {
        resourcesByUrl[urlKey].transactionCounts[transaction] = 0;
      }
      resourcesByUrl[urlKey].transactionCounts[transaction]++;
      
      if (res.status < 400) {
        resourcesByUrl[urlKey].successfulRequests++;
      }
    });

    // Calculate aggregated stats for each unique resource
    const uniqueResourceStats = Object.entries(resourcesByUrl).map(([url, data]) => {
      const avgTime = data.totalRequests > 0 ? data.totalDuration / data.totalRequests : 0;
      const avgSize = data.totalRequests > 0 ? (data.totalSize / data.totalRequests) / 1024 : 0; // in KB
      const successRate = data.totalRequests > 0 ? (data.successfulRequests / data.totalRequests) * 100 : 100;
      return {
        url,
        type: data.type,
        requests: data.totalRequests,
        avgTime,
        avgSize, // KB
        successRate
      };
    });

    // Sort unique resources primarily by request count (descending) so the most frequently-requested
    // files for this transaction appear first.  Use average time as the secondary key so that among
    // equally-frequent resources, the slower ones rise to the top.
    uniqueResourceStats.sort((a, b) => {
      if (b.requests !== a.requests) return b.requests - a.requests;
      return b.avgTime - a.avgTime;
    });
    // Sort resources by average time for later use
    const resourcesByTime = [...uniqueResourceStats]
      .sort((a, b) => b.avgTime - a.avgTime)
      .slice(0, 5);

    // Add rows for each transaction
    html += `<tr>
      <td>${transaction}</td>
      <td>${overallTotalRequests || 0}</td>
      <td>${toFixedSafe(overallAvgSizeKB, 1)} KB</td>
      <td>${toFixedSafe(overallTimeStats.avg, 2)}</td>
      <td>${toFixedSafe(overallTimeStats.p90, 2)}</td>
      <td>${toFixedSafe(overallSuccessRate, 1)}%</td>
      <td>`; // Start of the Top 5 by average size

    // Create HTML for the top 5 resources BY AVERAGE SIZE
    const resourcesWithAvgSize = Object.values(resourcesByUrl).map(r=>({
      url: r.url,
      type: r.type || 'other',
      requestCount: r.totalRequests || 0,
      totalSize: r.totalSize || 0,
      avgSize: r.totalRequests && r.totalSize ? r.totalSize/r.totalRequests : 0,
      avgTime: r.totalRequests && r.totalDuration ? r.totalDuration/r.totalRequests : 0,
      p90Time: r.p90Time || 0,
      successRate: r.totalRequests ? (r.successfulRequests/r.totalRequests*100) : 100
    }));
    const topByAvgSize = resourcesWithAvgSize.filter(resource => resource.url).sort((a,b)=>b.avgSize-a.avgSize).slice(0,5);

    if (topByAvgSize.length > 0) {
      topByAvgSize.forEach(resource => {
        const shortUrl = getShortUrl(resource.url);
        const resourceIconClass = resource.type || 'other';
        
        // Get the actual transaction-specific request count for this resource from the collected data
        let transactionCount = 0;
        
        // Use the globalResourcesByUrl data we collected earlier
        if (globalResourcesByUrl[resource.url] && 
            globalResourcesByUrl[resource.url].transactionCounts && 
            globalResourcesByUrl[resource.url].transactionCounts[transaction]) {
          transactionCount = globalResourcesByUrl[resource.url].transactionCounts[transaction];
        } else {
          // If we don't have transaction-specific data, use a reasonable default
          transactionCount = 1;
        }
        
        // Calculate total count across all transactions for this resource
        // Use the actual data from globalResourcesByUrl
        let totalCount = 0;
        
        if (globalResourcesByUrl[resource.url]) {
          // Sum all transaction counts for this resource
          Object.values(globalResourcesByUrl[resource.url].transactionCounts || {}).forEach(count => {
            totalCount += count;
          });
          
          // If we don't have transaction counts, use the requests array length
          if (totalCount === 0 && globalResourcesByUrl[resource.url].requests) {
            totalCount = globalResourcesByUrl[resource.url].requests.length;
          }
        }
        
        // Ensure we have at least 1 for display purposes
        if (totalCount === 0) {
          totalCount = 1;
        }
        
        html += `
          <div class="resource-details" title="${resource.url}">
            <span class="resource-icon ${resourceIconClass}">${resourceIconClass.charAt(0).toUpperCase()}</span>
            <strong>${shortUrl}</strong><br>
            <small>Reqs: ${transactionCount} (${totalCount} total) | Avg Time: ${toFixedSafe(resource.avgTime,1)}ms | Avg Size: ${toFixedSafe(resource.avgSize,1)}KB | Success: ${toFixedSafe(resource.successRate,0)}%</small>
          </div>
        `;
      });
    } else {
      html += '<div class="no-resources">No resources found for this transaction</div>';
    }
    // Close first cell and open second
    html += '</td><td>'; // Top 5 by Avg Time cell begins

    // Create HTML for the top 5 resources BY AVERAGE TIME
    // Use the previously sorted resources by time
    if (resourcesByTime.length > 0) {
      resourcesByTime.forEach(resource => {
        const shortUrl = getShortUrl(resource.url);
        const resourceIconClass = resource.type || 'other';
        let transactionCount = 0;
        if (globalResourcesByUrl[resource.url] && globalResourcesByUrl[resource.url].transactionCounts && globalResourcesByUrl[resource.url].transactionCounts[transaction]) {
          transactionCount = globalResourcesByUrl[resource.url].transactionCounts[transaction];
        } else {
          transactionCount = 1;
        }
        let totalCount = 0;
        if (globalResourcesByUrl[resource.url]) {
          Object.values(globalResourcesByUrl[resource.url].transactionCounts || {}).forEach(count => { totalCount += count; });
          if (totalCount === 0 && globalResourcesByUrl[resource.url].requests) {
            totalCount = globalResourcesByUrl[resource.url].requests.length;
          }
        }
        if (totalCount === 0) totalCount = 1;
        html += `
          <div class="resource-details" title="${resource.url}">
            <span class="resource-icon ${resourceIconClass}">${resourceIconClass.charAt(0).toUpperCase()}</span>
            <strong>${shortUrl}</strong><br>
            <small>Reqs: ${transactionCount} (${totalCount} total) | Avg Time: ${toFixedSafe(resource.avgTime,1)}ms | Avg Size: ${toFixedSafe(resource.avgSize,1)}KB | Success: ${toFixedSafe(resource.successRate,0)}%</small>
          </div>
        `;
      });
    } else {
      html += '<div class="no-resources">No resources found for this transaction</div>';
    }
    html += '</td></tr>';
  });
  
  // Close the table
  html += '</tbody></table>';
  
  return html;
}


/**
 * Builds a color legend for browser reports matching the section titles
 * @returns {string} HTML content for the browser report legend
 */
function buildReportLegend() {
  return `
    <div class="metrics-section">
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
        <div class="resource-type-legend-item" style="margin-right: 1.5rem;">
          <span class="resource-type font" style="margin-right: 0.5rem;">F</span>
          <span>Font</span>
        </div>
        <div class="resource-type-legend-item" style="margin-right: 1.5rem;">
          <span class="resource-type other" style="margin-right: 0.5rem;">O</span>
          <span>Other</span>
        </div>
        <div class="resource-type-legend-item" style="margin-right: 1.5rem;">
          <span>TTFB: Time to First Byte</span>
        </div>
        <div class="resource-type-legend-item">
          <span>TTLB: Time to Last Byte</span>
        </div>
      </div>
      
      <div class="metrics-explanation">
        <h4>Metrics Explanation</h4>
        
        <div class="metrics-explanation-grid">
          <div class="metrics-explanation-item">
            <h5>TTFB (Time To First Byte)</h5>
            <p>The time from the start of the request until the first byte of the response is received.</p>
          </div>
          
          <div class="metrics-explanation-item">
            <h5>TTLB (Time To Last Byte)</h5>
            <p>The total time from the start of the request until the complete response is received.</p>
          </div>
          
          <div class="metrics-explanation-item">
            <h5>p90 Time</h5>
            <p>The 90th percentile response time - 90% of requests complete faster than this value.</p>
          </div>
          
          <div class="metrics-explanation-item">
            <h5>Success Rate</h5>
            <p>Percentage of requests that returned a successful HTTP status code (200-399).</p>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Builds a comprehensive legend for protocol reports explaining all metrics and color codes
 * @returns {string} HTML content for the protocol report legend
 */
/**
 * Safely format a number to a fixed number of decimal places.
 * @param {number} value - The number to format
 * @param {number} [digits=1] - Number of decimal places
 * @returns {string} Formatted number as string
 */
function toFixedSafe(value, digits = 1) {
  if (value === undefined || value === null || isNaN(value)) {
    return '0.0';
  }
  return Number(value).toFixed(digits);
}

/**
 * Builds a color legend for protocol reports matching the section titles
 * @returns {string} HTML content for the protocol report legend
 */
function buildProtocolReportLegend() {
  // Same legend as browser report for consistency
  return buildReportLegend();
}

module.exports = {
  getTransactionName,
  calculateStats,
  calculateAggregateStats,
  generateReportStyles,
  buildPageLoadBreakdownTable,
  buildHtmlMetricsTable,
  buildHtmlPassFailMetricsTable,
  buildEnhancedSummaryTable,
  buildResourceTypeByTransactionTable,
  buildTop5NetworkResourcesTable,
  buildReportLegend,
  toFixedSafe,
  buildProtocolReportLegend
};
