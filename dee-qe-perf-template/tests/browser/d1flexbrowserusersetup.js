import { browser } from 'k6/browser';
import { scenarios, thresholds } from '../../config/scenario.js';
import { buildCustomScenario } from '../../utils/buildCustomScenario.js';
import { createMetricsGroup } from '../../utils/coreVitals.js';
import { SharedArray } from 'k6/data';
import { parseCsvWithHeaders, createCsvIterator } from '../../utils/csvReader.js';
import { htmlReport } from '../../utils/bundle.js';
import { exists } from 'k6/fs';

// This script is a browser test sample using k6. It navigates to a login page, performs login actions, checks for specific elements on the page, 
// and captures core web vitals metrics for page navigation

// --- CSV Data Setup (SharedArray for VUs) ---
const csvFilename = __ENV.CSV_FILENAME || 'd1flexuiusersetup_uat.csv';
const csvFilePath = `../../testdata/${csvFilename}`;
if (!exists(csvFilePath)) {
  throw new Error(`[k6] CSV file not found: ${csvFilePath}`);
}

const parsedCsvData = new SharedArray('shared array', function () {
  try {
    let csvContent;
    try {
      // Try to read the file
      csvContent = open(csvFilePath);
      console.log(`[k6] Successfully loaded CSV from ${csvFilePath}`);
    } catch (readError) {
      // If file can't be read, throw error and do not use fallback
      console.log(`[k6] Could not read CSV file: ${readError}. No default data will be used.`);
      throw readError;
    }

    // Parse the CSV
    const result = parseCsvWithHeaders(csvContent);

    // Ensure we have data
    if (!result || !Array.isArray(result) || result.length === 0) {
      console.log('[k6] CSV parsing returned empty result, aborting.');
      throw new Error('CSV parsing returned empty result');
    }

    return result;
  } catch (error) {
    console.log(`[k6] Error in CSV processing: ${error}. No default data will be used.`);
    throw error;
  }
});
const userIterator = createCsvIterator(parsedCsvData, { selectionMode: 'global_sequential' });

// Determine if the test is for API or BROWSER
const testType = __ENV.TEST_TYPE || 'BROWSER'; // Default to BROWSER if not specified
const scenarioType = __ENV.SCENARIO_TYPE || 'smoke'; // Default to smoke if not specified
const headless = __ENV.HEADLESS === 'true' || __ENV.HEADLESS === true;
const env = __ENV.ENVIRONMENT || 'perf';

const envFilePath = `../../env/${env.toLowerCase()}.json`;
if (!exists(envFilePath)) {
  throw new Error(`[k6] Environment config file not found: ${envFilePath}`);
}
const testConfig = JSON.parse(open(envFilePath)); // load environment config data

// Use the correct UI base URL for UAT
const uibaseURL = testConfig.d1flex.uibaseURL;
console.log(`[k6] Using uibaseURL: ${uibaseURL}`);

// Double check that all required configuration values are present
if (!uibaseURL) {
  console.error('[k6] ERROR: uibaseURL is not defined in config. testConfig.d1flex:', JSON.stringify(testConfig.d1flex));
  throw new Error('uibaseURL is not defined in configuration');
}

// Build scenario configuration based on the scenario type
let scenarioConfig;
if (scenarioType === 'custom-tps' || scenarioType === 'custom-vus') {
  scenarioConfig = buildCustomScenario(scenarioType, __ENV.RAMPING_STAGES);
} else {
  scenarioConfig = scenarios[testType][scenarioType];
}

// Ensure browser type is set for BROWSER test type
if (testType === 'BROWSER' && scenarioConfig && !scenarioConfig.options) {
  scenarioConfig.options = { browser: { type: 'chromium' } };
}

// Allow VUs and iterations to be overridden by environment variables if using shared-iterations
const vus = parseInt(__ENV.VUS || scenarioConfig?.vus || '1', 10);
const iterations = parseInt(__ENV.ITERATIONS || scenarioConfig?.iterations || '10', 10);

export const options = {
  thresholds: thresholds[testType],
  scenarios: {
    browser_scenario: {
      ...scenarioConfig, // Use the actual scenario configuration
      options: {
        browser: {
          type: 'chromium'
        }
      },
      env: {
        BROWSER_TYPE: 'chromium',
        BROWSER_ENABLED: 'true'
      },
      tags: {
        environment: __ENV.ENVIRONMENT,
        scenario: scenarioType,
        transaction: 'login_page',
      },
      // Only override with environment variables if they're provided
      ...(process.env.VUS && { vus }),
      ...(process.env.ITERATIONS && { iterations }),
    },
  },
};

// Predefine metrics in the init context
const _metrics = {
  HomePageLoad: createMetricsGroup('HomePageLoad'),
  LoginFlow: createMetricsGroup('LoginFlow'),
  AccountPageLoad: createMetricsGroup('AccountPageLoad'),
  TransactionSection: createMetricsGroup('TransactionSection')
};

// Track all unique API endpoints seen (global scope)
const _seenApiPaths = new Set();

// Collect all CSV rows in an array
const csvRows = ['fiIdentifier,username,password,accountid,customerid'];

export async function setup() {
  // Setup logic if needed
  return {};
}

export default async function () {
  const account = userIterator.next();
  if (!account) {
    console.warn('[k6] No account data available for this iteration. Skipping.');
    return;
  }

  const context = await browser.newContext({ headless, serviceWorkers: 'block' });
  const page = await context.newPage();

  // Initialize with empty values or prefilled values if they exist in the CSV already
  let accountId = account.accountid || '';
  let customerId = account.customerid || '';
  let fiIdentifier = account.fiIdentifier || account.fiidentifier || ''; // Try both casing variants

  // Log all network requests to debug
  page.on('request', async request => {
    const url = request.url();
    const method = request.method();

    // Look for account information in transaction history API
    if (url.includes('AcctTransactionHistoryInqSVC') && method === 'POST') {
      try {
        const postData = request.postData();
        if (postData) {
          try {
            const data = JSON.parse(postData);
            if (data && data._p) {
              const parts = String(data._p).split(',');
              if (parts.length >= 3) {
                accountId = parts[0];
                customerId = parts[parts.length - 1];
                fiIdentifier = parts[2];
                console.log(`[k6] Collected for user ${account.username}: accountId=${accountId}, customerId=${customerId}, fiIdentifier=${fiIdentifier}`);
              }
            }
          } catch (parseError) {
            console.warn('[k6] Failed to parse POST data JSON:', parseError.message);
          }
        }
      } catch (requestError) {
        console.warn('[k6] Failed to get POST data from request:', requestError.message);
      }
    }
  });

  await page.goto(uibaseURL);
  // Update selector to match <input id="userId" ...>
  await page.waitForSelector('input[id="userId"]', { state: 'visible', timeout: 10000 });
  await page.locator('input[id="userId"]').type(account.username);
  // Update selector to match <input id="signin" ...> for Continue after username
  await page.waitForSelector('input[id="signin"]', { state: 'visible', timeout: 10000 });
  await page.locator('input[id="signin"]').click();
  // Update selector to match <input id="secretCode" ...> for password
  await page.waitForSelector('input[id="secretCode"]', { state: 'visible', timeout: 10000 });
  await page.locator('input[id="secretCode"]').type(account.password);
  // Update selector to match <input id="signin" ...> for Sign In (if reused)
  await page.waitForSelector('input[id="signin"]', { state: 'visible', timeout: 10000 });
  await page.locator('input[id="signin"]').click();
  await page.waitForNavigation({ waitUntil: 'load', timeout: 30000 });

  // Simple password reset handling - add .catch to make each step optional
  await page.waitForTimeout(2000);

  // Try to find newCode field but don't fail if not found
  const hasNewCodeField = await page.isVisible('input[id="newCode"]', { timeout: 3000 }).catch(() => false);

  // Only attempt password reset if the field is present
  if (hasNewCodeField) {
    console.log('[k6] Password reset field detected - entering new credentials');

    // Enter new password
    await page.locator('input[id="newCode"]').type('Password#0');

    // Enter confirmation password
    await page.locator('input[id="confirmCode"]').type('Password#0').catch(() => { });

    // Click submit button - using the specific selector for the Submit button
    await page.locator('input[type="submit"][id="signin"][value="Submit"]').click();

    // Wait for navigation after submission
    await page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }).catch(() => { });
    console.log('[k6] Completed password reset submission');

    // Handle additional "Continue" button that may appear after password reset
    await page.waitForTimeout(2000);
    const hasContinueButton = await page.isVisible('input[type="submit"][id="signin"][value="Continue"]', { timeout: 5000 }).catch(() => false);
    if (hasContinueButton) {
      await page.locator('input[type="submit"][id="signin"][value="Continue"]').click();
      console.log('[k6] Clicked Continue button after password reset');
      await page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }).catch(() => { });
      await page.waitForTimeout(2000);
      // Handle checkbox that might appear after clicking Continue
      await page.waitForTimeout(2000);

      // First check if there's a modal dialog
      const modalSelector = 'mat-dialog-container, div.mat-dialog-container';
      const hasModal = await page.isVisible(modalSelector, { timeout: 10000 }).catch(() => false);

      if (hasModal) {
        console.log('[k6] Modal dialog found, looking for checkbox inside modal');
        // Use page.evaluate to find and click the checkbox inside the modal
        await page.evaluate(() => {
          const modal = document.querySelector('mat-dialog-container') || document.querySelector('div.mat-dialog-container');
          if (modal) {
            // Try multiple approaches to click the checkbox inside modal

            // Approach 1: Click the checkbox container/label instead of the hidden input
            const checkboxContainer = modal.querySelector('.mat-checkbox-layout');
            if (checkboxContainer) {
              checkboxContainer.click();
              console.log('Checkbox container clicked inside modal');
              return true;
            }

            // Approach 2: Click the parent mat-checkbox element
            const matCheckbox = modal.querySelector('mat-checkbox');
            if (matCheckbox) {
              matCheckbox.click();
              console.log('Mat-checkbox element clicked inside modal');
              return true;
            }

            // Approach 3: Try clicking the hidden input directly (may not work due to cdk-visually-hidden)
            const checkbox = modal.querySelector('input[type="checkbox"]#mat-checkbox-1-input');
            if (checkbox) {
              // Try to use programmatic change instead of click for hidden elements
              checkbox.checked = true;
              // Dispatch both change and click events to ensure Angular detects the change
              checkbox.dispatchEvent(new Event('change', { bubbles: true }));
              checkbox.dispatchEvent(new Event('click', { bubbles: true }));
              console.log('Checkbox input programmatically checked inside modal');
              return true;
            }

            // Approach 4: Click any visible checkbox-related element in modal
            const anyCheckboxElement = modal.querySelector('.mat-checkbox');
            if (anyCheckboxElement) {
              anyCheckboxElement.click();
              console.log('Found and clicked a checkbox-related element inside modal');
              return true;
            }

            console.warn('No checkbox elements found inside modal by any method');
            return false;
          }
          return false;
        });
      } else {
        // Fallback to searching in the main document
        console.log('[k6] No modal found, checking for checkbox in main document');
        const hasCheckbox = await page.isVisible('input[type="checkbox"][id="mat-checkbox-1-input"]', { timeout: 25000 }).catch(() => false);
        if (hasCheckbox) {
          // Use direct DOM logic via page.evaluate as requested
          await page.evaluate(() => {
            const checkbox = document.getElementById('mat-checkbox-1-input');
            if (checkbox) {
              checkbox.click();
              console.log('Checkbox clicked');
            } else {
              console.warn('Checkbox input not found');
            }
          });
        }
        console.log('[k6] Clicked checkbox after password reset');
        await page.waitForTimeout(1000);

        // Look for another continue/submit button after checkbox
        const hasAnotherButton = await page.isVisible('button:has-text("Continue"), button:has-text("Submit"), input[type="submit"]', { timeout: 3000 }).catch(() => false);
        if (hasAnotherButton) {
          await page.locator('button:has-text("Continue"), button:has-text("Submit"), input[type="submit"]').first().click();
          console.log('[k6] Clicked button after checkbox');
          await page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }).catch(() => { });
        }

        // If we had a modal before, look for Accept button in the modal first
        if (hasModal) {
          console.log('[k6] Looking for Accept button inside modal');
          await page.evaluate(() => {
            const modal = document.querySelector('mat-dialog-container') || document.querySelector('div.mat-dialog-container');
            if (modal) {
              // Try multiple approaches to find and click Accept button

              // Approach 1: Find by text content 
              const acceptButtons = Array.from(modal.querySelectorAll('button'))
                .filter(btn => btn.textContent && btn.textContent.trim() === 'Accept');
              if (acceptButtons.length > 0) {
                acceptButtons[0].click();
                console.log('Accept button clicked via text content inside modal');
                return true;
              }

              // Approach 2: Find by class and attribute
              const attrButton = modal.querySelector('button[message-key="FLEX_ACCEPT"]');
              if (attrButton) {
                attrButton.click();
                console.log('Accept button clicked via attribute inside modal');
                return true;
              }

              // Approach 3: Find by class
              const matButtons = Array.from(modal.querySelectorAll('button.mat-button'));
              if (matButtons.length > 0) {
                // Click the first one if we can't find specific Accept text
                matButtons[0].click();
                console.log('First mat-button clicked inside modal as fallback');
                return true;
              }

              console.warn('Accept button not found inside modal by any method');
            }
            return false;
          });
          await page.waitForTimeout(1000);

          // Try second Accept click (might be in a different modal or main document)
          await page.evaluate(() => {
            // Try to find modal first
            const modal = document.querySelector('mat-dialog-container') || document.querySelector('div.mat-dialog-container');
            if (modal) {
              const acceptButton = Array.from(modal.querySelectorAll('button'))
                .find(btn => btn.textContent && btn.textContent.trim() === 'Accept');
              if (acceptButton) {
                acceptButton.click();
                console.log('Clicked second Accept button inside modal');
                return;
              }
            }

            // If not found in modal, try in main document
            const acceptButton = Array.from(document.querySelectorAll('button.mat-button'))
              .find(btn => btn.textContent && btn.textContent.trim() === 'Accept');
            if (acceptButton) {
              acceptButton.click();
              console.log('Clicked Accept button in main document');
            } else {
              console.warn('Second Accept button not found');
            }
          });
        } else {
          // Try to click Accept button in main document using direct DOM logic
          await page.evaluate(() => {
            const acceptButton = Array.from(document.querySelectorAll('button.mat-button'))
              .find(btn => btn.textContent && btn.textContent.trim() === 'Accept');
            if (acceptButton) {
              acceptButton.click();
              console.log('Clicked Accept button');
            } else {
              console.warn('Accept button not found');
            }
          });
        }

        // Also keep the existing locator-based Accept click for robustness
        await page.locator('button[message-key="FLEX_ACCEPT"]').click().catch(() => { });
        await page.waitForTimeout(1000);
      }
    }

    console.log('[k6] Completed password reset flow');

    // Click Accept button twice after password reset flow
    await page.locator('button[message-key="FLEX_ACCEPT"]').click().catch(() => { });
    await page.waitForTimeout(1000);
    await page.locator('button[message-key="FLEX_ACCEPT"]').click().catch(() => { });
    await page.waitForTimeout(1000);

    // Handle potential modal or overlay that might appear after password reset
    try {
      await page.waitForSelector('div.mat-dialog-container', { state: 'visible', timeout: 5000 });
      console.log('[k6] Detected modal or overlay after password reset');

      // Close the modal or overlay if it's a simple close button
      try {
        await page.click('button.mat-dialog-close');
        console.log('[k6] Closed modal or overlay');
      } catch (closeError) {
        console.log('[k6] Close button not found in modal or overlay:', closeError && closeError.message ? closeError.message : closeError);
      }

      // Wait for the modal or overlay to disappear
      await page.waitForSelector('div.mat-dialog-container', { state: 'hidden', timeout: 5000 });
      console.log('[k6] Modal or overlay closed');
    } catch (modalError) {
      console.log('[k6] No modal or overlay detected after password reset:', modalError && modalError.message ? modalError.message : modalError);
    }
  } else {
    console.log('[k6] No password reset field detected - continuing with normal flow');
  }

  await page.waitForTimeout(10000);

  try {
    await page.waitForSelector('div.menu-item[aria-haspopup="true"]', { state: 'visible', timeout: 15000 });
    await page.click('div.menu-item[aria-haspopup="true"]');
    await page.waitForTimeout(3000);
  } catch (error) {
    console.log('Error clicking Accounts menu item:', error && error.message ? error.message : error);
  }

  try {
    await page.waitForSelector('span[aria-live="assertive"]', { state: 'visible', timeout: 10000 });
    const detailButtons = await page.$$('span[aria-live="assertive"]');
    for (const btn of detailButtons) {
      const text = await btn.textContent();
      if (text && text.includes('Detail')) {
        await btn.click();
        break;
      }
    }
    await page.waitForTimeout(5000);
  } catch (error) {
    console.log('Error clicking Detail button:', error && error.message ? error.message : error);
  }
  await page.waitForTimeout(5000);
  // After clicking Detail, conditionally click Accept if visible
  try {
    const acceptButtonSelector = 'button[message-key="FLEX_ACCEPT"]';
    const isAcceptVisible = await page.isVisible(acceptButtonSelector).catch(() => false);
    if (isAcceptVisible) {
      await page.click(acceptButtonSelector);
      console.log('[k6] Clicked Accept button after Detail.');
      await page.waitForTimeout(2000);
    }
  } catch (error) {
    console.log('Error clicking Accept button:', error && error.message ? error.message : error);
  }
  // Perform Move Money transfer operation 1 time (defualt) if TRANSFER_ITERATIONS is not set
  try {
    // Number of transfer iterations to perform
    const transferIterations = parseInt(__ENV.TRANSFER_ITERATIONS || '1', 10);
    console.log(`[k6] Starting ${transferIterations} transfer iterations`);

    for (let iteration = 1; iteration <= transferIterations; iteration++) {
      console.log(`[k6] Starting transfer iteration ${iteration}/${transferIterations}`);

      // Find all elements with the class 'menu-item'
      const menuItems = await page.locator('div.menu-item');
      let moveMoneyItem = null;
      for (const el of menuItems) {
        const text = await el.textContent();
        if (text && text.trim() === 'Move Money') {
          moveMoneyItem = el;
          break;
        }
      }

      if (moveMoneyItem) {
        await moveMoneyItem.click();
        console.log(`[k6] Iteration ${iteration}: Clicked Move Money menu item`);
        await page.waitForTimeout(2000);
        // After Move Money, select Transfer menu item by its text content
        try {
          const transferButton = await (async () => {
            const buttons = await page.$$('button.mat-menu-item');
            for (const btn of buttons) {
              const text = await btn.textContent();
              if (text && text.trim() === 'Transfer') {
                return btn;
              }
            }
            return null;
          })();

          if (transferButton) {
            await transferButton.click();
            console.log(`[k6] Iteration ${iteration}: Clicked Transfer menu item after Move Money`);
            await page.waitForTimeout(2000);
            // After Transfer, use browser console DOM logic to find and click Transfer From dropdown
            try {
              // Use page.evaluate to run the exact DOM logic from the browser console
              const transferFromClicked = await page.evaluate(() => {
                // Find the span with the text 'Transfer From'
                const transferFromSpan = Array.from(document.querySelectorAll('span.mat-select-placeholder'))
                  .find(span => span.textContent.trim() === 'Transfer From');

                // Click the closest mat-select trigger
                if (transferFromSpan) {
                  const trigger = transferFromSpan.closest('.mat-select-trigger');
                  if (trigger) {
                    trigger.click();
                    return true;
                  } else {
                    console.warn('Trigger not found for Transfer From');
                    return false;
                  }
                } else {
                  console.warn('Transfer From span not found');
                  return false;
                }
              });

              if (transferFromClicked) {
                console.log(`[k6] Iteration ${iteration}: Clicked Transfer From dropdown using span + closest trigger approach`);
                // Wait for dropdown options to appear and select the first one
                const optionSelector = 'mat-option';
                await page.waitForSelector(optionSelector, { state: 'visible', timeout: 5000 });
                const options = await page.$$(optionSelector);
                if (options && options.length > 0) {
                  await options[0].click();
                  console.log(`[k6] Iteration ${iteration}: Selected first available item in Transfer From dropdown`);
                  await page.waitForTimeout(1000);
                } else {
                  console.warn(`[k6] Iteration ${iteration}: No options found in Transfer From dropdown`);
                }
              } else {
                console.warn(`[k6] Iteration ${iteration}: Failed to click Transfer From dropdown`);
              }
            } catch (error) {
              console.log(`[k6] Iteration ${iteration}: Error selecting Transfer From dropdown:`, error && error.message ? error.message : error);
            }

            // Now let's handle the Transfer To dropdown
            try {
              // Wait for the Transfer To field to be visible after selecting Transfer From
              await page.waitForTimeout(1000);

              // Use the same approach for Transfer To dropdown
              const transferToClicked = await page.evaluate(() => {
                const transferToSpan = Array.from(document.querySelectorAll('span.mat-select-placeholder'))
                  .find(span => span.textContent.trim() === 'Transfer To');

                if (transferToSpan) {
                  const trigger = transferToSpan.closest('.mat-select-trigger');
                  if (trigger) {
                    trigger.click();
                    return true;
                  } else {
                    console.warn('Trigger not found for Transfer To');
                    return false;
                  }
                } else {
                  console.warn('Transfer To span not found');
                  return false;
                }
              });

              if (transferToClicked) {
                console.log(`[k6] Iteration ${iteration}: Clicked Transfer To dropdown`);
                // Wait for dropdown options to appear and select the first one
                const optionSelector = 'mat-option';
                await page.waitForSelector(optionSelector, { state: 'visible', timeout: 5000 });
                const options = await page.$$(optionSelector);
                if (options && options.length > 0) {
                  await options[0].click();
                  console.log(`[k6] Iteration ${iteration}: Selected first available item in Transfer To dropdown`);
                  await page.waitForTimeout(1000);
                } else {
                  console.warn(`[k6] Iteration ${iteration}: No options found in Transfer To dropdown`);
                }
              } else {
                console.warn(`[k6] Iteration ${iteration}: Failed to click Transfer To dropdown`);
              }
            } catch (error) {
              console.log(`[k6] Iteration ${iteration}: Error selecting Transfer To dropdown:`, error && error.message ? error.message : error);
            }

            // Enter the amount in the input field
            try {
              // Find the amount input field
              const amountInput = await page.$('input[formcontrolname="amount"]');
              if (amountInput) {
                // Always use 0.10 as the transfer amount
                await amountInput.type('0.10');
                console.log(`[k6] Iteration ${iteration}: Entered amount: 0.10`);
              } else {
                console.warn(`[k6] Iteration ${iteration}: Amount input field not found`);
              }
            } catch (error) {
              console.log(`[k6] Iteration ${iteration}: Error entering amount:`, error && error.message ? error.message : error);
            }

            // Click Continue button
            try {
              const continueButtons = await page.$$('button');
              let continueButton = null;
              for (const btn of continueButtons) {
                const text = await btn.textContent();
                if (text && text.includes('Continue')) {
                  continueButton = btn;
                  break;
                }
              }
              if (continueButton) {
                await continueButton.click();
                console.log(`[k6] Iteration ${iteration}: Clicked Continue button`);
                await page.waitForTimeout(2000);
              } else {
                console.warn(`[k6] Iteration ${iteration}: Continue button not found`);
              }
            } catch (error) {
              console.log(`[k6] Iteration ${iteration}: Error clicking Continue button:`, error && error.message ? error.message : error);
            }

            // Click Submit Transfer button
            try {
              const submitButtons = await page.$$('button');
              let submitButton = null;
              for (const btn of submitButtons) {
                const text = await btn.textContent();
                if (text && text.includes('Submit Transfer')) {
                  submitButton = btn;
                  break;
                }
              }
              if (submitButton) {
                await submitButton.click();
                console.log(`[k6] Iteration ${iteration}: Clicked Submit Transfer button`);
                await page.waitForTimeout(2000);
              } else {
                console.warn(`[k6] Iteration ${iteration}: Submit Transfer button not found`);
              }
            } catch (error) {
              console.log(`[k6] Iteration ${iteration}: Error clicking Submit Transfer button:`, error && error.message ? error.message : error);
            }
          } else {
            console.warn(`[k6] Iteration ${iteration}: Transfer menu item not found after Move Money`);
          }
        } catch (error) {
          console.log(`[k6] Iteration ${iteration}: Error clicking Transfer menu item:`, error && error.message ? error.message : error);
        }

        if (iteration < transferIterations) {
          console.log(`[k6] Completed transfer iteration ${iteration}/${transferIterations}. Waiting before next iteration...`);
          await page.waitForTimeout(3000); // Wait before starting the next iteration
        }
      } else {
        // Move Money menu item not found
        console.warn(`[k6] Iteration ${iteration}: Move Money item not found`);
        break; // Exit the loop if we can't find the Move Money item
      }
    } // End of for loop

    console.log(`[k6] Completed all ${transferIterations} transfer iterations`);
  } catch (error) {
    console.log('Error in transfer loop:', error && error.message ? error.message : error);
  }
  await page.waitForTimeout(5000);
  await page.close();
  await context.close();

  // Print the CSV row as plain text for easy copy-paste if accountId and customerId are present
  if (accountId && customerId) {
    const row = [fiIdentifier, account.username, account.password, accountId, customerId].join(',');
    csvRows.push(row);
    console.log(`${row}`);
  } else {
    console.log(`[k6] Skipping CSV row for user ${account.username}: missing accountId or customerId (accountId='${accountId}', customerId='${customerId}')`);
  }
}

// Custom handleSummary function to write CSV at end of test
export function handleSummary(data) {
  // Only return summary.html for reporting
  return {
    'summary.html': htmlReport(data)
  };
}
