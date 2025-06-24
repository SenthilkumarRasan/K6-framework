/**
 * Collects Core Web Vitals (LCP, FCP, CLS, TTFB) from the page using PerformanceObserver and direct API calls.
 * @param {import('k6/browser').Page} page - The k6 browser page object.
 * @returns {Promise<Object>} - The collected metrics.
 */
export async function collectCoreWebVitals(page) {
  try {
    // Wait for a short period to allow metrics to settle
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Evaluate in the browser context
    const metrics = await page.evaluate(() => {
      return new Promise((resolve) => {
        const result = { 
          lcp: null, 
          fcp: null, 
          cls: 0, 
          ttfb: null,
          // Detailed timing metrics
          serverTime: null,
          networkTime: null,
          domProcessingTime: null,
          resourceLoadTime: null,
          scriptParsingTime: null,
          scriptExecutionTime: null
        };
        
        let ttfbReportedByObserver = false;

        // Set up PerformanceObserver to capture metrics as they become available
        const observer = new PerformanceObserver((entryList) => {
          for (const entry of entryList.getEntries()) {
            switch (entry.entryType) {
            case 'largest-contentful-paint':
              console.log(`[CWV EVAL LCP OBSERVER] LCP entry received: ${entry.startTime}`);
              result.lcp = entry.startTime;
              break;
            case 'paint':
              if (entry.name === 'first-contentful-paint') {
                result.fcp = entry.startTime;
              }
              break;
            case 'layout-shift':
              if (!entry.hadRecentInput) {
                result.cls += entry.value;
              }
              break;
            case 'navigation':
              result.ttfb = entry.responseStart - entry.requestStart;
              ttfbReportedByObserver = true;
              break;
            }
          }
        });

        try {
          observer.observe({
            entryTypes: ['largest-contentful-paint', 'paint', 'layout-shift', 'navigation'],
            buffered: true
          });
        } catch (e) {
          console.error('[CWV EVAL] Error setting up PerformanceObserver:', e.message);
          // Resolve with potentially empty/partial results if observer setup fails
          setTimeout(() => resolve(result), 0); 
          return;
        }

        // Get detailed timing metrics from navigation timing
        const navEntries = performance.getEntriesByType('navigation');
        if (navEntries && navEntries.length > 0) {
          const navEntry = navEntries[0];
          
          // Server-side timing (request to first byte)
          result.serverTime = navEntry.responseStart - navEntry.requestStart;
          
          // Network time (DNS + connection + request + response)
          result.networkTime = navEntry.responseEnd - navEntry.fetchStart;
          
          // DOM processing time - from response end to DOM interactive
          result.domProcessingTime = navEntry.domInteractive - navEntry.responseEnd;
          
          // Resource loading time - from DOM interactive to load event
          result.resourceLoadTime = navEntry.loadEventStart - navEntry.domInteractive;
          
          // Script parsing time - from DOM loading to DOM interactive
          result.scriptParsingTime = navEntry.domInteractive - navEntry.domLoading;
          
          // Script execution time - from DOM interactive to DOM complete
          result.scriptExecutionTime = navEntry.domComplete - navEntry.domInteractive;
        }

        // Wait for a short period to ensure all metrics are collected
        setTimeout(() => {
          observer.disconnect();
          
          // Fallback for TTFB if observer didn't report it
          if (!ttfbReportedByObserver && !result.ttfb) {
            const navEntries = performance.getEntriesByType('navigation');
            if (navEntries && navEntries.length > 0) {
              const nav = navEntries[0];
              result.ttfb = nav.responseStart - nav.requestStart;
            }
          }

          // Fallback for FCP if not captured by observer
          if (result.fcp === null) {
            const paintEntries = performance.getEntriesByType('paint');
            const fcpEntry = paintEntries.find(entry => entry.name === 'first-contentful-paint');
            if (fcpEntry) {
              result.fcp = fcpEntry.startTime;
            }
          }

          // Fallback for LCP using the Largest Contentful Paint API
          if (result.lcp === null) {
            try {
              const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
              if (lcpEntries && lcpEntries.length > 0) {
                result.lcp = lcpEntries[lcpEntries.length - 1].startTime;
                console.log(`[CWV EVAL LCP FALLBACK] Found LCP from entries: ${result.lcp}ms`);
              }
            } catch (e) {
              console.error('[CWV EVAL] Error getting LCP entries:', e.message);
            }
            
            // Additional fallback - use FCP as an approximation if LCP is still null
            if (result.lcp === null && result.fcp !== null) {
              result.lcp = result.fcp;
              console.log(`[CWV EVAL LCP FALLBACK] Using FCP as LCP fallback: ${result.lcp}ms`);
            }
          }
          
          // Ensure all values are numbers and not null
          const finalResult = {
            lcp: typeof result.lcp === 'number' && !isNaN(result.lcp) ? result.lcp : 0,
            fcp: typeof result.fcp === 'number' && !isNaN(result.fcp) ? result.fcp : 0,
            cls: typeof result.cls === 'number' && !isNaN(result.cls) ? result.cls : 0,
            ttfb: typeof result.ttfb === 'number' && !isNaN(result.ttfb) ? result.ttfb : 0,
            serverTime: typeof result.serverTime === 'number' && !isNaN(result.serverTime) ? result.serverTime : 0,
            networkTime: typeof result.networkTime === 'number' && !isNaN(result.networkTime) ? result.networkTime : 0,
            domProcessingTime: typeof result.domProcessingTime === 'number' && !isNaN(result.domProcessingTime) ? result.domProcessingTime : 0,
            resourceLoadTime: typeof result.resourceLoadTime === 'number' && !isNaN(result.resourceLoadTime) ? result.resourceLoadTime : 0,
            scriptParsingTime: typeof result.scriptParsingTime === 'number' && !isNaN(result.scriptParsingTime) ? result.scriptParsingTime : 0,
            scriptExecutionTime: typeof result.scriptExecutionTime === 'number' && !isNaN(result.scriptExecutionTime) ? result.scriptExecutionTime : 0
          };
          
          resolve(finalResult);
        }, 1000);
      });
    });

    return metrics || null;
  } catch (error) {
    console.error(`Error collecting Core Web Vitals: ${error.message}`);
    return {
      lcp: 0,
      fcp: 0,
      cls: 0,
      ttfb: 0,
      serverTime: 0,
      networkTime: 0,
      domProcessingTime: 0,
      resourceLoadTime: 0,
      scriptParsingTime: 0,
      scriptExecutionTime: 0
    };
  }
}

/**
 * Collects detailed resource timing data from the page
 * @param {import('k6/browser').Page} page - The k6 browser page object
 * @returns {Promise<{js: {count: number, size: number, time: number, maxTime: number}, css: {count: number, size: number, time: number, maxTime: number}, img: {count: number, size: number, time: number, maxTime: number}, font: {count: number, size: number, time: number, maxTime: number}, other: {count: number, size: number, time: number, maxTime: number}, totalDownloadTime: number, criticalPathTime: number, scriptParsingTime: number, scriptExecutionTime: number}>}
 */
export async function collectResourceTiming(page) {
  try {
    return await page.evaluate(() => {
      const resources = performance.getEntriesByType('resource');
      const navEntry = performance.getEntriesByType('navigation')[0];
      
      const resourceStats = {
        js: { count: 0, size: 0, time: 0, maxTime: 0, resources: [] },
        css: { count: 0, size: 0, time: 0, maxTime: 0, resources: [] },
        img: { count: 0, size: 0, time: 0, maxTime: 0, resources: [] },
        font: { count: 0, size: 0, time: 0, maxTime: 0, resources: [] },
        other: { count: 0, size: 0, time: 0, maxTime: 0, resources: [] },
        totalDownloadTime: 0,
        criticalPathTime: 0,
        scriptParsingTime: 0,
        scriptExecutionTime: 0,
        // Add a new property to store detailed resource information for the top 5 network resources tables
        detailedResources: {
          js: [],
          css: [],
          img: [],
          font: [],
          other: []
        }
      };
      
      // Track the latest resource end time
      let latestResourceEnd = navEntry ? navEntry.responseEnd : 0;
      
      // Calculate script parsing and execution time
      if (navEntry) {
        // Script parsing time (from domLoading to domInteractive)
        resourceStats.scriptParsingTime = navEntry.domInteractive - navEntry.domLoading;
        
        // Script execution time (from domInteractive to domComplete)
        resourceStats.scriptExecutionTime = navEntry.domComplete - navEntry.domInteractive;
      }
      
      // Process each resource
      resources.forEach(res => {
        const url = res.name;
        const duration = res.duration;
        const size = res.transferSize || 0;
        const startTime = res.startTime;
        const responseEnd = res.responseEnd;
        
        // Update latest resource end time
        if (responseEnd > latestResourceEnd) {
          latestResourceEnd = responseEnd;
        }
        
        // Determine resource type
        let type = 'other';
        if (url.endsWith('.js') || url.includes('.js?') || res.initiatorType === 'script') {
          type = 'js';
        } else if (url.endsWith('.css') || url.includes('.css?') || res.initiatorType === 'css' || res.initiatorType === 'link') {
          type = 'css';
        } else if (/\.(png|jpg|jpeg|gif|webp|svg|ico)/.test(url) || res.initiatorType === 'img') {
          type = 'img';
        } else if (/\.(woff|woff2|ttf|otf|eot)/.test(url) || res.initiatorType === 'font') {
          type = 'font';
        }
        
        // Add to type stats
        resourceStats[type].count++;
        resourceStats[type].size += size;
        resourceStats[type].time += duration;
        resourceStats[type].resources.push({
          url: url,
          duration: duration,
          size: size,
          startTime: startTime,
          responseEnd: responseEnd
        });
        
        // Update max time for this resource type
        if (duration > resourceStats[type].maxTime) {
          resourceStats[type].maxTime = duration;
        }
      });
      
      // Calculate relative download times based on the page load cycle
      if (navEntry) {
        // Total download time should only include resources that finished loading before the load event
        // This gives a more accurate picture of what affects the actual page load time
        const resourcesBeforeLoadEvent = resources.filter(res => res.responseEnd <= navEntry.loadEventStart);
        const earliestResourceStart = Math.min(...resourcesBeforeLoadEvent.map(res => res.startTime), navEntry.fetchStart);
        const latestResourceBeforeLoad = Math.max(...resourcesBeforeLoadEvent.map(res => res.responseEnd), navEntry.responseEnd);
        
        // This is the actual time spent downloading resources that affect the page load time
        resourceStats.totalDownloadTime = latestResourceBeforeLoad - earliestResourceStart;
        
        // Calculate critical path time - the minimum time required for the page to become visually complete
        // Critical path includes:
        // 1. HTML download and initial parsing (fetchStart to domInteractive)
        // 2. CSS loading and processing (CSS resources that block rendering)
        // 3. Synchronous JS that blocks rendering
        
        // Find the latest CSS resource that finished loading before domComplete
        // These are likely render-blocking CSS files
        const criticalCssResources = resourceStats.css.resources.filter(res => 
          res.responseEnd <= navEntry.domComplete && 
          res.startTime <= navEntry.domInteractive);
        
        const cssEndTime = criticalCssResources.length > 0 ?
          Math.max(...criticalCssResources.map(r => r.responseEnd)) : navEntry.domInteractive;
        
        // Find critical JS resources (those that execute before domInteractive)
        const criticalJsResources = resourceStats.js.resources.filter(res => 
          res.responseEnd <= navEntry.domInteractive);
        
        const jsEndTime = criticalJsResources.length > 0 ?
          Math.max(...criticalJsResources.map(r => r.responseEnd)) : navEntry.domLoading;
        
        // Critical path time is the time until the page is visually complete enough to interact
        resourceStats.criticalPathTime = Math.max(navEntry.domInteractive, cssEndTime, jsEndTime) - navEntry.fetchStart;
        
        // Also calculate parallel download efficiency
        // If resources were downloaded perfectly in parallel, this would approach 100%
        const sumOfResourceDurations = resourcesBeforeLoadEvent.reduce((sum, res) => sum + res.duration, 0);
        const actualDownloadTime = latestResourceBeforeLoad - earliestResourceStart;
        
        resourceStats.parallelDownloadEfficiency = actualDownloadTime > 0 ? 
          Math.min(100, (sumOfResourceDurations / actualDownloadTime) * 100) : 0;
      }
      
      // Copy the top resources to detailedResources for the top 5 network resources tables
      // Sort by duration (slowest first) and take the top 10 (we'll display top 5, but collect more for variety)
      resourceStats.detailedResources.js = resourceStats.js.resources
        .sort((a, b) => b.duration - a.duration)
        .slice(0, 10)
        .map(res => ({
          url: res.url,
          duration: res.duration,
          size: res.size,
          status: res.status || 200,
          // Include initiatorType for debugging
          initiatorType: res.initiatorType || ''
        }));
        
      resourceStats.detailedResources.css = resourceStats.css.resources
        .sort((a, b) => b.duration - a.duration)
        .slice(0, 10)
        .map(res => ({
          url: res.url,
          duration: res.duration,
          size: res.size,
          status: res.status || 200,
          initiatorType: res.initiatorType || ''
        }));
        
      resourceStats.detailedResources.img = resourceStats.img.resources
        .sort((a, b) => b.duration - a.duration)
        .slice(0, 10)
        .map(res => ({
          url: res.url,
          duration: res.duration,
          size: res.size,
          status: res.status || 200,
          initiatorType: res.initiatorType || ''
        }));
        
      resourceStats.detailedResources.font = resourceStats.font.resources
        .sort((a, b) => b.duration - a.duration)
        .slice(0, 10)
        .map(res => ({
          url: res.url,
          duration: res.duration,
          size: res.size,
          status: res.status || 200,
          initiatorType: res.initiatorType || ''
        }));
        
      resourceStats.detailedResources.other = resourceStats.other.resources
        .sort((a, b) => b.duration - a.duration)
        .slice(0, 10)
        .map(res => ({
          url: res.url,
          duration: res.duration,
          size: res.size,
          status: res.status || 200,
          initiatorType: res.initiatorType || ''
        }));
      
      // Clean up the resources arrays before returning (to avoid large data transfer)
      delete resourceStats.js.resources;
      delete resourceStats.css.resources;
      delete resourceStats.img.resources;
      delete resourceStats.font.resources;
      delete resourceStats.other.resources;
      
      // Resource stats collected
      
      return resourceStats;
    });
  } catch (error) {
    console.error('Error collecting resource timing data:', error);
    return {
      js: { count: 0, size: 0, time: 0, maxTime: 0 },
      css: { count: 0, size: 0, time: 0, maxTime: 0 },
      img: { count: 0, size: 0, time: 0, maxTime: 0 },
      font: { count: 0, size: 0, time: 0, maxTime: 0 },
      other: { count: 0, size: 0, time: 0, maxTime: 0 },
      totalDownloadTime: 0,
      criticalPathTime: 0,
      scriptParsingTime: 0,
      scriptExecutionTime: 0
    };
  }
}

// Record Mantle metrics to Trends
/**
 * Creates a metric definitions object with the specified metrics included
 * @param {Object} metrics - Object containing all available metrics
 * @param {Object} options - Configuration options
 * @param {boolean} options.includeCoreWebVitals - Whether to include Core Web Vitals metrics
 * @param {boolean} options.includeDetailedTimingMetrics - Whether to include detailed timing metrics
 * @param {boolean} options.includeResourceMetrics - Whether to include resource metrics
 * @param {boolean} options.captureMantleMetrics - Whether to include Mantle metrics
 * @returns {Object} - Object with selected metrics
 */
export function buildMetricDefinitions(metrics, options = {}) {
  const {
    includeCoreWebVitals = true,
    includeDetailedTimingMetrics = true,
    includeResourceMetrics = true,
    captureMantleMetrics = false
  } = options;
  
  // Create metric definitions object with options stored for reference
  const metricDefinitions = {
    // Store options for reference by other functions
    _options: {
      includeCoreWebVitals,
      includeDetailedTimingMetrics,
      includeResourceMetrics,
      captureMantleMetrics
    }
  };
  
  // Core metrics - always include these
  metricDefinitions.pageLoadTime = metrics.pageLoadTime;
  metricDefinitions.pageLoadSuccess = metrics.pageLoadSuccess;
  
  // Core Web Vitals - essential for performance analysis
  if (includeCoreWebVitals) {
    metricDefinitions.lcpByTransaction = metrics.lcpByTransaction;
    metricDefinitions.fcpByTransaction = metrics.fcpByTransaction;
    metricDefinitions.clsByTransaction = metrics.clsByTransaction;
    metricDefinitions.ttfbByTransaction = metrics.ttfbByTransaction;
  }
  
  // Timing metrics - include based on what you need to analyze
  if (includeDetailedTimingMetrics) {
    metricDefinitions.serverProcessingTime = metrics.serverProcessingTime;
    metricDefinitions.networkTime = metrics.networkTime;
    metricDefinitions.domProcessingTime = metrics.domProcessingTime;
    metricDefinitions.resourceLoadTime = metrics.resourceLoadTime;
    metricDefinitions.scriptExecutionTime = metrics.scriptExecutionTime;
    metricDefinitions.scriptParsingTime = metrics.scriptParsingTime;
    metricDefinitions.criticalRenderingTime = metrics.criticalRenderingTime;
  }
  
  // Resource metrics - include based on what you need to analyze
  if (includeResourceMetrics) {
    metricDefinitions.totalDownloadTime = metrics.totalDownloadTime;
    metricDefinitions.criticalPathTime = metrics.criticalPathTime;
    metricDefinitions.parallelDownloadEfficiency = metrics.parallelDownloadEfficiency;
    metricDefinitions.jsLoadTime = metrics.jsLoadTime;
    metricDefinitions.cssLoadTime = metrics.cssLoadTime;
    metricDefinitions.imgLoadTime = metrics.imgLoadTime;
    metricDefinitions.fontLoadTime = metrics.fontLoadTime;
    metricDefinitions.otherResourceLoadTime = metrics.otherResourceLoadTime;
    metricDefinitions.resourceJs = metrics.resourceJs;
    metricDefinitions.resourceCss = metrics.resourceCss;
    metricDefinitions.resourceImg = metrics.resourceImg;
    metricDefinitions.resourceFont = metrics.resourceFont;
    metricDefinitions.resourceOther = metrics.resourceOther;
  }
  
  // Mantle metrics - only include if testing Mantle-specific features
  if (captureMantleMetrics) {
    metricDefinitions.mantle_first_ad_load = metrics.mantle_first_ad_load;
    metricDefinitions.mantle_first_ad_render = metrics.mantle_first_ad_render;
    metricDefinitions.mantle_first_ad_request = metrics.mantle_first_ad_request;
    metricDefinitions.mantle_first_ad_response = metrics.mantle_first_ad_response;
    metricDefinitions.mantle_gtm_loaded = metrics.mantle_gtm_loaded;
    metricDefinitions.mantle_gpt_loaded = metrics.mantle_gpt_loaded;
    metricDefinitions.mantle_scroll_depth = metrics.mantle_scroll_depth;
    metricDefinitions.mantle_content_depth_px = metrics.mantle_content_depth_px;
    metricDefinitions.mantle_third_party_fired = metrics.mantle_third_party_fired;
    metricDefinitions.mantle_deferred_fired = metrics.mantle_deferred_fired;
    metricDefinitions.mantle_video_player_loaded = metrics.mantle_video_player_loaded;
    metricDefinitions.mantle_ad_refresh_rate = metrics.mantle_ad_refresh_rate;
    metricDefinitions.mantle_ad_bidder_amount = metrics.mantle_ad_bidder_amount;
    metricDefinitions.mantle_first_scroll = metrics.mantle_first_scroll;
    metricDefinitions.mantle_adsrendered = metrics.mantle_adsrendered;
    metricDefinitions.mantle_adsviewable = metrics.mantle_adsviewable;
  }
  
  return metricDefinitions;
}

export function recordMantleMetrics(metrics, tags, mantleMetricDefinitions) {
  if (!metrics || typeof metrics !== 'object') return;
  
  Object.entries(mantleMetricDefinitions).forEach(([metricKey, metricTrend]) => {
    if (Object.prototype.hasOwnProperty.call(metrics, metricKey) && typeof metrics[metricKey] === 'number') {
      metricTrend.add(metrics[metricKey], tags);
    }
  });
}

/**
 * Comprehensive function to collect all performance metrics in one call
 * This centralizes all metrics collection to make it reusable across different scripts
 * @param {import('k6/browser').Page} page - The k6 browser page object
 * @param {Object} tags - Tags to apply to all metrics
 * @param {Object} metricDefinitions - Object containing all metric trend objects
 * @returns {Promise<{cwvMetrics: Object, resourceStats: Object}>}
 */
export async function collectAllMetrics(page, tags, metricDefinitions = {}) {
  const result = {
    cwvMetrics: null,
    resourceStats: null
  };
  
  try {
    // 1. Collect Core Web Vitals
    const cwvMetrics = await collectCoreWebVitals(page);
    if (cwvMetrics) {  
      result.cwvMetrics = cwvMetrics;
      // Record Core Web Vitals metrics if available
      // Record FCP if available
      if (typeof result.cwvMetrics.fcp === 'number' && Object.prototype.hasOwnProperty.call(metricDefinitions, 'fcpByTransaction')) {
        metricDefinitions.fcpByTransaction.add(result.cwvMetrics.fcp, tags);
      }
      
      // Record CLS if available
      if (typeof result.cwvMetrics.cls === 'number' && Object.prototype.hasOwnProperty.call(metricDefinitions, 'clsByTransaction')) {
        metricDefinitions.clsByTransaction.add(result.cwvMetrics.cls, tags);
      }
      
      // Record TTFB if available
      if (typeof result.cwvMetrics.ttfb === 'number' && metricDefinitions.ttfbByTransaction) {
        metricDefinitions.ttfbByTransaction.add(result.cwvMetrics.ttfb, tags);
      }
      
      // Record detailed timing metrics
      if (typeof result.cwvMetrics.serverTime === 'number' && metricDefinitions.serverProcessingTime) {
        metricDefinitions.serverProcessingTime.add(result.cwvMetrics.serverTime, tags);
      }
      
      if (typeof result.cwvMetrics.networkTime === 'number' && metricDefinitions.networkTime) {
        metricDefinitions.networkTime.add(result.cwvMetrics.networkTime, tags);
      }
      
      if (typeof result.cwvMetrics.domProcessingTime === 'number' && metricDefinitions.domProcessingTime) {
        metricDefinitions.domProcessingTime.add(result.cwvMetrics.domProcessingTime, tags);
      }
    }
    
    // 2. Collect Resource Timing data
    result.resourceStats = await collectResourceTiming(page);
    
    // Record resource timing metrics if available
    if (result.resourceStats) {
      // Record individual resource type metrics
      if (metricDefinitions.jsLoadTime) {
        metricDefinitions.jsLoadTime.add(result.resourceStats.js.time, tags);
      }
      if (metricDefinitions.cssLoadTime) {
        metricDefinitions.cssLoadTime.add(result.resourceStats.css.time, tags);
      }
      if (metricDefinitions.imgLoadTime) {
        metricDefinitions.imgLoadTime.add(result.resourceStats.img.time, tags);
      }
      if (metricDefinitions.fontLoadTime) {
        metricDefinitions.fontLoadTime.add(result.resourceStats.font.time, tags);
      }
      if (metricDefinitions.otherResourceLoadTime) {
        metricDefinitions.otherResourceLoadTime.add(result.resourceStats.other.time, tags);
      }
      
      // Record overall resource timing metrics
      if (result.resourceStats.totalDownloadTime > 0 && metricDefinitions.totalDownloadTime) {
        metricDefinitions.totalDownloadTime.add(result.resourceStats.totalDownloadTime, tags);
      }
      
      if (result.resourceStats.criticalPathTime > 0 && metricDefinitions.criticalPathTime) {
        metricDefinitions.criticalPathTime.add(result.resourceStats.criticalPathTime, tags);
      }
      
      if (result.resourceStats.parallelDownloadEfficiency > 0 && metricDefinitions.parallelDownloadEfficiency) {
        metricDefinitions.parallelDownloadEfficiency.add(result.resourceStats.parallelDownloadEfficiency, tags);
      }
      
      // These metrics from Resource Timing API are more accurate than Navigation Timing API
      if (result.resourceStats.scriptParsingTime > 0 && metricDefinitions.scriptParsingTime) {
        metricDefinitions.scriptParsingTime.add(result.resourceStats.scriptParsingTime, tags);
      }
      
      if (result.resourceStats.scriptExecutionTime > 0 && metricDefinitions.scriptExecutionTime) {
        metricDefinitions.scriptExecutionTime.add(result.resourceStats.scriptExecutionTime, tags);
      }
      
      // Collect detailed resource metrics for top 5 network resources tables
      // but don't emit them directly - return them for the caller to emit
      if (result.resourceStats.detailedResources) {
        // Prepare resource metrics for the caller to emit
        result.resourceMetrics = {
          js: [],
          css: [],
          img: [],
          font: [],
          other: []
        };
        
        // Process JS resources
        if (result.resourceStats.detailedResources.js && result.resourceStats.detailedResources.js.length > 0) {
          result.resourceStats.detailedResources.js.forEach(resource => {
            result.resourceMetrics.js.push({
              url: String(resource.url || ''),
              duration: Number(resource.duration || 0),
              size: Number(resource.size || 0),
              status: Number(resource.status || 200),
              initiatorType: String(resource.initiatorType || 'script')
            });
          });
          // Collected JS resources
        }
        
        // Process CSS resources
        if (result.resourceStats.detailedResources.css && result.resourceStats.detailedResources.css.length > 0) {
          result.resourceStats.detailedResources.css.forEach(resource => {
            result.resourceMetrics.css.push({
              url: String(resource.url || ''),
              duration: Number(resource.duration || 0),
              size: Number(resource.size || 0),
              status: Number(resource.status || 200),
              initiatorType: String(resource.initiatorType || 'link')
            });
          });
          // Collected CSS resources
        }
        
        // Process image resources
        if (result.resourceStats.detailedResources.img && result.resourceStats.detailedResources.img.length > 0) {
          result.resourceStats.detailedResources.img.forEach(resource => {
            result.resourceMetrics.img.push({
              url: String(resource.url || ''),
              duration: Number(resource.duration || 0),
              size: Number(resource.size || 0),
              status: Number(resource.status || 200),
              initiatorType: String(resource.initiatorType || 'img')
            });
          });
          // Collected image resources
        }
        
        // Process font resources
        if (result.resourceStats.detailedResources.font && result.resourceStats.detailedResources.font.length > 0) {
          result.resourceStats.detailedResources.font.forEach(resource => {
            result.resourceMetrics.font.push({
              url: String(resource.url || ''),
              duration: Number(resource.duration || 0),
              size: Number(resource.size || 0),
              status: Number(resource.status || 200),
              initiatorType: String(resource.initiatorType || 'font')
            });
          });
          // Collected font resources
        }
        
        // Process other resources
        if (result.resourceStats.detailedResources.other && result.resourceStats.detailedResources.other.length > 0) {
          result.resourceStats.detailedResources.other.forEach(resource => {
            result.resourceMetrics.other.push({
              url: String(resource.url || ''),
              duration: Number(resource.duration || 0),
              size: Number(resource.size || 0),
              status: Number(resource.status || 200),
              initiatorType: String(resource.initiatorType || 'other')
            });
          });
          // Collected other resources
        }
      }
    }
    
    // Handle LCP recording
    const lcpValue = result.cwvMetrics && typeof result.cwvMetrics.lcp === 'number' ? result.cwvMetrics.lcp : null;
    
    // Record LCP if available
    if (typeof lcpValue === 'number' && metricDefinitions.lcpByTransaction) {
      metricDefinitions.lcpByTransaction.add(lcpValue, tags);
      // Recording LCP metric
    }
  } catch (error) {
    console.error(`[K6 BROWSER] Error in collectAllMetrics: ${error.message}`);
  }
  
  return result;
}