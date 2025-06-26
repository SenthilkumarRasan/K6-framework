/* globals __VU, __ITER */
/**
 * Browser utilities for K6 tests
 * Contains reusable browser test functions to simplify test scripts
 */
import { browser } from 'k6/browser';
import { scrollPageToMiddle } from './browserPageUtils.js';
import { collectAllMetrics } from './browserMetrics.js';

/**
 * Creates a new browser context with optimized settings for testing
 * @returns {Promise<import('k6/browser').BrowserContext>} The browser context
 */
export async function createBrowserContext() {
  return await browser.newContext({
    ignoreHTTPSErrors: true,
    bypassCSP: true,
    // Playwright-compatible flag; in most Chromium versions this effectively disables cache
    cacheEnabled: false
  });
}

/**
 * Loads a page and collects all metrics
 * @param {string} url - The URL to load
 * @param {Object} tags - Tags to apply to metrics
 * @param {Object} metricDefinitions - Object containing metric trend objects and options
 * @returns {Promise<{page: import('k6/browser').Page, success: boolean, metrics: Object}>} Page, success status, and metrics
 */
export async function loadPageAndCollectMetrics(url, tags, metricDefinitions) {
  console.log(`[loadPageAndCollectMetrics] Starting page load for transaction: ${tags.transaction}, URL: ${url}`);
  
  // Validate inputs
  if (!url || typeof url !== 'string') {
    console.error(`[loadPageAndCollectMetrics] Invalid URL: ${url}`);
    return { page: null, context: null, success: false, metrics: null };
  }
  
  if (!tags || !tags.transaction) {
    console.error(`[loadPageAndCollectMetrics] Missing transaction tag`);
    tags = tags || {};
    tags.transaction = 'unknown';
  }
  
  // Create browser context and page
  let context, page;
  try {
    context = await createBrowserContext();
    if (!context) {
      console.error(`[loadPageAndCollectMetrics] Failed to create browser context`);
      return { page: null, context: null, success: false, metrics: null };
    }
    
    page = await context.newPage();
    if (!page) {
      console.error(`[loadPageAndCollectMetrics] Failed to create page`);
      try { await context.close(); } catch (e) {}
      return { page: null, context: null, success: false, metrics: null };
    }
    
    // Add console log forwarding for debugging
    page.on('console', msg => {
      console.log(`[Browser Console] ${msg.text()}`);
    });
  } catch (contextError) {
    console.error(`[loadPageAndCollectMetrics] Error creating browser context/page: ${contextError.message}`);
    return { page: null, context: null, success: false, metrics: null };
  }
  
  let currentUrl = url;
  let pageLoadSuccessful = false;
  let metricsResult = null;

  try {
    // Load the page
    const startTime = new Date();
    let res;
    
    try {
      console.log(`[loadPageAndCollectMetrics] Navigating to ${url} for transaction: ${tags.transaction}`);
      
      // For the initial page load, we need to ensure navigation timing data is captured
      // First inject a script that will attach performance observers before navigation
      await page.evaluate(() => {
        // Create a flag to check if this is the first navigation
        window.__isFirstNavigation = true;
        
        // Setup performance observer to capture navigation timing
        if (typeof PerformanceObserver !== 'undefined') {
          try {
            console.log('[Navigation Observer] Setting up performance observer for navigation timing');
            const navObserver = new PerformanceObserver((entryList) => {
              const entries = entryList.getEntries();
              if (entries.length > 0) {
                console.log('[Navigation Observer] Navigation performance entry captured:', 
                  JSON.stringify({
                    type: entries[0].entryType,
                    name: entries[0].name,
                    startTime: entries[0].startTime,
                    duration: entries[0].duration,
                    ttfb: entries[0].responseStart - entries[0].requestStart,
                    serverTime: entries[0].responseStart - entries[0].requestStart
                  })
                );
              }
            });
            navObserver.observe({ entryTypes: ['navigation'] });
          } catch (e) {
            console.error('[Navigation Observer] Error setting up observer:', e);
          }
        }
      });
      
      // Now navigate to the URL with a longer timeout
      res = await page.goto(url, { waitUntil: 'load', timeout: 60000 });
      currentUrl = page.url();
      console.log(`[loadPageAndCollectMetrics] Navigation complete for ${tags.transaction}, actual URL: ${currentUrl}`);
      
    } catch (navError) {
      console.error(`[loadPageAndCollectMetrics] Navigation error for ${url} (Transaction: ${tags.transaction}): ${navError.message}`);
      
      // Record page load failure in metrics
      if (metricDefinitions.pageLoadSuccess) {
        metricDefinitions.pageLoadSuccess.add(false, { ...tags, error: 'NAVIGATION_ERROR' });
      }
      
      return { page, context, success: false, metrics: null };
    }

    // Check if page loaded successfully
    const status = res ? res.status() : 0;
    if (!res || (status !== 200 && status !== 0)) {
      console.error(`[K6 BROWSER] Page load failed for ${currentUrl}. Status: ${status}`);
      pageLoadSuccessful = false;
    } else {
      pageLoadSuccessful = true;
      console.log(`[loadPageAndCollectMetrics] Page loaded successfully for ${tags.transaction}, status: ${status}`);
    }

    // Record load time
    const loadTime = new Date() - startTime;
    if (metricDefinitions.pageLoadTime) {
      console.log(`[loadPageAndCollectMetrics] Adding page load time: ${loadTime}ms for ${tags.transaction}`);
      metricDefinitions.pageLoadTime.add(loadTime, tags);
    }
    if (metricDefinitions.pageLoadSuccess) {
      metricDefinitions.pageLoadSuccess.add(pageLoadSuccessful, tags);
    }

    // Skip metrics collection for special cases
    if (!pageLoadSuccessful || tags.transaction === 'serverStatus') {
      console.log(`[loadPageAndCollectMetrics] Skipping metrics collection for ${tags.transaction} (success=${pageLoadSuccessful})`);
      return { page, context, success: pageLoadSuccessful, metrics: null };
    }

    // Ensure navigation timing data is available before collecting metrics
    await page.evaluate(() => {
      if (performance.getEntriesByType('navigation').length === 0) {
        console.log('[Initial Navigation] No navigation entries found, checking if we can create them');
        
        // Try to use the legacy Navigation Timing API as fallback
        if (performance.timing) {
          console.log('[Initial Navigation] Using legacy Navigation Timing API');
          const timing = performance.timing;
          const navStartTime = timing.navigationStart;
          
          // Log the timing data for debugging
          console.log('[Initial Navigation] Navigation timing data:', 
            JSON.stringify({
              navigationStart: navStartTime,
              fetchStart: timing.fetchStart - navStartTime,
              domainLookupStart: timing.domainLookupStart - navStartTime,
              domainLookupEnd: timing.domainLookupEnd - navStartTime,
              connectStart: timing.connectStart - navStartTime,
              connectEnd: timing.connectEnd - navStartTime,
              requestStart: timing.requestStart - navStartTime,
              responseStart: timing.responseStart - navStartTime,
              responseEnd: timing.responseEnd - navStartTime,
              domLoading: timing.domLoading - navStartTime,
              domInteractive: timing.domInteractive - navStartTime,
              domContentLoadedEventStart: timing.domContentLoadedEventStart - navStartTime,
              domContentLoadedEventEnd: timing.domContentLoadedEventEnd - navStartTime,
              domComplete: timing.domComplete - navStartTime,
              loadEventStart: timing.loadEventStart - navStartTime,
              loadEventEnd: timing.loadEventEnd - navStartTime,
              serverTime: timing.responseStart - timing.requestStart,
              ttfb: timing.responseStart - timing.requestStart
            })
          );
        }
      } else {
        console.log('[Initial Navigation] Navigation entries already exist');
        const navEntry = performance.getEntriesByType('navigation')[0];
        console.log('[Initial Navigation] First navigation entry data:', 
          JSON.stringify({
            entryType: navEntry.entryType,
            startTime: navEntry.startTime,
            duration: navEntry.duration,
            ttfb: navEntry.responseStart - navEntry.requestStart,
            serverTime: navEntry.responseStart - navEntry.requestStart
          })
        );
      }
    });

    // Collect all metrics
    metricsResult = await collectAllMetrics(page, tags, metricDefinitions);

    // Scroll the page to middle to trigger lazy-loaded elements
    const scrolled = await scrollPageToMiddle(page);
    if (!scrolled) {
      console.warn(`[K6 BROWSER VU: ${__VU}, ITER: ${__ITER}] Error scrolling page ${currentUrl} (Transaction: ${tags.transaction}).`);
    }

    return { page, context, success: pageLoadSuccessful, metrics: metricsResult };
  } catch (error) {
    console.error(`[K6 BROWSER VU: ${__VU}, ITER: ${__ITER}] Error during page load and metrics collection for ${url}: ${error.message}`);
    return { page, context, success: false, metrics: null };
  }
}

/**
 * Safely closes browser resources
 * @param {import('k6/browser').Page} page - The browser page
 * @param {import('k6/browser').BrowserContext} context - The browser context
 */
export async function closeBrowserResources(page, context) {
  if (page) {
    try {
      await page.close();
    } catch (closeError) {
      console.error(`[K6 BROWSER] Error closing page: ${closeError.message}`);
    }
  }
  
  if (context) {
    try {
      await context.close();
    } catch (ctxError) {
      console.error(`[K6 BROWSER] Error closing context: ${ctxError.message}`);
    }
  }
}

/**
 * Builds browser scenario options with appropriate settings
 * @param {string} scenarioType - Type of scenario (e.g., 'smoke', 'loadtest')
 * @param {Object} baseScenario - Base scenario configuration
 * @returns {Object} Browser scenario configuration
 */
export function buildBrowserScenario(scenarioType, baseScenario) {
  const scenarioConfig = { ...baseScenario };
  
  // Ensure browser type is set
  if (!scenarioConfig.options) {
    scenarioConfig.options = { 
      browser: { 
        type: 'chromium',
        // Add browser stability settings
        args: [
          '--disable-dev-shm-usage',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-cache',
          '--disk-cache-size=0',
          '--disable-gpu',
          '--disable-web-security',
          '--allow-running-insecure-content'
        ]
      } 
    };
  }
  
  return scenarioConfig;
}

/**
 * Navigates to a new page by performing a click action and collects metrics after navigation
 * @param {import('k6/browser').Page} page - The browser page
 * @param {function} navigationAction - Async function that performs the navigation action (e.g., click)
 * @param {Object} tags - Tags to apply to metrics
 * @param {Object} metricDefinitions - Object containing metric trend objects and options
 * @param {Object} options - Navigation options (e.g., timeout)
 * @returns {Promise<{success: boolean, metrics: Object}>} Success status and metrics
 */
export async function performNavigationAndCollectMetrics(page, navigationAction, tags, metricDefinitions, options = {}) {
  const timeout = options.timeout || 30000;
  let success = false;
  let metricsResult = null;

  try {
    // Start timing before the navigation action
    const startTime = new Date();
    
    // Perform the navigation action (like clicking a button)
    try {
      // For subsequent navigations, we need to ensure the navigation timing data is reset
      // First, inject a script that will prepare for the upcoming navigation
      await page.evaluate(() => {
        console.log('[Navigation Reset] Preparing for navigation...');
        
        // Clear existing performance entries to ensure we get fresh data for this navigation
        if (typeof performance.clearResourceTimings === 'function') {
          console.log('[Navigation Reset] Clearing resource timings');
          performance.clearResourceTimings();
        }
        
        // Setup performance observer to capture navigation timing for this navigation
        if (typeof PerformanceObserver !== 'undefined') {
          try {
            console.log('[Navigation Reset] Setting up performance observer for navigation timing');
            const navObserver = new PerformanceObserver((entryList) => {
              const entries = entryList.getEntries();
              if (entries.length > 0) {
                console.log('[Navigation Reset] Navigation performance entry captured:', 
                  JSON.stringify({
                    type: entries[0].entryType,
                    name: entries[0].name,
                    startTime: entries[0].startTime,
                    duration: entries[0].duration,
                    ttfb: entries[0].responseStart - entries[0].requestStart,
                    serverTime: entries[0].responseStart - entries[0].requestStart
                  })
                );
              }
            });
            navObserver.observe({ entryTypes: ['navigation'] });
          } catch (e) {
            console.error('[Navigation Reset] Error setting up observer:', e);
          }
        }
      });
      
      // Now perform the actual navigation action
      await navigationAction();
      
      // Wait for navigation to complete
      await page.waitForNavigation({ waitUntil: 'load', timeout });
      
      // Optional wait time after navigation (for SPA or dynamic content to fully load)
      if (options.waitAfterNavigation) {
        await page.waitForTimeout(options.waitAfterNavigation);
      }
      
      success = true;
    } catch (navError) {
      console.error(`[K6 BROWSER VU: ${__VU}, ITER: ${__ITER}] Navigation action error (Transaction: ${tags.transaction}): ${navError.message}`);
      return { success: false, metrics: null };
    }

    // Record load time
    const loadTime = new Date() - startTime;
    if (metricDefinitions.pageLoadTime) {
      metricDefinitions.pageLoadTime.add(loadTime, tags);
    }
    if (metricDefinitions.pageLoadSuccess) {
      metricDefinitions.pageLoadSuccess.add(success, tags);
    }

    // Skip metrics collection for special cases
    if (!success || tags.transaction === 'serverStatus') {
      return { success, metrics: null };
    }

    // Collect all metrics
    metricsResult = await collectAllMetrics(page, tags, metricDefinitions);

    // Scroll the page to middle to trigger lazy-loaded elements
    const scrolled = await scrollPageToMiddle(page);
    if (!scrolled) {
      console.warn(`[K6 BROWSER VU: ${__VU}, ITER: ${__ITER}] Error scrolling page after navigation (Transaction: ${tags.transaction}).`);
    }

    return { success, metrics: metricsResult };
  } catch (error) {
    console.error(`[K6 BROWSER VU: ${__VU}, ITER: ${__ITER}] Error during navigation and metrics collection: ${error.message}`);
    return { success: false, metrics: null };
  }
}
