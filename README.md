# k6 Performance Testing Framework

A comprehensive performance testing framework built on [k6](https://k6.io/) with enhanced reporting capabilities for API, Browser, and Protocol testing.

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Test Types](#test-types)
  - [API Tests](#api-tests)
  - [Browser Tests](#browser-tests)
  - [Protocol Tests](#protocol-tests)
- [Running Tests](#running-tests)
  - [Using k6 Directly](#using-k6-directly)
  - [Using the run_k6_tests.sh Script](#using-the-run_k6_testssh-script)
  - [Using Docker](#using-docker)
- [Custom HTML Reports](#custom-html-reports)
- [Configuration Options](#configuration-options)

## Project Structure & Key Files

- `run_k6_tests.sh`: Main wrapper script to run API, Browser, or Protocol tests with all configuration options and reporting.
- `utils/coreVitals.js`: Collects Core Web Vitals and resource timing metrics for browser tests.
- `utils/process-k6-results.js`: Generates enhanced HTML reports from k6 JSON output.
- `utils/browserMetrics.js`: Utility functions for browser-side metrics collection.
- `tests/browser/verticalBrowser.js`: Main browser test script. Parameterized for template, base URL, scenario, etc.
- `tests/api/apiTest.js`: Example API test script.
- `tests/protocol/websocketTest.js`: Example protocol (WebSocket) test script.
- `results/`: Output directory for HTML and JSON reports (ignored by git).
- `screenshots/`: Stores screenshots from browser tests (ignored by git).
- `.gitignore`: Ensures results and screenshots are not tracked by git.

## Overview

This framework extends k6's capabilities with:

- Unified test execution across API, Browser, and Protocol tests
- Enhanced HTML reporting with detailed metrics visualization
- Template-based organization for better test management
- Docker support for consistent execution environments
- Configurable test scenarios for different performance testing needs

## Installation

### Prerequisites

- Node.js (v14 or higher)
- k6 (latest version)

### Setup

```bash
# Install k6
# macOS
brew install k6

# Ubuntu/Debian
sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6

# Windows
winget install k6 or download from the k6 GitHub releases page

# Install Node.js dependencies
npm install
```

## Test Types

### API Tests

API tests focus on HTTP endpoints performance without browser rendering overhead. These tests are ideal for measuring backend performance, API scalability, and service reliability.

#### Example API Test Structure (with parameterization)

```javascript
import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'https://api.example.com';
const TEMPLATE = __ENV.TEMPLATE || 'apiTemplate';

export default function() {
  const response = http.get(`${BASE_URL}/endpoint`, { tags: { template: TEMPLATE } });
  check(response, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500
  }, { tags: { template: TEMPLATE } });
}
```

**Run directly:**
```sh
k6 run tests/api/apiTest.js --vus 10 --duration 30s -e BASE_URL=https://api.example.com -e TEMPLATE=apiTemplate
```


### Browser Tests

Browser tests use k6's browser module to simulate real user interactions in a browser environment. These tests measure frontend performance metrics like Core Web Vitals (LCP, FCP, CLS) and provide insights into the user experience.

#### Example Browser Test Structure (with parameterization)

```javascript
import { browser } from 'k6/browser';
import { check } from 'k6';
import { collectAllMetrics } from '../utils/coreVitals.js';

const BASE_URL = __ENV.BASE_URL || 'https://example.com';
const TEMPLATE = __ENV.TEMPLATE || 'homeTemplate';

export default async function() {
  const page = browser.newPage();
  const tags = { template: TEMPLATE };
  try {
    await page.goto(BASE_URL);
    const metrics = await collectAllMetrics(page, tags, metricDefinitions);
    console.log(`LCP: ${metrics.cwvMetrics.lcp}ms for template ${tags.template}`);
  } finally {
    page.close();
  }
}
```

**Run directly:**
```sh
k6 run tests/browser/verticalBrowser.js --browser --headless=true -e BASE_URL=https://example.com -e TEMPLATE=homeTemplate
```


### Protocol Tests

Protocol tests focus on lower-level protocols or custom endpoints, useful for testing non-HTTP services or specialized protocols.

#### Example Protocol Test Structure (with parameterization)

```javascript
import { check } from 'k6';
import ws from 'k6/ws';

const WS_URL = __ENV.WS_URL || 'ws://echo.websocket.org';
const TEMPLATE = __ENV.TEMPLATE || 'wsTemplate';

export default function() {
  const tags = { template: TEMPLATE };
  const response = ws.connect(WS_URL, { tags }, function(socket) {
    socket.on('open', () => socket.send('Hello'));
    socket.on('message', (data) => {
      check(data, { 'is correct message': (d) => d === 'Hello' }, { tags });
      socket.close();
    });
  });
}
```

**Run directly:**
```sh
k6 run tests/protocol/websocketTest.js -e WS_URL=ws://echo.websocket.org -e TEMPLATE=wsTemplate
```


## Running Tests

### Using k6 Directly

Run tests directly using the k6 command-line tool with all parameters:

```bash
# API Test
k6 run tests/api/apiTest.js \
  -e BASE_URL=https://api.example.com \
  -e TEMPLATE=apiTemplate \
  -e CSV_FILENAME=api.csv \
  -e SCENARIO_TYPE=custom-tps \
  -e ENVIRONMENT=qa \
  -e TIME_UNIT=1s \
  -e K6_REPORT_AUT=shape

# Browser Test
k6 run tests/browser/verticalBrowser.js --browser --headless=true \
  -e BASE_URL=https://example.com \
  -e TEMPLATE=homeTemplate \
  -e CSV_FILENAME=shape.csv \
  -e SCENARIO_TYPE=custom-tps \
  -e ENVIRONMENT=qa \
  -e TIME_UNIT=1s \
  -e K6_REPORT_AUT=shape \
  -e CAPTURE_MANTLE_METRICS=true \
  -e RAMPING_STAGES="10s:1,2m:35,10s:1"

# Protocol Test
k6 run tests/protocol/vertical.js \
  -e BASE_URL=wss://ws.example.com \
  -e CSV_FILENAME=vertical.csv \
  -e SCENARIO_TYPE=custom-tps \
  -e ENVIRONMENT=qa \
  -e TIME_UNIT=1s \
  -e K6_REPORT_AUT=shape \
  -e RAMPING_STAGES="10s:1,2m:35,10s:1"
```

### Using the run_k6_tests.sh Script

The included `run_k6_tests.sh` script provides a convenient wrapper with additional features:

```bash
# API Test
./run_k6_tests.sh --script=apiTest.js --test-type=API --scenario=load --vus=10 --duration=30s

# Browser Test
./run_k6_tests.sh --script=verticalBrowser.js --test-type=BROWSER --scenario=custom-tps --environment=qa --headless=true --aut=shape --time-unit=1m --base-url="https://example.com" --ramping-stages="10s:1,2m:35,10s:1"

# Protocol Test
./run_k6_tests.sh --script=websocketTest.js --test-type=PROTOCOL --scenario=stress
```

### Using Docker

The included Dockerfile allows you to run tests in a consistent environment:

```bash
# Build the Docker image
docker build -t k6-tests .

# Run a test with Docker
docker run -v $(pwd)/results:/app/results k6-tests --script=verticalBrowser.js --test-type=BROWSER --scenario=custom-tps --environment=qa --headless=true --aut=shape --time-unit=1m --base-url="https://example.com" --ramping-stages="10s:1,2m:35,10s:1"
```

## Custom HTML Reports

This framework includes an enhanced HTML reporting system that provides detailed visualizations of test results.

### Report Features

#### For All Test Types
- Summary statistics with pass/fail metrics
- Response time distributions
- Error rate analysis
- Detailed request/response logs
- Template-based grouping of metrics

#### For Browser Tests
- **Core Web Vitals**: LCP (Largest Contentful Paint), FCP (First Contentful Paint), CLS (Cumulative Layout Shift), and TTFB metrics with color-coded thresholds
- **Page Load Time**: Detailed breakdown of page load performance
- **Network Resources Statistics**: Comprehensive statistics for different resource types (JS, CSS, images, fonts, etc.)
- **Mantle Metrics**: Ad-related metrics including ad load times, rendering, and viewability

#### For Protocol Tests
- Connection statistics
- Protocol-specific metrics
- Custom timing measurements

### Viewing Reports

After running a test, HTML reports are generated in the `results/` directory with filenames following the pattern:

```
results/<TEST_TYPE>_<AUT>_<SCENARIO>_report.html
```

For example: `results/BROWSER_shape_custom-tps_report.html`

## Configuration Options

### Common Command Line Options

| Option | Description | Example |
|--------|-------------|--------|
| `--script` | Test script to run | `--script=verticalBrowser.js` |
| `--test-type` | Type of test (API, BROWSER, PROTOCOL) | `--test-type=BROWSER` |
| `--scenario` | Test scenario (load, stress, spike, custom-tps) | `--scenario=custom-tps` |
| `--environment` | Target environment (dev, qa, prod) | `--environment=qa` |
| `--aut` | Application under test | `--aut=shape` |
| `--time-unit` | Time unit for test duration | `--time-unit=1m` |
| `--base-url` | Base URL for the test | `--base-url="https://example.com"` |

### Browser-Specific Options

| Option | Description | Example |
|--------|-------------|--------|
| `--headless` | Run browser in headless mode | `--headless=true` |
| `--ramping-stages` | VU ramp up/down pattern | `--ramping-stages="10s:1,2m:35,10s:1"` |

### API-Specific Options

| Option | Description | Example |
|--------|-------------|--------|
| `--vus` | Number of virtual users | `--vus=10` |
| `--duration` | Test duration | `--duration=30s` |

### Environment Variables

You can also configure tests using environment variables:

```bash
CAPTURE_MANTLE_METRICS=true ./run_k6_tests.sh --script=verticalBrowser.js --test-type=BROWSER
```

Key environment variables:

- `CAPTURE_MANTLE_METRICS`: Controls Mantle metrics collection
- `DEBUG`: Enables verbose logging
- `K6_BROWSER_ARGS`: Additional browser arguments
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