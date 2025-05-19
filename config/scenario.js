// Utility to build custom scenario configs for custom-tps and custom-vus
const buildCustomScenario = (type, rampingStages, timeUnit = '1s') => {
  const stages = rampingStages.split(',').map(stage => {
    const [duration, target] = stage.split(':');
    return { duration, target: parseInt(target, 10) };
  });

  if (type === 'custom-tps') {
    return {
      executor: 'ramping-arrival-rate',
      stages: stages,
      timeUnit: timeUnit, // Can be '1s', '1m', '1h' for per second, minute, or hour
      preAllocatedVUs: 1,
      maxVUs: 500,
    };
  } else if (type === 'custom-vus') {
    return {
      executor: 'ramping-vus',
      stages: stages,
    };
  }
  return null;
};

// Common scenarios for API and PROTOCOL
const apiProtocolScenarios = {
  smoke: {
    executor: "ramping-arrival-rate",
    stages: [
      { duration: "1m", target: 1 },
      { duration: "1m", target: 1 },
      { duration: "30s", target: 0 }
    ],
    preAllocatedVUs: 1,
    maxVUs: 10
  },
  spiketest: {
    executor: "ramping-arrival-rate",
    stages: [
      { duration: "1m", target: 10 },
      { duration: "30s", target: 100 },
      { duration: "2m", target: 100 },
      { duration: "30s", target: 0 }
    ],
    preAllocatedVUs: 10,
    maxVUs: 100
  },
  loadtest: {
    executor: "ramping-arrival-rate",
    stages: [
      { duration: "2m", target: 10 },
      { duration: "5m", target: 50 },
      { duration: "2m", target: 0 }
    ],
    preAllocatedVUs: 10,
    maxVUs: 100
  }
  // Add more scenarios as needed
};

// Scenarios for BROWSER
const browserScenarios = {
  smoke: {
    executor: "per-vu-iterations",
    vus: 1,
    iterations: 1
  },
  loadtest: {
    executor: "ramping-vus",
    stages: [
      { duration: "1m", target: 2 },
      { duration: "2m", target: 5 },
      { duration: "1m", target: 0 }
    ]
  }
  // Add more browser-specific scenarios as needed
};

// Exported scenarios object for all test types
const scenarios = {
  API: apiProtocolScenarios,
  PROTOCOL: apiProtocolScenarios,
  BROWSER: browserScenarios
};

const thresholds = {
  API: {
    checks: ['rate == 1.00'],
    http_req_failed: [{ threshold: 'rate <= 0.02', abortOnFail: false }],
    http_req_duration: [
      { threshold: 'p(95) < 1000', abortOnFail: false },
      { threshold: 'p(90) < 500', abortOnFail: false }
    ]
  },
  PROTOCOL: {
    checks: ['rate == 1.00'],
    http_req_failed: [{ threshold: 'rate <= 0.02', abortOnFail: false }],
    http_req_duration: [
      { threshold: 'p(95) < 1000', abortOnFail: false },
      { threshold: 'p(90) < 500', abortOnFail: false }
    ]
  },
  BROWSER: {
    checks: ['rate == 1.00'],
    http_req_failed: [{ threshold: 'rate <= 0.02', abortOnFail: false }],
    http_req_duration: [
      { threshold: 'p(95) < 2000', abortOnFail: false },
      { threshold: 'p(90) < 1000', abortOnFail: false }
    ]
  }
};

export { buildCustomScenario, scenarios, thresholds };
