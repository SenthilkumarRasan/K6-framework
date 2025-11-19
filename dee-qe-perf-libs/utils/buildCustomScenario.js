// Helper function to build custom scenario
// Suppress duplicate info-lines by remembering which messages were already printed
const __loggedMessages = new Set();
function logOnce(msg) {
  try {
    if (!msg || __loggedMessages.has(msg)) return;
    console.log(msg);
    __loggedMessages.add(msg);
  } catch { /* noop */ }
}

const DEBUG_ENABLED = String(__ENV.DEBUG).toLowerCase() === 'true';

export const buildCustomScenario = (type, rampingStages) => {
  // Get the time unit from environment variable or default to 'm' (minutes)
  const envTimeUnit = __ENV.TIME_UNIT || 'm';
    
  // Map our time unit to k6 timeUnit (k6 expects 's', '1s', etc.)
  // k6 supports s, ms, us, ns, m, h
  // Accept both 's' or '1s', 'm' or '1m', 'h' or '1h' for convenience
  let timeUnit = '1m';
  try {
    const norm = String(envTimeUnit).toLowerCase();
    if (norm.includes('s') && !norm.includes('m') && !norm.includes('h')) timeUnit = '1s';
    else if (norm.includes('m')) timeUnit = '1m';
    else if (norm.includes('h')) timeUnit = '1h';
    else timeUnit = '1m';
  } catch {
    timeUnit = '1m';
  }
    
  // Helper function to normalize target rates based on time unit
  // This function is never used in the current code, but it's here for reference
  // This ensures consistent behavior across different timeUnit settings
  const _normalizeRateForTimeUnit = (rate, unit) => {
    // Always normalize to per-second rate for internal calculations
    switch(unit) {
    case 's': return rate; // Already per-second
    case 'm': return rate / 60; // Convert per-minute to per-second
    case 'h': return rate / 3600; // Convert per-hour to per-second
    default: return rate;
    }
  };
    
  // // This old normalization is no longer needed - we'll use the more accurate function above
  // // Keeping this function for backward compatibility but will delegate to the new function
  // const normalizeTargetRate = (rate) => {
  //   return rate; // We'll apply the normalization in the scenario configuration
  // };
    
  const stages = rampingStages.split(',').map(stage => {
    const [duration, target] = stage.split(':');
    return { duration, target: parseInt(target, 10) };
  });
  
  // Allow configuring preAllocatedVUs and maxVUs via environment variables
  const envPreAllocated = parseInt(__ENV.PREALLOCATED_VUS || __ENV.PREALLOCATEDVUS || '10', 10);
  const envMaxVUs = parseInt(__ENV.MAX_VUS || __ENV.MAXVUS || '100', 10);
  
  if (type === 'custom-tps') {
    if (DEBUG_ENABLED) logOnce(`Building custom TPS scenario with ${stages.length} stages, timeUnit: ${envTimeUnit}`);
      
    if (stages.length === 1) {
      // Single stage - Create a simple constant-arrival-rate scenario
      const targetRate = parseInt(stages[0].target, 10);
        
      if (DEBUG_ENABLED) logOnce(`Using constant-arrival-rate with ${targetRate} iterations per ${envTimeUnit} (preAllocatedVUs=${envPreAllocated}, maxVUs=${envMaxVUs})`);
        
      return {
        executor: 'constant-arrival-rate',
        rate: targetRate,
        duration: stages[0].duration,
        preAllocatedVUs: envPreAllocated,
        maxVUs: envMaxVUs,
        timeUnit: timeUnit,
        gracefulStop: '0s'
      };
    } else if (stages.length >= 2) {
      // Multiple stages - Use ramping-arrival-rate for varying the rate over time
      const k6Stages = stages.map(stage => ({
        duration: stage.duration,
        target: parseInt(stage.target, 10)
      }));
        
      // Log each stage for visibility (print each unique stage line only once)
      k6Stages.forEach((stage, index) => {
        if (DEBUG_ENABLED) logOnce(`  Stage ${index + 1}: ${stage.target} iterations per ${envTimeUnit} for ${stage.duration}`);
      });
        
      // Create a ramping-arrival-rate scenario with multiple stages
      return {
        executor: 'ramping-arrival-rate',
        startRate: 0, // Start at 0 and ramp up to the first target
        stages: k6Stages,
        timeUnit: timeUnit,
        preAllocatedVUs: envPreAllocated,
        maxVUs: envMaxVUs,
        gracefulStop: '0s'
      };
    }
  } else if (type === 'custom-vus') {
    if (stages.length === 1) {
      // Single stage - Create a constant-vus scenario
      const targetVUs = stages[0].target;
        
      if (DEBUG_ENABLED) logOnce(`Using constant-vus with ${targetVUs} VUs for ${stages[0].duration}`);
        
      return {
        executor: 'constant-vus',
        vus: targetVUs,
        duration: stages[0].duration,
        gracefulStop: '0s'
      };
    } else if (stages.length >= 2) {
      // Multiple stages - Use a single ramping-vus scenario
      // For VUs, k6 has a 'ramping-vus' executor that's perfect for this
        
      // For our stages array, we need to transform our input format to k6's format
      // k6 expects: { duration: 'XXs', target: YY } where target is the number of VUs
      const k6Stages = stages.map(stage => ({
        duration: stage.duration,
        target: parseInt(stage.target, 10)
      }));
        
      // Log each stage for visibility (print each unique stage line only once)
      k6Stages.forEach((stage, index) => {
        if (DEBUG_ENABLED) logOnce(`  Stage ${index + 1}: ${stage.target} VUs for ${stage.duration}`);
      });
        
      // Create a single scenario with varying VUs using 'stages'
      return {
        executor: 'ramping-vus',
        startVUs: k6Stages[0].target,
        stages: k6Stages,
        gracefulStop: '0s'
      };
    }
  }
  
  // Default return
  throw new Error(`Unsupported scenario type: ${type} or invalid stages configuration`);
};