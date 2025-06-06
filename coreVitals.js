/**
 * Collects Core Web Vitals (LCP, FCP, CLS, TTFB) from the page using PerformanceObserver.
 * @param {import('k6/experimental/browser').Page} page - The k6 browser page object.
 * @returns {Promise<{lcp: number|null, fcp: number|null, cls: number|null, ttfb: number|null}>}
 */
export async function collectCoreWebVitals(page) {
  try {
    const metrics = await page.evaluate(() => {
      return new Promise((resolve) => {
        const result = { lcp: null, fcp: null, cls: 0, ttfb: null }; 
        let ttfbReportedByObserver = false;

        const observer = new PerformanceObserver((entryList) => {
          for (const entry of entryList.getEntries()) {
            switch (entry.entryType) {
              case 'largest-contentful-paint':
                result.lcp = entry.startTime;
                break;
              case 'paint':
                if (entry.name === 'first-contentful-paint') {
                  result.fcp = entry.startTime;
                }
                break;
              case 'layout-shift':
                // @ts-ignore
                if (!entry.hadRecentInput) {
                  // @ts-ignore
                  result.cls += entry.value;
                }
                break;
              case 'navigation':
                // @ts-ignore
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
          // Resolve with potentially empty/partial results if observer setup fails, to avoid hanging
          setTimeout(() => resolve(result), 0); 
          return;
        }

        // Fallback for TTFB if observer didn't report it (e.g., if 'navigation' type observation is unreliable)
        // This timeout allows buffered entries to be processed by the observer first.
        setTimeout(() => {
          if (!ttfbReportedByObserver) {
            try {
              const navEntries = performance.getEntriesByType('navigation');
              if (navEntries.length > 0) {
                const navEntry = navEntries[0];
                // @ts-ignore
                result.ttfb = navEntry.responseStart - navEntry.requestStart;
              }
            } catch (e) { /* ignore if Navigation Timing API also fails */ }
          }
        }, 100); // Short delay to allow observer to pick up buffered navigation entry first
        
        // Resolve after a timeout to allow metrics to be collected.
        // LCP and CLS can change over time. 5 seconds is a common window.
        setTimeout(() => {
          observer.disconnect();
          resolve(result);
        }, 5000); // 5-second observation window
      });
    });
    return metrics;
  } catch (e) {
    console.error(`[K6 BROWSER CWV] Error in collectCoreWebVitals page.evaluate: ${e.message}`);
    return { lcp: null, fcp: null, cls: 0, ttfb: null }; // Return nulls/zero on error
  }
}