import { browser } from 'k6/browser';
import { sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

// Core Web Vitals metrics
const lcpTrend = new Trend('browser_lcp', { min: true, max: true, avg: true, med: true, p90: true, p95: true });
const fcpTrend = new Trend('browser_fcp', { min: true, max: true, avg: true, med: true, p90: true, p95: true });
const clsTrend = new Trend('browser_cls', { min: true, max: true, avg: true, med: true, p90: true, p95: true });
const ttfbTrend = new Trend('browser_ttfb', { min: true, max: true, avg: true, med: true, p90: true, p95: true });

// Counter for page load success
const pageLoadSuccess = new Counter('browser_page_load_success');

export const options = {
  scenarios: {
    ui: {
      executor: 'per-vu-iterations',
      options: {
        browser: {
          type: 'chromium',
        },
      },
      vus: 1,
      iterations: 2,
      maxDuration: '30s',
    },
  },
  thresholds: {
    'browser_lcp': ['p(90)<5000'], // LCP should be under 5s
    'browser_fcp': ['p(90)<3000'], // FCP should be under 3s
    'browser_ttfb': ['p(90)<1000'], // TTFB should be under 1s
  },
};

export default async function() {
  const page = browser.newPage();
  
  // Define tags for metrics
  const tags = {
    transaction: 'shape-homepage',
    url: 'https://www.shape.com'
  };
  
  try {
    // Navigate to Shape.com
    const response = await page.goto('https://www.shape.com');
    
    // Record success/failure
    if (response.status() >= 200 && response.status() < 400) {
      pageLoadSuccess.add(1, tags);
    } else {
      pageLoadSuccess.add(0, tags);
      console.error(`Failed to load page: ${response.status()}`);
      return;
    }
    
    // Wait for page to stabilize
    await page.waitForTimeout(3000);
    
    // Collect Core Web Vitals
    const webVitals = await page.evaluate(() => {
      return new Promise((resolve) => {
        const metrics = {
          lcp: null,
          fcp: null,
          cls: 0,
          ttfb: null
        };
        
        // Get LCP
        new PerformanceObserver((entryList) => {
          const entries = entryList.getEntries();
          const lastEntry = entries[entries.length - 1];
          metrics.lcp = lastEntry ? lastEntry.startTime : null;
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        
        // Get FCP
        new PerformanceObserver((entryList) => {
          const entries = entryList.getEntries();
          for (const entry of entries) {
            if (entry.name === 'first-contentful-paint') {
              metrics.fcp = entry.startTime;
            }
          }
        }).observe({ type: 'paint', buffered: true });
        
        // Get CLS
        new PerformanceObserver((entryList) => {
          for (const entry of entryList.getEntries()) {
            if (!entry.hadRecentInput) {
              metrics.cls += entry.value;
            }
          }
        }).observe({ type: 'layout-shift', buffered: true });
        
        // Get TTFB from Navigation Timing API
        const navEntry = performance.getEntriesByType('navigation')[0];
        if (navEntry) {
          metrics.ttfb = navEntry.responseStart - navEntry.requestStart;
        }
        
        // Allow time for metrics to be collected
        setTimeout(() => {
          // Direct measurement for metrics that might be missing
          if (metrics.lcp === null) {
            const lcpElements = performance.getEntriesByType('element');
            if (lcpElements.length > 0) {
              metrics.lcp = lcpElements[0].startTime;
            }
          }
          
          if (metrics.fcp === null) {
            const paintEntries = performance.getEntriesByType('paint');
            for (const entry of paintEntries) {
              if (entry.name === 'first-contentful-paint') {
                metrics.fcp = entry.startTime;
              }
            }
          }
          
          if (metrics.ttfb === null) {
            const navTiming = performance.getEntriesByType('navigation')[0];
            if (navTiming) {
              metrics.ttfb = navTiming.responseStart - navTiming.requestStart;
            }
          }
          
          // Log and resolve with collected metrics
          console.log('Web Vitals collected:', JSON.stringify(metrics));
          resolve(metrics);
        }, 2000);
      });
    });
    
    // Record metrics with tags
    if (webVitals.lcp !== null) lcpTrend.add(webVitals.lcp, tags);
    if (webVitals.fcp !== null) fcpTrend.add(webVitals.fcp, tags);
    if (webVitals.cls !== null) clsTrend.add(webVitals.cls, tags);
    if (webVitals.ttfb !== null) ttfbTrend.add(webVitals.ttfb, tags);
    
    // Log the collected metrics
    console.log(`[Web Vitals] LCP: ${webVitals.lcp}ms, FCP: ${webVitals.fcp}ms, CLS: ${webVitals.cls}, TTFB: ${webVitals.ttfb}ms`);
    
    // Scroll down to trigger more content loading
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight / 2);
    });
    
    await sleep(2);
    
  } finally {
    page.close();
  }
}
