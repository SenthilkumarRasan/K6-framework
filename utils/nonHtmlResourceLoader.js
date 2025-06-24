
/**
 * Non-HTML Resource Loader for K6 Performance Tests
 * 
 * This module handles loading of non-HTML resources (JS, CSS, images, etc.) and captures
 * performance metrics for them. It ensures proper tag handling to group metrics by template
 * name rather than having them all appear under 'ALL'. This addresses the key issue identified
 * in previous work where tags weren't being properly applied to HTTP requests and checks.
 * 
 * @module nonHtmlResourceLoader
 */

import http from 'k6/http';
import { group } from 'k6';
import { Trend } from 'k6/metrics';

// Custom metrics for non-HTML resources
const nonHtmlTtfb = new Trend('nonhtml_ttfb', true);
const nonHtmlTtlb = new Trend('nonhtml_ttlb', true);
const nonHtmlSize = new Trend('nonhtml_size', true); // Dedicated resource size metric

// Custom metrics for resource statistics by type
const nonHtmlResourceStats = new Trend('nonhtml_resource_stats', true);

// Custom metric for storing top resources data
// We'll use this to pass the data to the report generator
const topResourcesMetric = new Trend('nonhtml_top_resources', true);

// Track resource statistics by type
let resourceStatsByType = {};

// Store top 5 slowest resources by transaction
let topResourcesByTransaction = {};

/**
 * Resource types with their priorities (lower number = higher priority)
 */
const RESOURCE_PRIORITIES = {
  'css': 1,
  'js': 2,
  'font': 3,
  'image': 4,
  'other': 5
};

/**
 * Determines resource type based on URL and/or content type
 * @param {string} url - Resource URL
 * @param {string} contentType - Content-Type header value (optional)
 * @returns {string} - Resource type (css, js, font, image, other)
 */
function getResourceType(url, contentType = '') {
  const urlLower = url.toLowerCase();
  
  // Check content type first if available
  if (contentType) {
    if (contentType.includes('text/css')) return 'css';
    if (contentType.includes('javascript')) return 'js';
    if (contentType.includes('font')) return 'font';
    if (contentType.includes('image/')) return 'image';
  }
  
  // Then check URL patterns
  if (urlLower.endsWith('.css') || urlLower.includes('.css?')) return 'css';
  if (urlLower.endsWith('.js') || urlLower.includes('.js?')) return 'js';
  if (urlLower.match(/\.(woff2?|ttf|eot|otf)/)) return 'font';
  if (urlLower.match(/\.(jpe?g|png|gif|svg|webp|ico)/)) return 'image';
  
  return 'other';
}

/**
 * Extracts non-HTML resource URLs from HTML content
 * @param {string} html - HTML content
 * @param {string} baseUrl - Base URL for resolving relative paths
 * @returns {Array} - Array of resource objects with url and type
 */
function extractResourceUrls(html, baseUrl) {
  if (!html) return [];
  
  const resources = [];
  const urlSet = new Set(); // To avoid duplicates
  
  // Helper to resolve URLs without using URL constructor (not available in k6)
  const resolveUrl = (url) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    } else if (url.startsWith('//')) {
      // Extract protocol from baseUrl
      const protocol = baseUrl.indexOf('://') > -1 ? baseUrl.split('://')[0] : 'https';
      return protocol + ':' + url;
    } else if (url.startsWith('/')) {
      // Extract domain from baseUrl
      let domain = baseUrl;
      if (baseUrl.indexOf('://') > -1) {
        const parts = baseUrl.split('/');
        domain = parts[0] + '//' + parts[2];
      }
      return domain + url;
    } else {
      // Relative URL
      return baseUrl + (baseUrl.endsWith('/') ? '' : '/') + url;
    }
  };

  // Extract CSS links
  const cssLinks = html.match(/<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi) || [];
  cssLinks.forEach(link => {
    const href = link.match(/href=["']([^"']+)["']/i);
    if (href && href[1]) {
      const url = resolveUrl(href[1]);
      if (!urlSet.has(url)) {
        urlSet.add(url);
        resources.push({ url, type: 'css' });
      }
    }
  });

  // Extract JS scripts
  const scripts = html.match(/<script[^>]*src=["']([^"']+)["'][^>]*>/gi) || [];
  scripts.forEach(script => {
    const src = script.match(/src=["']([^"']+)["']/i);
    if (src && src[1]) {
      const url = resolveUrl(src[1]);
      if (!urlSet.has(url)) {
        urlSet.add(url);
        resources.push({ url, type: 'js' });
      }
    }
  });

  // Extract images
  const images = html.match(/<img[^>]*src=["']([^"']+)["'][^>]*>/gi) || [];
  images.forEach(img => {
    const src = img.match(/src=["']([^"']+)["']/i);
    if (src && src[1]) {
      const url = resolveUrl(src[1]);
      if (!urlSet.has(url)) {
        urlSet.add(url);
        resources.push({ url, type: 'image' });
      }
    }
  });

  // Extract fonts and other resources from CSS @import and url()
  const cssImports = html.match(/@import\s+["']([^"']+)["']/gi) || [];
  cssImports.forEach(importRule => {
    const importUrl = importRule.match(/@import\s+["']([^"']+)["']/i);
    if (importUrl && importUrl[1]) {
      const url = resolveUrl(importUrl[1]);
      if (!urlSet.has(url)) {
        urlSet.add(url);
        resources.push({ url, type: 'css' });
      }
    }
  });

  const urlFunctions = html.match(/url\(["']?([^"']+)["']?\)/gi) || [];
  urlFunctions.forEach(urlFunc => {
    const urlMatch = urlFunc.match(/url\(["']?([^"']+)["']?\)/i);
    if (urlMatch && urlMatch[1]) {
      const url = resolveUrl(urlMatch[1]);
      if (!urlSet.has(url)) {
        urlSet.add(url);
        const type = getResourceType(url);
        resources.push({ url, type });
      }
    }
  });

  // Sort resources by priority
  return resources.sort((a, b) => {
    return RESOURCE_PRIORITIES[a.type] - RESOURCE_PRIORITIES[b.type];
  });
}

/**
 * Loads non-HTML resources in a browser-like manner
 * @param {string} html - HTML content
 * @param {string} baseUrl - Base URL for resolving relative paths
 * @param {Object} tags - Tags for metrics
 * @param {Object} options - Additional options
 * @returns {Object} - Results including timing metrics and resource counts
 */
export function loadNonHtmlResources(html, baseUrl, tags = {}, options = {}) {
  const {
    maxResources = 30,         // Maximum number of resources to load
    batchSize = 6,             // Number of resources to load in parallel (simulates browser connection limit)
    includeThirdParty = true,  // Whether to include third-party resources
    timeout = 10000            // Timeout for resource requests
  } = options;

  // Extract resource URLs from HTML
  let resources = extractResourceUrls(html, baseUrl);
  // Filter resources if needed
  let filteredResources = resources;
  if (!includeThirdParty) {
    const domain = baseUrl.match(/^https?:\/\/([^/]+)/);
    const baseDomain = domain ? domain[1] : '';
    filteredResources = resources.filter(r => r.url.includes(baseDomain));
  }
  
  // Limit number of resources
  const limitedResources = filteredResources.slice(0, maxResources);
  
  // Prepare batches of resources by type priority
  const batches = [];
  for (let i = 0; i < limitedResources.length; i += batchSize) {
    batches.push(limitedResources.slice(i, i + batchSize));
  }
  
  // Create custom tags for non-HTML resources
  const nonHtmlTags = {
    ...tags,
    resource_type: 'nonhtml' // Add resource_type tag to identify non-HTML resources
  };
  
  // Ensure transaction tag exists and ends with _nonhtml
  if (tags.transaction) {
    nonHtmlTags.transaction = tags.transaction.endsWith('_nonhtml')
      ? tags.transaction
      : `${tags.transaction}_nonhtml`;
  } else {
    nonHtmlTags.transaction = 'unknown_nonhtml';
  }
  
  // Initialize resource stats by type for this transaction if not exists
  const transactionName = tags.transaction || 'unknown';
  if (!resourceStatsByType[transactionName]) {
    resourceStatsByType[transactionName] = {
      css: { count: 0, totalSize: 0, totalTime: 0, successCount: 0, failCount: 0, times: [] },
      js: { count: 0, totalSize: 0, totalTime: 0, successCount: 0, failCount: 0, times: [] },
      font: { count: 0, totalSize: 0, totalTime: 0, successCount: 0, failCount: 0, times: [] },
      image: { count: 0, totalSize: 0, totalTime: 0, successCount: 0, failCount: 0, times: [] },
      other: { count: 0, totalSize: 0, totalTime: 0, successCount: 0, failCount: 0, times: [] }
    };
  }
  
  // Results object
  const results = {
    totalResources: limitedResources.length,
    loadedResources: 0,
    failedResources: 0,
    resourceTypes: {
      css: 0,
      js: 0,
      font: 0,
      image: 0,
      other: 0
    },
    resourceStats: resourceStatsByType[transactionName], // Add resource stats by type
    ttfb: {
      min: Number.MAX_SAFE_INTEGER,
      max: 0,
      avg: 0,
      total: 0
    },
    ttlb: {
      min: Number.MAX_SAFE_INTEGER,
      max: 0,
      avg: 0,
      total: 0
    },
    topResources: [] // Will contain top 5 slowest resources
  };

  // Load resources in batches
  return group('NonHtmlResources', function() {
    let totalTtfb = 0;
    let totalTtlb = 0;
    
    // eslint-disable-next-line no-unused-vars
    batches.forEach((batch, _batchIndex) => {
      // Execute each request individually to ensure tags are applied
      const responses = {};
      batch.forEach(resource => {
        const resp = http.get(resource.url, {
          headers: {
            'Accept': '*/*',
            'Referer': baseUrl
          },
          tags: nonHtmlTags,
          timeout: timeout
        });
        responses[resource.url] = resp;
      });
      
      // Process responses
      Object.entries(responses).forEach(([url, response]) => {
        const resource = batch.find(r => r.url === url);
        if (!resource) return;
        
        // Count resource by type
        results.resourceTypes[resource.type]++;
        
        // Check if request was successful
        const success = response.status >= 200 && response.status < 400;
        if (success) {
          results.loadedResources++;
          
          // Calculate metrics
          const ttfb = response.timings.waiting;
          const ttlb = response.timings.duration;
          
          // Get resource size
          // Try to get accurate size
          let size = 0;
          if (response && response.headers && response.headers['Content-Length']) {
            size = parseInt(response.headers['Content-Length'], 10) || 0;
          }
          if (!size && response.body) {
            size = response.body.byteLength || response.body.length || 0;
          }
          
          // Update min/max
          results.ttfb.min = Math.min(results.ttfb.min, ttfb);
          results.ttfb.max = Math.max(results.ttfb.max, ttfb);
          results.ttlb.min = Math.min(results.ttlb.min, ttlb);
          results.ttlb.max = Math.max(results.ttlb.max, ttlb);
          
          // Add to totals for average calculation
          totalTtfb += ttfb;
          totalTtlb += ttlb;
          
          // Add to custom metrics with tags
          nonHtmlTtfb.add(ttfb, nonHtmlTags);
          nonHtmlTtlb.add(ttlb, nonHtmlTags);
          
          // IMPORTANT: Always record size regardless of success status so the report has size data
          nonHtmlSize.add(size, { resource_url: url, resource_type: resource.type, ...nonHtmlTags });

          // IMPORTANT: We need to make sure these non-HTML resources are properly tracked
          // in the k6 output with the correct transaction_nonhtml suffix
          
          // Built-in k6 http metrics already record duration & waiting with tags from the request.
          // We only need a custom Trend for resource size. Add resource_url so the report can map it.

          
          // Update resource stats by type
          const resourceType = resource.type;
          const stats = results.resourceStats[resourceType];
          stats.count++;
          stats.totalSize += size;
          stats.totalTime += ttlb;
          stats.successCount++;
          stats.times.push(ttlb);
          
          // Add resource stats to custom metric
          // Record size in the metric value (bytes)
          nonHtmlResourceStats.add(size, {
            resource_url: url,
            ...nonHtmlTags,
            resource_type: resourceType,
            resource_size: size,
            resource_success: 1
          });
          
          // Track top 5 slowest resources by transaction
          const transactionName = nonHtmlTags.transaction || 'unknown';
          if (!topResourcesByTransaction[transactionName]) {
            topResourcesByTransaction[transactionName] = [];
          }
          
          // Add resource to the list with its timing
          topResourcesByTransaction[transactionName].push({
            url: url,
            type: resource.type,
            ttfb: ttfb,
            ttlb: ttlb
          });
          
          // Sort by TTLB (slowest first) and keep only top 5
          topResourcesByTransaction[transactionName].sort((a, b) => b.ttlb - a.ttlb);
          if (topResourcesByTransaction[transactionName].length > 5) {
            topResourcesByTransaction[transactionName] = topResourcesByTransaction[transactionName].slice(0, 5);
          }
          
          // Store the top resources data in a custom metric
          // We'll encode the data as JSON in the metric value
          // The value doesn't matter, we just need to attach the data as a tag
          topResourcesMetric.add(1, {
            ...nonHtmlTags,
            resource_url: url.substring(0, 100), // Truncate URL to avoid issues
            resource_type: resource.type,
            resource_ttfb: ttfb.toFixed(2),
            resource_ttlb: ttlb.toFixed(2),
            resource_rank: topResourcesByTransaction[transactionName].length // 1-5 ranking
          });
        } else {
          results.failedResources++;
          
          // Update resource stats for failed requests
          const resourceType = resource.type;
          const stats = results.resourceStats[resourceType];
          stats.count++;
          stats.failCount++;
          
          // Add failed resource stats to custom metric
          nonHtmlResourceStats.add(0, {
            ...nonHtmlTags,
            resource_type: resourceType,
            resource_size: 0,
            resource_success: 0
          });
        }
      });
    });
    
    // Calculate averages
    if (results.loadedResources > 0) {
      results.ttfb.avg = totalTtfb / results.loadedResources;
      results.ttlb.avg = totalTtlb / results.loadedResources;
      results.ttfb.total = totalTtfb;
      results.ttlb.total = totalTtlb;
    }
    
    // If no resources were loaded, reset min values
    if (results.ttfb.min === Number.MAX_SAFE_INTEGER) results.ttfb.min = 0;
    if (results.ttlb.min === Number.MAX_SAFE_INTEGER) results.ttlb.min = 0;
    
    // Add top resources for this transaction to the results
    const transactionName = tags.transaction || 'unknown';
    if (topResourcesByTransaction[transactionName] && topResourcesByTransaction[transactionName].length > 0) {
      results.topResources = topResourcesByTransaction[transactionName];
    }
    
    return results;
  });
}
