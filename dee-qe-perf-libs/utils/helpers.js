// Helper function to generate random user data
export function generateRandomUser() {
  const randomId = Math.floor(Math.random() * 1000);
  return {
    id: randomId,
    name: `User${randomId}`,
    email: `user${randomId}@example.com`,
    password: 'password123',
  };
}

// Helper function to handle error
export function handleError(response, expectedStatus) {
  if (!response) {
    console.error(`handleError: response is null or undefined. expectedStatus=${expectedStatus}`);
    throw new Error('=========Request failed with status=====> <no response>');
  }

  // Guard against response objects that don't expose .status or .body
  const status = typeof response.status !== 'undefined' ? response.status : '<no status>';
  const body = typeof response.body !== 'undefined' ? response.body : '<no body available>';

  if (status !== expectedStatus) {
    console.error(`Expected status ${expectedStatus} but got ${status}`);
    // Try to safely stringify the body for logging
    try {
      console.error(`Response body: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    } catch (_e) {
      console.error(`Response body: <unserializable body> (${_e.message})`);
    }
    throw new Error(`=========Request failed with status=====> ${status}`);
  }
}

/**
 * Create a transaction distribution manager for dynamically selecting transactions
 * @param {Array} transactions - Array of objects with name and weight properties
 * @param {Object} executors - Object containing execution functions for each transaction
 * @param {String} envDistributionString - Optional environment variable string in format "Group1:30,Group2:20,..."
 * @returns {Object} Methods to select and execute transactions
 */
export class TransactionDistributionManager {
  constructor(transactions, executors, envDistributionString = null) {
    this.transactions = transactions;
    this.executors = executors;
    this.distributionMap = {};
    this.cumulativeDistribution = [];
    
    // If environment variable string is provided, parse it and update weights
    if (envDistributionString) {
      this._parseDistributionString(envDistributionString);
    }
    
    // Validate transactions have proper structure
    this._validateTransactions();
    
    // Validate executors contain all required functions
    this._validateExecutors();
    
    // Build distribution map and cumulative distribution
    this._buildDistribution();
  }
  
  /**
   * Parse distribution string from environment variable 
   * @param {String} distributionString - Format: "Group1:30,Group2:20,..."
   * @private
   */
  _parseDistributionString(distributionString) {
    try {
      const result = {};
      let total = 0;
      
      // Parse the string format "Group1:30,Group2:20,..."
      const pairs = distributionString.split(',');
      for (const pair of pairs) {
        const [name, valueStr] = pair.trim().split(':');
        const value = parseInt(valueStr, 10);
        
        if (isNaN(value) || value <= 0) {
          console.warn(`Invalid percentage '${valueStr}' for '${name}', ignoring custom distribution`);
          return;
        }
        
        // Verify the group exists in our transactions
        if (!this.transactions.some(t => t.name === name)) {
          console.warn(`Transaction group '${name}' in distribution string does not exist in defined transactions, ignoring custom distribution`);
          return;
        }
        
        result[name] = value;
        total += value;
      }
      
      // Validate total equals 100
      if (total !== 100) {
        console.warn(`Transaction distribution percentages must sum to 100, got ${total}. Using default distribution`);
        return;
      }
      
      // Update transaction weights from the parsed distribution
      this.transactions.forEach(transaction => {
        if (result[transaction.name] !== undefined) {
          transaction.weight = result[transaction.name];
        } else {
          console.warn(`Transaction '${transaction.name}' not found in distribution string, setting weight to 0`);
          transaction.weight = 0;
        }
      });
      
      console.log(`Using custom transaction distribution: ${JSON.stringify(result)}`);
    } catch (error) {
      console.warn(`Error parsing transaction distribution: ${error}. Using default distribution`);
    }
  }
  
  _validateTransactions() {
    if (!Array.isArray(this.transactions) || this.transactions.length === 0) {
      throw new Error('Transactions must be a non-empty array');
    }
    
    let totalWeight = 0;
    this.transactions.forEach(transaction => {
      if (!transaction.name || typeof transaction.weight !== 'number' || transaction.weight < 0) {
        throw new Error(`Transaction ${JSON.stringify(transaction)} must have a name and non-negative weight`);
      }
      totalWeight += transaction.weight;
    });
    
    // Normalize weights if they don't sum to 100
    if (totalWeight !== 100) {
      console.warn(`Transaction weights sum to ${totalWeight}, normalizing to 100%`);
      const normalizationFactor = 100 / totalWeight;
      this.transactions.forEach(transaction => {
        transaction.weight = Math.round(transaction.weight * normalizationFactor);
      });
      
      // Handle rounding errors
      const roundedTotal = this.transactions.reduce((sum, t) => sum + t.weight, 0);
      if (roundedTotal !== 100) {
        const diff = 100 - roundedTotal;
        // Find the transaction with the highest weight to adjust
        const highestWeightTransaction = [...this.transactions].sort((a, b) => b.weight - a.weight)[0];
        highestWeightTransaction.weight += diff;
      }
    }
  }
  
  _validateExecutors() {
    this.transactions.forEach(transaction => {
      const executorName = transaction.name;
      if (!this.executors[executorName] || typeof this.executors[executorName] !== 'function') {
        throw new Error(`Executor function for transaction "${executorName}" is missing or not a function`);
      }
    });
  }
  
  _buildDistribution() {
    // Build distribution map
    this.distributionMap = this.transactions.reduce((map, transaction) => {
      map[transaction.name] = transaction.weight;
      return map;
    }, {});
    
    // Build cumulative distribution for selection
    let cumulativePercentage = 0;
    this.cumulativeDistribution = this.transactions.map(transaction => {
      cumulativePercentage += transaction.weight;
      return {
        name: transaction.name,
        threshold: cumulativePercentage
      };
    });
  }
  
  /**
   * Select a transaction based on the distribution
   * @returns {string} Name of the selected transaction
   */
  selectTransaction() {
    // Generate random number between 1-100
    const randomValue = Math.floor(Math.random() * 100) + 1;
    
    // Find the transaction based on the random value
    for (const item of this.cumulativeDistribution) {
      if (randomValue <= item.threshold) {
        return item.name;
      }
    }
    
    // Fallback (should never reach here if distribution sums to 100)
    return this.cumulativeDistribution[this.cumulativeDistribution.length - 1].name;
  }
  
  /**
   * Execute the selected transaction
   * @param {string} transactionName - Name of the transaction to execute
   * @param {Object} context - Context to pass to the executor function
   */
  executeTransaction(transactionName, context) {
    if (!this.executors[transactionName]) {
      throw new Error(`Executor for transaction "${transactionName}" not found`);
    }
    
    return this.executors[transactionName](context);
  }
  
  /**
   * Get the distribution map
   * @returns {Object} Distribution map
   */
  getDistributionMap() {
    return { ...this.distributionMap };
  }
  
  /**
   * Selects and executes a random transaction based on the distribution
   * @param {Object} context - Context to pass to the executor function
   * @returns {*} Result of the executor function
   */
  selectAndExecuteTransaction(context) {
    const selectedTransaction = this.selectTransaction();
    if (String(__ENV.DEBUG).toLowerCase() === 'true') {
      console.log(`Selected transaction: ${selectedTransaction}`);
    }
    return this.executeTransaction(selectedTransaction, context);
  }
}

/**
 * Build Dynatrace header for k6 requests
 * @param {string} groupName - Group name for TSN
 * @param {string} scriptName - Script name for LSN
 * @param {string} scenarioType - Scenario type for LTN
 * @returns {Object} Header object to merge into request headers
 */
export function buildDynatraceHeader(groupName, scriptName, scenarioType) {
  // Get VU ID
  let vuId = 1;
  try {
    vuId = __VU || 1;
  } catch {
    // Fallback if __VU not available
  }
  
  // Compose the Dynatrace header value
  const headerValue = `TSN=${groupName};LSN=${scriptName};LTN=${scenarioType};VU=${vuId};PC=k6-request;SI=K6`;
  
  return {
    'x-dynatrace-test': headerValue
  };
}