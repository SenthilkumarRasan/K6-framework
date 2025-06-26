import { buildMetricDefinitions } from '../../utils/browserMetrics.js';
import * as metrics from '../../utils/metrics.js';
import { loadPageAndCollectMetrics, closeBrowserResources, performNavigationAndCollectMetrics } from '../../utils/browserUtils.js';

const baseUrl = __ENV.BASE_URL || 'https://grafana.com';
const headless = String(__ENV.HEADLESS_BROWSER || 'false').toLowerCase() === 'true';

// Build metric definitions with all needed metrics enabled
// We'll set includeResourceMetrics to true to properly collect resource metrics
const metricDefinitions = buildMetricDefinitions(metrics, {
  includeCoreWebVitals: true,
  includeDetailedTimingMetrics: true,
  includeResourceMetrics: true,  // Set to true to collect aggregated resource metrics data
  resourceSampleRate: 1.0        // Sample 100% of resources for better data collection
});

export const options = {
  scenarios: {
    ui: {
      executor: 'shared-iterations',
      vus: 1,  // Reduce to 1 VU for more reliable testing
      iterations: 2,  // Reduce iterations to just 2 for testing
      options: {
        browser: {
          type: 'chromium',
          headless: headless,
        },
      },
    },
  },
};

export async function setup() {
  try {
    console.log("Test setup complete - will collect metrics for Grafana search test");
  } catch (error) {
    console.error("Error during setup:", error.message);
  }
}

export default async function () {
  let page, context;
  try {
    console.log('[TEST] Starting test');
    // Transaction 1: Home Page Load
    let tags = { transaction: 'GrafanaHome', url: baseUrl };
    const homeResult = await loadPageAndCollectMetrics(baseUrl, tags, metricDefinitions);
    if (!homeResult.success) {
      console.error('[TEST] Failed to load Grafana homepage');
      return;
    }
    page = homeResult.page;
    context = homeResult.context;
    await page.waitForTimeout(2000);

    // Transaction 2: Open search, enter 'k6', and click 'Site search' button (navigation)
    tags = { transaction: 'GrafanaSiteSearch', searchTerm: 'k6' };
    console.log('[TEST] Performing site search for "k6"');

    // Click the search SVG icon
    console.log('[TEST] Clicking on search SVG icon');
    await page.waitForSelector('svg[viewBox="0 0 18 18"]');
    await page.evaluate(() => {
      // Find the SVG with the specific viewBox and click its parent button
      const searchSvg = document.querySelector('svg[viewBox="0 0 18 18"]');
      if (searchSvg && searchSvg.closest('button')) {
        searchSvg.closest('button').click();
        console.log('[BROWSER] Search button clicked');
      } else {
        console.log('[BROWSER] Search SVG or button not found');
      }
    });
    await page.waitForTimeout(1000);

    // Enter 'k6' in the search input with data-modal attribute
    console.log('[TEST] Typing "k6" in search input');
    await page.waitForSelector('input.mega-menu__dialog--body--input[placeholder="What do you want to know?"]');
    await page.type('input.mega-menu__dialog--body--input[placeholder="What do you want to know?"]', 'k6');
    await page.waitForTimeout(1000);

    // Use performNavigationAndCollectMetrics for the button click that triggers navigation
    await performNavigationAndCollectMetrics(
      page,
      async () => {
        // Click the 'Site search' button
        console.log('[TEST] Clicking Site search button');
        await page.evaluate(() => {
          const siteSearchBtn = document.querySelector('button.mega-menu__dialog--body--action-container--button');
          if (siteSearchBtn) {
            console.log('[BROWSER] Site search button found, clicking it');
            siteSearchBtn.click();
          } else {
            console.log('[BROWSER] Site search button not found');
          }
        });
      },
      tags,
      metricDefinitions
    );
    await page.waitForTimeout(2000);

  } catch (err) {
    console.error('[TEST] Error during test execution:', err.message || 'Unknown error');
    if (err && err.stack) {
      console.error('[TEST] Error stack:', err.stack);
    }
  } finally {
    if (page && context) {
      await closeBrowserResources(page, context);
    } else if (context) {
      try { await context.close(); } catch (e) {}
    }
  }
}
