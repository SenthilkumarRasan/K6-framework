export const workloadConfig = {
  smoke: [
    { duration: '5s', target: 1 }, // Quick test with minimal load
  ],
  averageLow: [
    { duration: '10m', target: 20 },
    { duration: '20m', target: 20 },
    { duration: '10m', target: 0 },
  ],
  averageMed: [
    { duration: '10m', target: 100 },
    { duration: '20m', target: 100 },
    { duration: '10m', target: 0 },
  ],
  spike: [
    { duration: '1m', target: 10 },  // Ramp-up to 10 users over 1 minute
    { duration: '30s', target: 200 }, // Sudden spike to 200 users
    { duration: '1m', target: 150 },  // Maintain 150 users for 1 minute
    { duration: '30s', target: 10 },  // Ramp-down to 10 users
    { duration: '1m', target: 0 },    // Ramp-down to 0 users
  ],
  stress: [
    { duration: '5m', target: 100 },
    { duration: '5m', target: 200 },
    { duration: '5m', target: 400 },
    { duration: '10m', target: 400 },
    { duration: '5m', target: 0 },
  ],
  peak: [
    { duration: '5m', target: 500 },
    { duration: '10m', target: 500 },
    { duration: '5m', target: 0 },
  ],
  soak: [
    { duration: '1h', target: 100 },
    { duration: '10h', target: 100 },
    { duration: '15m', target: 0 },
  ],
};
