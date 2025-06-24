// utils/browserPageUtils.js
// Common browser page utility functions for k6/browser scripts

/**
 * Scrolls the page to the middle (vertically).
 * @param {import('k6/browser').Page} page - The k6 browser page object.
 * @returns {Promise<boolean>} true if success, false if error
 */
export async function scrollPageToMiddle(page) {
  try {
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight / 2);
    });
    return true;
  } catch (e)  {
    console.error(`[K6 BROWSER Error scrolling page: ${e.message}`);
    return false;
  }
}
