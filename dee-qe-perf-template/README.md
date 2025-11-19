# dee-qe-perf-template
K6 based Performance Test framework template

## Installation

### Ensure you are in the parent directory of the project folder

Before running any commands, make sure you are in the parent directory of the project folder. For example:
cd /Users/{userid}/Documents/gitHub-repo

## Get dee-qe-perf-template repository from GitHub

git clone git@github.com:Banking-Solutions-Digital/dee-qe-perf-template.git

Then navigate to the project folder:
cd dee-qe-perf-template

### Mac installation
brew install k6

### Windows installation
winget install k6

## Download dependency utility libraries from FIS npm artifactory

npm config set registry=https://artifactory.fis.dev/artifactory/api/npm/deeqe-npm-dev/

npm install

### Run  postinstall script if /utils folder is still not present

npm run postinstall

## How to run on defined environment with selected workload scenario

k6 run tests/api/d1test.js -e ENVIRONMENT=qa -e SCENARIO_TYPE=smoke

k6 run tests/d1.js -e ENVIRONMENT=qa -e WORKLOAD=smoke

k6 run tests/api/bpfEndpointTest.js -e ENVIRONMENT=dev -e SCENARIO=averageLow -e CSV_FILENAME=bpfuser.csv

## Running run_k6_tests.sh with customized scenario

./run_k6_tests.sh  --script=k6Browsertestwcorevitals.js --test-type=BROWSER  --environment=qa --scenario=smoke

here browser starts by default. Add --headless=true if you don't need browser

## Running run_k6_tests.sh for API testing

./run_k6_tests.sh  --script=bpfEndpointTest.js --test-type=API  --environment=dev --scenario=smoke --csv-filename=bpfuser.csv

### Enhanced launcher defaults & transaction distribution (new)

The startup script `run_k6_tests.sh` now provides:

1. Default CSV: `testdata/d1flexapi_perf.csv` (auto-selected if you don't pass `--csv-filename`).
2. Safe transaction distribution override via `--transaction-distribution`.
   * Format: `Name:Weight,OtherName:Weight,...` and weights must sum to 100.
   * Only applies to transactions defined in the target script; unknown names are ignored and default weights retained.
3. Automatic clearing of stale distribution: If you omit the flag or pass `--transaction-distribution=none`, the previous `TRANSACTION_DISTRIBUTION` environment variable is unset so you no longer need to manually run `unset TRANSACTION_DISTRIBUTION`.

#### Examples

Run default smoke (uses built‑in script weights, default CSV):
```bash
./run_k6_tests.sh --script=d1flexKongAPI.js --test-type=API --environment=perf --scenario=smoke --ramping-stages=2s:1,4s:1,2s:0 --aut=d1flexKongAPI
```

Override transaction weights explicitly:
```bash
./run_k6_tests.sh \
  --script=d1flexKongAPI.js \
  --test-type=API \
  --environment=perf \
  --scenario=smoke \
  --ramping-stages=2s:1,4s:1,2s:0 \
  --aut=d1flexKongAPI \
  --transaction-distribution=HistoryTransactions:50,Accounts:30,ConfigurationSignonsecattr:20
```

Explicitly clear any prior override (fallback to script weights):
```bash
./run_k6_tests.sh --script=d1flexKongAPI.js --test-type=API --environment=perf --scenario=smoke --transaction-distribution=none
```

#### Troubleshooting distribution / normalization

If you previously saw the warning:
```
Transaction weights sum to <N>, normalizing to 100%
```
it was due to weights not totaling 100 or a stale `TRANSACTION_DISTRIBUTION` env value. The new script logic unsets stale values automatically. Use `--transaction-distribution=none` if you want to be explicit.

#### Influx & reports

By default the script enables Influx output (using `INFLUXDB_URL` or its internal default) and will generate both a performance dashboard and summary HTML for API tests. Disable Influx with `--influx-enabled=false`. Disable dashboards/reports with:
```bash
--generate-performance-dashboard=false --generate-standard-report=false
```

#### Headless browser tests
For browser tests you can still pass `--headless=true`. The distribution flag is ignored for non‑API scripts unless they implement transaction weighting via the same helper.

### Handling sensitive test credentials (security)

Real usernames/passwords must NOT be committed. The CSV in `testdata/d1flexapi_perf.csv` uses `REDACTED` placeholders. Provide the actual password only via environment variable(s).

Primary override (recommended):
```bash
export TEST_USER_PASSWORD='SuperSecret!'
./run_k6_tests.sh --script=d1flexKongAPI.js --test-type=API --environment=perf --scenario=smoke
```

Fallback legacy name supported: `K6_TEST_USER_PASSWORD`.

Resolution order inside the test script:
1. `TEST_USER_PASSWORD`
2. `K6_TEST_USER_PASSWORD`
3. Raw CSV value (if not a placeholder like `REDACTED`, `****`, `PLACEHOLDER`, or empty)

Credential files (`CREDENTIALS_FILE`) have been removed for simplicity and security. Migrate any prior usage to environment variables.

Optional: Maintain a private CSV with actual passwords (discouraged). If you do, ensure it is git‑ignored (e.g. name it `testdata/users_perf.secret.csv`) and reference it explicitly:
```bash
./run_k6_tests.sh --script=d1flexKongAPI.js --test-type=API --environment=perf --scenario=smoke --csv-filename=testdata/users_perf.secret.csv
```

If no override is supplied and placeholders remain, authentication flows will skip or fail fast according to script logic.

Recommended secret storage approaches:
1. Local, untracked `.env` file sourced before runs.
2. CI/CD encrypted variables injecting `TEST_USER_PASSWORD`.
3. External secret manager exporting the variable into the job environment.

Avoid printing passwords to logs; keep `DEBUG` disabled for auth unless using temporary credentials.

### To run a basic performance test with a custom transactions-per-second (TPS) rate:

ENVIRONMENT=perf SCENARIO_TYPE=custom-tps RAMPING_STAGES=60s:1 ./run_k6_tests.sh --script=d1flexKongAPI.js --test-type=API

## How to see full debug log

k6 run tests/d1.js -e ENVIRONMENT=qa -e WORKLOAD=smoke --http-debug="full"

## Reporting

### default reporting
k6 print out summary results to stdout

### use --out flag to send out Real-time metrics to database, for example Influxdb
k6 run d1.js --out influxdb=http://localhost:8086/k6

### use helper function handleSummary() to generate html formatted summary

### How to see dashboard report
Run test to get overtime performance overview charts VUs, Transfer rate, HTTP Request Duration, 
Iteration Duration, TLS handshaking, Request Waiting and more.

K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT=results/test-report.html k6 run tests/d1.js -e ENVIRONMENT=qa -e SCENARIO=stage.averageLow

### ESLint usage to identify, report and fix code issue
  Run ESLint from the command line to check for issues
  ```bash
  npx eslint .
  ```

  To automatically address some issues by running the following
   ```bash
   npx eslint . --fix
   ```
