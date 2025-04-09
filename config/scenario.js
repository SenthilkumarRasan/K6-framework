const buildCustomScenario = (type, rampingStages) => {
  const stages = rampingStages.split(',').map(stage => {
    const [duration, target] = stage.split(':');
    return { duration, target: parseInt(target, 10) };
  });

  if (type === 'custom-tps') {
    return {
      executor: 'ramping-arrival-rate',
      stages: stages,
      preAllocatedVUs: 1,
      maxVUs: 100,
    };
  } else if (type === 'custom-vus') {
    return {
      executor: 'ramping-vus',
      stages: stages,
    };
  }
  return null;
};

const scenarios = {
  API: {
    smoke: {
      executor: "ramping-arrival-rate",
      stages: [
        { duration: "1m", target: 1 },
        { duration: "1m", target: 1 }, // Adjust duration as needed
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
      preAllocatedVUs: 1,
      maxVUs: 1000
    },
    loadtest: {
      executor: "ramping-arrival-rate",
      stages: [
        { duration: "1m", target: 5 },
        { duration: "5m", target: 5 },
        { duration: "30s", target: 0 }
      ],
      preAllocatedVUs: 1,
      maxVUs: 100
    },
    stresstest: {
      executor: "ramping-arrival-rate",
      stages: [
        { duration: "2m", target: 2 },
        { duration: "2m", target: 2 },
        { duration: "2m", target: 2 },
        { duration: "2m", target: 2 },
        { duration: "2m", target: 2 },
        { duration: "2m", target: 2 },
        { duration: "2m", target: 2 },
        { duration: "2m", target: 2 },
        { duration: "2m", target: 2 },
        { duration: "2m", target: 2 }
      ],
      preAllocatedVUs: 1,
      maxVUs: 100
    },
    endurancetest: {
      executor: "ramping-arrival-rate",
      stages: [
        { duration: "1m", target: 2 },
        { duration: "1h", target: 2 },
        { duration: "30s", target: 0 }
      ],
      preAllocatedVUs: 1,
      maxVUs: 100
    }
  },
  BROWSER: {
    smoke: {
      executor: 'constant-vus',
      vus: 1,
      duration: '1m',
      options: {
        browser: {
          type: 'chromium',
        },
      },
    },
    loadtest: {
      executor: 'constant-vus',
      vus: 5,
      duration: '2m',
      options: {
        browser: {
          type: 'chromium',
        },
      },
    }
  }
};

const thresholds = {
  API: {
    checks: ['rate == 1.00'],
    http_req_failed: [{ threshold: 'rate <= 0.02', abortOnFail: false }],
    http_req_duration: [
      { threshold: 'p(95) < 1000', abortOnFail: false }, // 95th percentile response time < 1000ms
      { threshold: 'p(90) < 500', abortOnFail: false } // 90th percentile response time < 500ms
    ]
  },
  BROWSER: {
    checks: ['rate == 1.00'],
    http_req_failed: [{ threshold: 'rate <= 0.02', abortOnFail: false }],
    http_req_duration: [
      { threshold: 'p(95) < 2000', abortOnFail: false }, // 95th percentile response time < 2000ms
      { threshold: 'p(90) < 1000', abortOnFail: false } // 90th percentile response time < 1000ms
    ]
  }
};

module.exports = { scenarios, thresholds, buildCustomScenario };
