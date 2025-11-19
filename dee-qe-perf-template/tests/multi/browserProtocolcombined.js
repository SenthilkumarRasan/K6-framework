import { browser } from 'k6/browser';
import { check } from 'https://jslib.k6.io/k6-utils/1.5.0/index.js';
import http from 'k6/http';
import { handleSummary } from '../../utils/handleSummary.js';

export const options = {
  scenarios: {
    browser: {
      executor: 'constant-vus',
      exec: 'browserTest',
      vus: 1,
      duration: '10s',
      options: {
        browser: {
          type: 'chromium',
        },
      },
      tags: { scenario: 'browser' }, // Tag for scenario level
    },
    news: {
      executor: 'constant-vus',
      exec: 'news',
      vus: 2,
      duration: '10s',
      tags: { scenario: 'news' }, // Tag for scenario level
    },
  },
};

export async function browserTest() {
  const page = await browser.newPage();

  try {
    // Goto Browser Page
    await page.goto('https://test.k6.io/browser.php');

    // Check Checkbox
    await page.locator('#checkbox1').check();

    await check(page.locator('#checkbox-info-display'), {
      'checkbox is checked': async lo =>
        await lo.textContent() === 'Thanks for checking the box',
    });
  } finally {
    await page.close();
  }
}

export async function news() {
  // Get News
  try {
    const res = await http.get('https://test.k6.io/news.php');

    if (res) {
      console.log('HTTP response:', res);
      check(res, {
        'status is 200': (r) => r.status === 200,
      });
    } else {
      console.error('HTTP response is undefined');
    }
  } catch (error) {
    console.error('Error during HTTP request:', error);
  }
}

// Add this to get HTML summary.
export { handleSummary };