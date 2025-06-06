import { browser } from 'k6/browser';

// Collect Core Web Vitals metrics from the page context
export async function collectCoreWebVitals(page, tags) {
  console.log('collectCoreWebVitals called');
  try {
    // Wait for a short period to allow metrics to settle
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Evaluate in the browser context
    const metrics = await page.evaluate(async () => {
      return new Promise((resolve) => {
        let lcp = 0;
        let fcp = 0;
        let cls = 0;
        let ttfb = 0;

        // Track cumulative layout shift
        let clsValue = 0;
        let sessionValue = 0;
        let sessionEntries = [];

        // LCP
        const lcpObserver = new PerformanceObserver((entryList) => {
          const entries = entryList.getEntries();
          for (const entry of entries) {
            lcp = entry.renderTime || entry.loadTime || entry.startTime || lcp;
          }
        });
        lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });

        // FCP
        const fcpObserver = new PerformanceObserver((entryList) => {
          const entries = entryList.getEntries();
          for (const entry of entries) {
            if (entry.name === 'first-contentful-paint') {
              fcp = entry.startTime || fcp;
            }
          }
        });
        fcpObserver.observe({ type: 'paint', buffered: true });

        // CLS
        const clsObserver = new PerformanceObserver((entryList) => {
          for (const entry of entryList.getEntries()) {
            // Only count layout shifts without recent user input.
            if (!entry.hadRecentInput) {
              sessionValue += entry.value;
              sessionEntries.push(entry);
            }
          }
        });
        clsObserver.observe({ type: 'layout-shift', buffered: true });

        // TTFB (from navigation timing)
        const navEntries = performance.getEntriesByType('navigation');
        if (navEntries && navEntries.length > 0) {
          ttfb = navEntries[0].responseStart;
        }

        // Wait for a short period to ensure all metrics are collected
        setTimeout(() => {
          lcpObserver.disconnect();
          fcpObserver.disconnect();
          clsObserver.disconnect();
          cls = sessionValue;

          // Defensive: If metrics are undefined, set to 0
          resolve({
            lcp: typeof lcp === 'number' && !isNaN(lcp) ? lcp : 0,
            fcp: typeof fcp === 'number' && !isNaN(fcp) ? fcp : 0,
            cls: typeof cls === 'number' && !isNaN(cls) ? cls : 0,
            ttfb: typeof ttfb === 'number' && !isNaN(ttfb) ? ttfb : 0
          });
        }, 1000);
      });
    });

    // Defensive: Ensure all metrics are numbers
    return {
      lcp: typeof metrics.lcp === 'number' && !isNaN(metrics.lcp) ? metrics.lcp : 0,
      fcp: typeof metrics.fcp === 'number' && !isNaN(metrics.fcp) ? metrics.fcp : 0,
      cls: typeof metrics.cls === 'number' && !isNaN(metrics.cls) ? metrics.cls : 0,
      ttfb: typeof metrics.ttfb === 'number' && !isNaN(metrics.ttfb) ? metrics.ttfb : 0
    };
  } catch (error) {
    console.error('Error collecting Core Web Vitals:', error);
    return { lcp: 0, fcp: 0, cls: 0, ttfb: 0 };
  }
}