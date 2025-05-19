const fs = require('fs');

// Configuration - adjust these if needed
const inputFile = 'results/results.json';
const templateTagName = 'template'; 
const groupTagName = 'group';

// Main function to process k6 JSON output
function processK6Output() {
  console.log(`Processing k6 output from ${inputFile}`);
  
  try {
    // Read the file line by line (k6 JSON output is one JSON object per line)
    const fileContent = fs.readFileSync(inputFile, 'utf8');
    const lines = fileContent.split('\n').filter(line => line.trim());
    
    // Collection of metrics by template and group
    const templates = new Set();
    const templateData = {
      ttfb: {}, // http_req_waiting - Time To First Byte
      ttlb: {}  // http_req_duration - Time To Last Byte
    };
    const templateErrors = {};
    
    const groups = new Set();
    const groupData = {
      ttfb: {}, // http_req_waiting - Time To First Byte
      ttlb: {}  // http_req_duration - Time To Last Byte
    };
    const groupErrors = {};
    
    let totalMetricsProcessed = 0;
    let httpMetricsFound = 0;
    let templatesFound = 0;
    let groupsFound = 0;
    
    // Process all metrics line by line
    lines.forEach((line) => {
      try {
        const dataPoint = JSON.parse(line);
        totalMetricsProcessed++;
        
        // Identify the metric type
        let metricType = null;
        if (dataPoint.metric === 'http_req_waiting') {
          metricType = 'ttfb'; // Time To First Byte
        } else if (dataPoint.metric === 'http_req_duration') {
          metricType = 'ttlb'; // Time To Last Byte
        }
        
        // Only process HTTP waiting and duration metrics
        if (dataPoint.type === 'Point' && 
            metricType && 
            dataPoint.data && 
            dataPoint.data.tags && 
            typeof dataPoint.data.value === 'number') {
          
          httpMetricsFound++;
          const value = dataPoint.data.value;
          
          // Process template-based metrics
          if (dataPoint.data.tags.template) {
            const template = dataPoint.data.tags.template;
            
            templatesFound++;
            templates.add(template);
            
            // Initialize data structure for this template if needed
            if (metricType === 'ttfb' && !templateData.ttfb[template]) {
              templateData.ttfb[template] = {
                durations: [],
                count: 0
              };
            } else if (metricType === 'ttlb' && !templateData.ttlb[template]) {
              templateData.ttlb[template] = {
                durations: [],
                count: 0
              };
            }
            
            // Add this duration value
            templateData[metricType][template].durations.push(value);
            templateData[metricType][template].count++;
          }
          
          // Process group-based metrics
          if (dataPoint.data.tags.group) {
            const group = dataPoint.data.tags.group;
            
            groupsFound++;
            groups.add(group);
            
            // Initialize data structure for this group if needed
            if (metricType === 'ttfb' && !groupData.ttfb[group]) {
              groupData.ttfb[group] = {
                durations: [],
                count: 0
              };
            } else if (metricType === 'ttlb' && !groupData.ttlb[group]) {
              groupData.ttlb[group] = {
                durations: [],
                count: 0
              };
            }
            
            // Add this duration value
            groupData[metricType][group].durations.push(value);
            groupData[metricType][group].count++;
          }
        }
        
        // Track errors
        else if (dataPoint.type === 'Point' && 
            dataPoint.metric === 'http_req_failed' && 
            dataPoint.data && 
            dataPoint.data.tags && 
            dataPoint.data.value === 1) {
              
          // Process template errors
          if (dataPoint.data.tags.template) {
            const template = dataPoint.data.tags.template;
            if (!templateErrors[template]) {
              templateErrors[template] = 0;
            }
            templateErrors[template]++;
          }
          
          // Process group errors
          if (dataPoint.data.tags.group) {
            const group = dataPoint.data.tags.group;
            if (!groupErrors[group]) {
              groupErrors[group] = 0;
            }
            groupErrors[group]++;
          }
        }
      } catch (err) {
        // Skip invalid JSON lines
      }
    });
    
    console.log(`Processed ${totalMetricsProcessed} data points (${httpMetricsFound} HTTP metrics)`);
    
    // Helper function to calculate statistics for a set of metrics
    function calculateStats(data, errors) {
      const stats = {};
      
      for (const [key, metricsData] of Object.entries(data)) {
        const durations = metricsData.durations || [];
        if (durations.length === 0) continue;
        
        // Sort durations for percentile calculations
        durations.sort((a, b) => a - b);
        
        const count = metricsData.count || 0;
        const errorCount = errors[key] || 0;
        
        // Safe calculation with fallbacks to 0 if undefined
        const safeNumber = num => (typeof num === 'number' && !isNaN(num)) ? num : 0;
        const safeFixed = (num, places) => safeNumber(num).toFixed(places);
        
        stats[key] = {
          requests: count,
          errors: errorCount,
          errorRate: count > 0 ? (errorCount / count * 100).toFixed(2) + '%' : '0.00%',
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
    
    // Calculate statistics for templates and groups
    const templateTtfbStats = calculateStats(templateData.ttfb, templateErrors);
    const templateTtlbStats = calculateStats(templateData.ttlb, templateErrors);
    const groupTtfbStats = calculateStats(groupData.ttfb, groupErrors);
    const groupTtlbStats = calculateStats(groupData.ttlb, groupErrors);
    
    // Function to print detailed table for one metric type
    function printMetricTable(title, data, stats, metricName) {
      console.log(`\n=== ${title} - ${metricName} ===\n`);
      
      // Create header row
      console.log('| Name                | Requests | Errors | Error Rate | Min (ms) | Max (ms) | Avg (ms) | Median (ms) | p90 (ms) | p95 (ms) | p99 (ms) |');
      console.log('|---------------------|----------|--------|------------|----------|----------|----------|-------------|----------|----------|----------|');
      
      // Check if we have any stats at all
      if (Object.keys(stats).length === 0) {
        console.log(`| No ${metricName} data found for ${title.toLowerCase()}.                                                                |`);
        return;
      }
      
      // Print rows
      for (const [key, stat] of Object.entries(stats)) {
        console.log(
          `| ${key.padEnd(20)} | ${stat.requests.toString().padEnd(8)} | ${stat.errors.toString().padEnd(6)} | ${stat.errorRate.padEnd(10)} | ${stat.min.padEnd(8)} | ${stat.max.padEnd(8)} | ${stat.avg.padEnd(8)} | ${stat.median.padEnd(11)} | ${stat.p90.padEnd(8)} | ${stat.p95.padEnd(8)} | ${stat.p99.padEnd(8)} |`
        );
      }
    }
    
    // Print the tables
    // TTFB Tables
    printMetricTable('Per-Template', templates, templateTtfbStats, 'TTFB (Time To First Byte)');
    printMetricTable('Per-Group', groups, groupTtfbStats, 'TTFB (Time To First Byte)');
    
    // TTLB Tables
    printMetricTable('Per-Template', templates, templateTtlbStats, 'TTLB (Time To Last Byte)');
    printMetricTable('Per-Group', groups, groupTtlbStats, 'TTLB (Time To Last Byte)');
    
    console.log("\nLegend:");
    console.log("- TTFB: Time To First Byte (http_req_waiting)");
    console.log("- TTLB: Time To Last Byte (http_req_duration)");
    
  } catch (err) {
    console.error('Error processing the input file:', err);
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