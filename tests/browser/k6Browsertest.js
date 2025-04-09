import { browser } from 'k6/browser';
import { check } from 'https://jslib.k6.io/k6-utils/1.5.0/index.js';
import { sleep } from 'k6';
import { scenarios, thresholds, buildCustomScenario } from '../../config/scenario.js';

// Determine if the test is for API or BROWSER
const testType = __ENV.TEST_TYPE || 'BROWSER'; // Default to BROWSER if not specified
const scenarioType = __ENV.SCENARIO_TYPE || 'smoke'; // Default to smoke if not specified
const headless = __ENV.HEADLESS_BROWSER === 'true'; // Convert to boolean

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

export async function setup() {
  // Setup logic if needed
}

export default async function () {
  let context, page;
  try {
    context = await browser.newContext({ headless });
    page = await context.newPage();
    // Navigate and Login
    await page.goto('https://beb-ready.ebanking-services.com/eAM/Credential/Index?brand=840_081203790&appId=CeB&FIORG=840&FIFID=081203790&orgId=840_081203790', { tags: { name: 'goto' } });
    await page.waitForSelector('input[name="userId"]', { state: 'visible' });
    const userIdInput = page.locator('input[name="userId"]');
    await userIdInput.type('igor.840', { tags: { name: 'type_login' } });
    await page.waitForSelector('input[value="Continue"]');
    await page.locator('input[value="Continue"]').click();
    await page.locator('input[id="secretCode"]').type('TESTtest$9', { tags: { name: 'type_password' } });
    const submitButton = page.locator('input[type="submit"]');
    await submitButton.click({ tags: { name: 'click_submit' } });

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'load', timeout: 60000 })
    ]);

    // Periodically check for the popup and close it if it appears
    let popupClosed = false;
    for (let i = 0; i < 10; i++) { // Adjust the number of iterations as needed
      const closeButton = page.locator('i.icon-x[title="Close"]');
      if (await closeButton.count() > 0) {
        await closeButton.click();
        console.log('Popup closed.');
        popupClosed = true;
        break;
      }
      await page.waitForTimeout(500); // Wait for 0.5 second before checking again
    }

    if (!popupClosed) {
      console.log('Popup did not appear.');
    }

    console.log('waiting for account info.');
    await page.waitForSelector('div.account-info');
    sleep(5);

    // Check Welcome Message
    // await check(page.locator('h3'), {
    //     header: async (h3) => (await h3.textContent()) == 'Assets',
    // });

    console.log('check completed.');
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
