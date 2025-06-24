/* globals __VU, __ITER */
/**
 * Browser utilities for K6 tests
 * Contains reusable browser test functions to simplify test scripts
 */
import { browser } from 'k6/browser';
import { scrollPageToMiddle } from './browserPageUtils.js';
import { collectAllMetrics, recordMantleMetrics } from './browserMetrics.js';

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
  const context = await createBrowserContext();
  const page = await context.newPage();
  let currentUrl = url;
  let pageLoadSuccessful = false;
  let metricsResult = null;

  try {
    // Load the page
    const startTime = new Date();
    let res;
    
    try {
      res = await page.goto(url, { waitUntil: 'load', timeout: 60000 });
      currentUrl = page.url();
    } catch (navError) {
      console.error(`[K6 BROWSER VU: ${__VU}, ITER: ${__ITER}] Navigation error for ${url} (Transaction: ${tags.transaction}): ${navError.message}`);
      return { page, context, success: false, metrics: null };
    }

    // Check if page loaded successfully
    const status = res ? res.status() : 0;
    if (!res || (status !== 200 && status !== 0)) {
      console.error(`[K6 BROWSER] Page load failed for ${currentUrl}. Status: ${status}`);
      pageLoadSuccessful = false;
    } else {
      pageLoadSuccessful = true;
    }

    // Record load time
    const loadTime = new Date() - startTime;
    if (metricDefinitions.pageLoadTime) {
      metricDefinitions.pageLoadTime.add(loadTime, tags);
    }
    if (metricDefinitions.pageLoadSuccess) {
      metricDefinitions.pageLoadSuccess.add(pageLoadSuccessful, tags);
    }

    // Skip metrics collection for special cases
    if (!pageLoadSuccessful || tags.transaction === 'serverStatus') {
      return { page, context, success: pageLoadSuccessful, metrics: null };
    }

    // Collect all metrics
    metricsResult = await collectAllMetrics(page, tags, metricDefinitions);

    // Scroll the page to middle to trigger lazy-loaded elements
    const scrolled = await scrollPageToMiddle(page);
    if (!scrolled) {
      console.warn(`[K6 BROWSER VU: ${__VU}, ITER: ${__ITER}] Error scrolling page ${currentUrl} (Transaction: ${tags.transaction}).`);
    }

    // Collect Mantle metrics if enabled (check if flag exists in metricDefinitions)
    if (metricDefinitions._options && metricDefinitions._options.captureMantleMetrics) {
      await collectMantleMetrics(page, tags, metricDefinitions);
    }

    return { page, context, success: pageLoadSuccessful, metrics: metricsResult };
  } catch (error) {
    console.error(`[K6 BROWSER VU: ${__VU}, ITER: ${__ITER}] Error during page load and metrics collection for ${url}: ${error.message}`);
    return { page, context, success: false, metrics: null };
  }
}

/**
 * Collects Mantle metrics from the page
 * @param {import('k6/browser').Page} page - The browser page
 * @param {Object} tags - Tags to apply to metrics
 * @param {Object} metricDefinitions - Object containing metric trend objects
 * @returns {Promise<Object|null>} Mantle metrics or null if not available
 */
export async function collectMantleMetrics(page, tags, metricDefinitions = {}) {
  try {
    // Extract only Mantle metric definitions
    const mantleMetricDefinitions = {};
    Object.keys(metricDefinitions).forEach(key => {
      if (key.startsWith('mantle_')) {
        mantleMetricDefinitions[key.replace('mantle_', '')] = metricDefinitions[key];
      }
    });

    // Collecting Mantle metrics after page scroll
    const mantleMetrics = await page.evaluate(() => {
      if (!window.Mntl || typeof window.Mntl.trace !== 'function') return null;
      try { 
        return window.Mntl.trace(); 
      } catch (evalError) { 
        console.warn(`Mntl.trace() error: ${evalError.message}`); 
        return null; 
      }
    });
    
    if (mantleMetrics && Object.keys(mantleMetrics).length > 0) {
      recordMantleMetrics(mantleMetrics, tags, mantleMetricDefinitions);
      return mantleMetrics;
    }
    return null;
  } catch (mantleError) {
    console.error(`[K6 BROWSER] Error collecting Mantle metrics: ${mantleError.message}`);
    return null;
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
