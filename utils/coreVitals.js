import { Trend, Counter } from 'k6/metrics';

 

export function createMetricsGroup(name) {

    return {

        lcp: new Trend(`${name}_lcp`, ['name:' + name]),

        inp: new Trend(`${name}_inp`, ['name:' + name]),

        cls: new Trend(`${name}_cls`, ['name:' + name]),

        responseTime: new Trend(`${name}_response_time`, ['name:' + name]),

        count: new Counter(`${name}_count`, ['name:' + name]),

    };

}

 

export async function captureCoreWebVitals(page, groupMetrics) {

    const vitals = await page.evaluate(() => {

        return new Promise((resolve, reject) => {

            const metrics = { lcp: 0, inp: 0, cls: 0 };

            let lcpObserved = false;

            let inpObserved = false;

            let clsObserved = false;

 

            const observeLCP = new PerformanceObserver((list) => {

                const entries = list.getEntries();

                if (entries.length > 0) {

                    metrics.lcp = entries[entries.length - 1].startTime;

                    lcpObserved = true;

                    if (inpObserved && clsObserved) {

                        resolve(metrics);

                        observeLCP.disconnect();

                        observeINP.disconnect();

                        observeCLS.disconnect();

                    }

                }

            });

            observeLCP.observe({ type: 'largest-contentful-paint', buffered: true });

 

            const observeINP = new PerformanceObserver((list) => {

                const entries = list.getEntries();

                if (entries.length > 0) {

                    metrics.inp = entries[entries.length - 1].processingStart;

                    inpObserved = true;

                    if (lcpObserved && clsObserved) {

                        resolve(metrics);

                        observeLCP.disconnect();

                        observeINP.disconnect();

                        observeCLS.disconnect();

                    }

                }

            });

            observeINP.observe({ type: 'interaction', buffered: true });

 

            const observeCLS = new PerformanceObserver((list) => {

                const entries = list.getEntries();

                if (entries.length > 0) {

                    metrics.cls = entries.reduce((total, entry) => total + entry.value, 0);

                    clsObserved = true;

                    if (lcpObserved && inpObserved) {

                        resolve(metrics);

                        observeLCP.disconnect();

                        observeINP.disconnect();

                        observeCLS.disconnect();

                    }

                }

            });

            observeCLS.observe({ type: 'layout-shift', buffered: true });

 

            setTimeout(() => {

                resolve(metrics);

                observeLCP.disconnect();

                observeINP.disconnect();

                observeCLS.disconnect();

            }, 10000); // Increased timeout to 10000ms

 

            window.addEventListener('error', (e) => {

                reject(e.message);

            });

        });

    });

 

    groupMetrics.lcp.add(vitals.lcp);

    groupMetrics.inp.add(vitals.inp);

    groupMetrics.cls.add(vitals.cls);

 

    console.log(`Core Web Vitals - LCP: ${vitals.lcp}ms, INP: ${vitals.inp}ms, CLS: ${vitals.cls}`);

}