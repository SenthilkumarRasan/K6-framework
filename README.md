# k6-template

A flexible performance testing framework built on [k6](https://k6.io/).

## What is k6?

k6 is an open-source load testing tool designed for testing the performance and reliability of modern applications and APIs. It is developer-centric, scriptable in JavaScript, and integrates well into CI/CD pipelines.

## What types of tests can k6 run?

- **API Load Testing**: Test REST, GraphQL, and other HTTP APIs for performance, scalability, and correctness.
- **Browser Automation**: Simulate real browsers to test end-to-end user journeys, including desktop and mobile device emulation.
- **Protocol Testing**: Test lower-level protocols or custom endpoints.
- **Desktop & Mobile Simulation**: Simulate different device types and network conditions to measure performance.

k6 supports both headless and full browser modes for backend and frontend performance testing.

## Installation

**macOS**: `brew install k6`

**Windows**: `winget install k6` or download from the [k6 GitHub releases page](https://github.com/grafana/k6/releases).

## Running Tests Directly with k6

You can also run tests directly with the k6 command, bypassing the shell script:

### Examples

**API Test**:
```sh
k6 run -e TEST_TYPE=API -e SCENARIO_TYPE=custom-tps -e RAMPING_STAGES="1m:1,1m:5,1m:0" -e ENVIRONMENT=qa tests/api/api.js --vertical=allrecipes --time-unit=1s
```

**PROTOCOL Test**:
```sh
k6 run -e TEST_TYPE=PROTOCOL -e SCENARIO_TYPE=custom-tps -e RAMPING_STAGES="1m:1,1m:5,1m:0" -e ENVIRONMENT=qa tests/protocol/vertical.js --vertical=allrecipes --time-unit=1s
```

**BROWSER Test**:
```sh
k6 run -e TEST_TYPE=BROWSER -e SCENARIO_TYPE=custom-tps -e RAMPING_STAGES="1m:1,1m:5,1m:0" -e ENVIRONMENT=qa -e HEADLESS_BROWSER=false tests/browser/k6Browsertest.js --vertical=allrecipes --time-unit=1s
```

**MULTI Test**:
```sh
k6 run -e TEST_TYPE=MULTI -e SCENARIO_TYPE=custom-tps -e RAMPING_STAGES="1m:1,1m:5,1m:0" -e ENVIRONMENT=qa tests/multi/browserProtocolcombined.js --vertical=allrecipes --time-unit=1s
```

## Running Tests with the Startup Script

Use the provided `run_k6_tests.sh` script to run different types of tests:

### Examples

**API Test**:
```sh
./run_k6_tests.sh --script=api.js --test-type=API --scenario=custom-tps --environment=qa --headless=true --vertical=allrecipes --time-unit=1s
```

**PROTOCOL Test**:
```sh
./run_k6_tests.sh --script=vertical.js --test-type=PROTOCOL --scenario=custom-tps --environment=qa --headless=true --vertical=allrecipes --time-unit=1s
```

**BROWSER Test**:
```sh
./run_k6_tests.sh --script=k6Browsertest.js --test-type=BROWSER --scenario=custom-tps --environment=qa --headless=false --vertical=allrecipes --time-unit=1s
```

**MULTI Test**:
```sh
./run_k6_tests.sh --script=browserProtocolcombined.js --test-type=MULTI --scenario=custom-tps --environment=qa --headless=true --vertical=allrecipes --time-unit=1s
```

## Running Tests with Docker

You can run tests using the provided Docker container, which packages all dependencies and scripts together:

### Building the Docker Image

```sh
docker build -t k6-template .
```

**API Test**:
```sh
docker run -it --rm k6-template --script=api.js --test-type=API --scenario=custom-tps --ramping-stages="1m:1,1m:5,1m:0" --environment=qa --headless=true --vertical=allrecipes       --time-unit=1s
```

**PROTOCOL Test**:
```sh
docker run -it --rm k6-template --script=vertical.js --test-type=PROTOCOL --scenario=custom-tps --ramping-stages="1m:1,1m:5,1m:0" --environment=qa --headless=true --vertical=allrecipes --time-unit=1s
```

**BROWSER Test**:
```sh
docker run -it --rm k6-template --script=k6Browsertest.js --test-type=BROWSER --scenario=custom-tps --ramping-stages="1m:1,1m:5,1m:0" --environment=qa --headless=false --vertical=allrecipes --time-unit=1s
```

**MULTI Test**:
```sh
docker run -it --rm k6-template --script=browserProtocolcombined.js --test-type=MULTI --scenario=custom-tps --ramping-stages="1m:1,1m:5,1m:0" --environment=qa --headless=true --vertical=allrecipes --time-unit=1s
```

### Saving and Generating Reports

**Run the test and output results to JSON (mount a local results directory):**
```sh
docker run -it --rm -v $(pwd)/results:/app/results k6-template --script=vertical.js --test-type=PROTOCOL --scenario=custom-tps --ramping-stages="1m:1,1m:5,1m:0" --environment=qa --headless=true --out json=results/results.json --vertical=allrecipes --time-unit=1s      
```

**Generate the summary report using the Node.js utility:**
```sh
docker run -it --rm -v $(pwd)/results:/app/results k6-template node utils/process-k6-results.js results/results.json --vertical=allrecipes --time-unit=1s
```

**Parameters**:
- `--script`: Test script file (e.g., `api.js`, `vertical.js`)
- `--test-type`: One of: `API`, `PROTOCOL`, `BROWSER`, or `MULTI`
- `--scenario`: `smoke`, `loadtest`, `spiketest`, etc. (defined in `config/scenario.js`)
- `--environment`: Environment config to use (e.g., `qa`, `dev`)
- `--headless`: Controls browser mode for browser tests

## How to see full debug log

k6 run tests/d1.js -e STACK=qa SCENARIO=smoke --http-debug="full"

## Reporting

### default reporting
k6 print out summary results to stdout

### use --out flag to send out Real-time metrics to database, for example Influxdb
k6 run -e TEST_TYPE=PROTOCOL -e SCENARIO_TYPE=custom-tps -e RAMPING_STAGES="1m:1,1m:5,1m:0" -e ENVIRONMENT=qa --out influxdb=http://localhost:8086/k6 tests/protocol/vertical.js --vertical=allrecipes --time-unit=1s

### use helper function handleSummary() to generate html formatted summary

### How to see dashboard report
Run test with the K6_WEB_DASHBOARD and K6_WEB_DASHBOARD_EXPORT parameters to get overtime performance overview charts
VUs, Transfer rate, HTTP Request Duration, Iteration Duration, TLS handshaking, Request Waiting and many more.

K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT=results/test-report.html \
k6 run -e TEST_TYPE=PROTOCOL -e SCENARIO_TYPE=custom-tps -e RAMPING_STAGES="1m:1,1m:5,1m:0" -e ENVIRONMENT=qa tests/protocol/vertical.js --vertical=allrecipes --time-unit=1s


## Generating Summary Reports by Tag and Group

After running your k6 load test, you can generate detailed performance summaries grouped by **template tag** and **group** using the provided `process-k6-results.js` utility.

### 1. Ensure the `process-k6-results.js` script is present

Verify that the `process-k6-results.js` utility is located in the `utils/` directory of your project.

### 2. Run Your k6 Test

Make sure to output the results in JSON format:
```sh
k6 run -e TEST_TYPE=PROTOCOL -e SCENARIO_TYPE=custom-tps -e RAMPING_STAGES="1m:1,1m:5,1m:0" -e ENVIRONMENT=qa --out json=results/results.json tests/protocol/vertical.js --vertical=allrecipes --time-unit=1s
```

### 3. Generate Summary Report

Run the `process-k6-results.js` script to generate the summary report:
```sh
node utils/process-k6-results.js results/results.json
``` 

### Folder and File Descriptions

- **config/**  
  Contains configuration files for test scenarios and thresholds.
  - `scenario.js`: Defines scenario templates (smoke, load, spike, etc.) and threshold settings for different test types.

- **payloads/**  
  Stores test data in JSON or other formats for use in scripts.
  - `testdata.json`: Example user credentials or other structured data needed for tests.

- **testdata/**  
  Contains CSV or other bulk data files used as input for load tests.
  - `allrecipes.csv`: List of URLs and templates for protocol/API tests.

- **tests/**  
  Main folder for all test scripts, organized by test type.
  - **api/**: API test scripts (e.g., `api.js`).
  - **protocol/**: Protocol-level test scripts (e.g., `vertical.js`).
  - **browser/**: Browser automation tests (e.g., `k6Browsertest.js`).
  - **multi/**: Combined or hybrid test scripts (e.g., `browserProtocolcombined.js`).

- **utils/**  
  Utility scripts and helpers for test execution and reporting.
  - `csvReader.js`: Functions to read and parse CSV input data.
  - `httpClient.js`: Common HTTP client wrapper for requests and checks.
  - `process-k6-results.js`: Post-processing utility to analyze and summarize k6 JSON output.
  - `performance_report.js`: Generates performance reports grouped by tags or templates.

- **run_k6_tests.sh**  
  Shell script to standardize and simplify running k6 tests with various options.

- **Dockerfile**  
  Container definition for running tests in a consistent environment.

- **README.md**  
  Project documentation and usage instructions.