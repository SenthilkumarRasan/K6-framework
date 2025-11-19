import { browser } from 'k6/browser';
import { scenarios, thresholds } from '../../config/scenario.js';
import { buildCustomScenario } from '../../utils/buildCustomScenario.js';
import { createMetricsGroup, captureCoreWebVitals } from '../../utils/coreVitals.js';

// This script is a browser test sample using k6. It navigates to a login page, performs login actions, checks for specific elements on the page, 
// and captures core web vitals metrics for page navigation

// Determine if the test is for API or BROWSER
const testType = __ENV.TEST_TYPE || 'BROWSER'; // Default to BROWSER if not specified
const scenarioType = __ENV.SCENARIO_TYPE || 'smoke'; // Default to smoke if not specified
const headless = __ENV.HEADLESS_BROWSER === 'true'; // Convert to boolean
const env = __ENV.ENVIRONMENT || 'qa';

const testConfig = JSON.parse(open(`../../env/${env.toLowerCase()}.json`)); // load environment config data

// Build scenario configuration based on the scenario type
let scenarioConfig;
if (scenarioType === 'custom-tps' || scenarioType === 'custom-vus') {
  scenarioConfig = buildCustomScenario(scenarioType, __ENV.RAMPING_STAGES);
} else {
  scenarioConfig = scenarios[testType][scenarioType];
}

// Ensure browser type is set for BROWSER test type
if (testType === 'BROWSER' && !scenarioConfig.options) {
  scenarioConfig.options = { browser: { type: 'chromium' } };
}

export const options = {
  thresholds: thresholds[testType],
  scenarios: {
    custom_scenario: {
      ...scenarioConfig,
      tags: {
        environment: __ENV.ENVIRONMENT,
        scenario: scenarioType,
        transaction: 'login_page',
      },
    },
  },
};

// Predefine metrics in the init context
const metrics = {
  HomePageLoad: createMetricsGroup('HomePageLoad'),
  LoginFlow: createMetricsGroup('LoginFlow'),
  Accountpageload: createMetricsGroup('AccountPageLoad'),
};

export async function setup() {
  // Setup logic if needed
}

export default async function () {
  let context, page;
  try {
    context = await browser.newContext({ headless });
    page = await context.newPage();
    // Navigate and Login
    const homePageLoadStart = new Date();
    await page.goto(testConfig.baseURL, { tags: { name: 'goto' } });
    await page.waitForSelector('input[name="userId"]', { state: 'visible' });
    const homePageLoadEnd = new Date();
    metrics.HomePageLoad.responseTime.add(homePageLoadEnd - homePageLoadStart);
    metrics.HomePageLoad.count.add(1);
    await captureCoreWebVitals(page, metrics.HomePageLoad);
    const userIdInput = page.locator('input[name="userId"]');
    await userIdInput.type(`${testConfig.userName}`, { tags: { name: 'type_login' } });
    await page.waitForSelector('input[value="Continue"]');
    await page.locator('input[value="Continue"]').click();
    await page.locator('input[id="secretCode"]').type(`${testConfig.password}`, { tags: { name: 'type_password' } });
    const submitButton = page.locator('input[type="submit"]');
    const loginFlowStart = new Date();
    await submitButton.click({ tags: { name: 'click_submit' } });

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'load', timeout: 60000 })
    ]);

    try {
      console.log('waiting for account info.');
      await page.waitForSelector('div.account-info', { timeout: 60000 });
      const loginFlowEnd = new Date();
      metrics.LoginFlow.responseTime.add(loginFlowEnd - loginFlowStart);
      metrics.LoginFlow.count.add(1);
      await captureCoreWebVitals(page, metrics.LoginFlow);
      await page.waitForLoadState('load', { timeout: 20000 });
    } catch (error) {
      console.error('Error capturing Core Web Vitals:', error);
    }

  } finally {
    if (page) {
      await page.close();
    }
    if (context) {
      await context.close();
    }
  }
}

export async function teardown() {
  // Teardown logic if needed
}
