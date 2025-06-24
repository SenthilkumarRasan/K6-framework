/**
 * Protocol testing utilities for K6 tests
 * Contains reusable protocol test functions to simplify test scripts
 */
import { get } from './httpClient.js';
import { loadNonHtmlResources } from './nonHtmlResourceLoader.js';

/**
 * Creates tags for HTML and non-HTML resources
 * @param {string} transactionName - The transaction name
 * @param {string} environment - The environment name
 * @param {string} aut - The application under test
 * @returns {Object} - Object containing htmlTags and nonHtmlTags
 */
export function createResourceTags(transactionName, environment, aut) {
  // Tags for the main HTML request
  const htmlTags = {
    transaction: transactionName,
    environment: environment,
    aut: aut
  };

  // Tags for non-HTML resources (include transaction_nonhtml for clarity)
  const nonHtmlTags = {
    ...htmlTags,
    transaction: transactionName + '_nonhtml'
  };

  return { htmlTags, nonHtmlTags };
}

/**
 * Creates HTTP request parameters with appropriate headers and tags
 * @param {Object} tags - Tags to apply to the request
 * @param {number} maxRedirects - Maximum number of redirects to follow
 * @returns {Object} - Request parameters object
 */
export function createRequestParams(tags, maxRedirects = 5) {
  return {
    headers: {
      'accept': 'text/html,application/xhtml+xml',
      'accept-encoding': 'gzip, deflate',
    },
    tags: tags,
    redirects: maxRedirects
  };
}

/**
 * Fetches a URL and loads all non-HTML resources referenced by the page
 * @param {string} url - The URL to fetch
 * @param {Object} requestParams - Request parameters
 * @param {Object} htmlTags - Tags for the HTML request
 * @param {Object} nonHtmlTags - Tags for non-HTML resources
 * @param {string} baseUrl - Base URL for resolving relative paths
 * @param {Object} options - Additional options
 * @returns {Object} - Response object and success status
 */
export function fetchPageAndResources(url, requestParams, htmlTags, nonHtmlTags, baseUrl, options = {}) {
  const { name = `GET ${htmlTags.transaction}`, logErrors = true } = options;
  
  try {
    // Fetch the main HTML page
    let response = get(
      url,
      requestParams,
      {
        name: name,
        tags: htmlTags
      }
    );
    
    // Handle redirects manually if needed
    if (response.status >= 300 && response.status < 400 && response.headers && response.headers.Location) {
      const redirectUrl = response.headers.Location.startsWith('http') 
        ? response.headers.Location 
        : baseUrl + response.headers.Location;
        
      if (logErrors) {
        console.log(`Following redirect to: ${redirectUrl}`);
      }
      
      response = get(
        redirectUrl, 
        requestParams, 
        { 
          name: `${name} (redirected)`, 
          tags: htmlTags 
        }
      );
    }

    // Process the response
    if (response && response.status === 200) {
      try {
        // Load all referenced non-HTML resources
        loadNonHtmlResources(response.body, baseUrl, nonHtmlTags);
        return { response, success: true };
      } catch (error) {
        if (logErrors) {
          console.error(`Error loading non-HTML resources for ${url}: ${error}`);
        }
        return { response, success: false, error };
      }
    } else {
      if (logErrors && response) {
        console.error(`GET failed with status ${response.status} for ${url}`);
      }
      return { response, success: false };
    }
  } catch (error) {
    if (logErrors) {
      console.error(`Error during GET request for ${url}: ${error}`);
    }
    return { response: null, success: false, error };
  }
}

// processUrlData function removed as it's application-specific
