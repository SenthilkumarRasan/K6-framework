#!/bin/sh

# Default k6 command
K6_COMMAND="k6 run --insecure-skip-tls-verify"

# Default scenario type
SCENARIO_TYPE="smoke"

# Default headless browser mode
HEADLESS_BROWSER=false

# BASE_URL will be derived automatically from env/<environment>.json; manual override removed
BASE_URL=""

# Whether to prefer Kong configuration when reading env JSON (exported to child processes)
# Respect an externally exported USE_KONG if present; otherwise default to false
USE_KONG="${USE_KONG:-false}"

# Default AUT (Application Under Test - CSV file name without extension)
AUT="Kongapi"

# Optional transaction distribution override (comma-separated list "Name:Weight,Name2:Weight")
# If omitted or set to "none", any previously exported TRANSACTION_DISTRIBUTION will be cleared
TRANSACTION_DISTRIBUTION=""

# CSV file name (explicitly set for this run)
# Prefer the repository testdata file 'testdata/d1flexapi_perf.csv' when present
DEFAULT_CSV_PATH="testdata/d1flexapi_perf.csv"
if [ -f "$DEFAULT_CSV_PATH" ]; then
  CSV_FILENAME="$DEFAULT_CSV_PATH"
else
  CSV_FILENAME="bpfuser.csv"
fi

# Default time unit for arrival rate
TIME_UNIT="1s"

# Influx output configuration (simplified Option D):
# We only add an InfluxDB output if INFLUXDB_URL is explicitly set by the caller.
# The previous DEFAULT_INFLUXDB_URL and INFLUX_ENABLED auto logic have been removed.
# Deprecated: INFLUX_ENABLED (will warn if set without INFLUXDB_URL).

# Default selection mode for CSV data
SELECTION_MODE="global_sequential"

# Web dashboard is controlled via command line parameter
# Removed default setting for clarity

# Default values for report generation
GENERATE_PERFORMANCE_DASHBOARD="true"
GENERATE_STANDARD_REPORT="true"

# Default SLA configuration for performance metrics
SLA_CONFIG='{"avg":{"warn":300,"danger":500},"med":{"warn":250,"danger":400},"p90":{"warn":500,"danger":800}}'

# Function to validate environment
validate_environment() {
  if [ -z "$1" ]; then
    echo "Invalid environment value: $1. Expected a non-empty string."
    exit 1
  fi
}

# Function to validate scenario type
validate_scenario_type() {
  local valid_scenarios="smoke,spiketest,loadtest,stresstest,endurancetest,custom-tps,custom-vus"
  if ! echo "$valid_scenarios" | grep -q "$1"; then
    echo "Invalid scenario type: $1. Valid options are: $valid_scenarios"
    exit 1
  fi
}

# Function to validate test type
validate_test_type() {
  local valid_test_types="BROWSER,API,PROTOCOL,MULTI"
  if ! echo "$valid_test_types" | grep -q "$1"; then
    echo "Invalid test type: $1. Valid options are: $valid_test_types"
    exit 1
  fi
}

# Function to validate AUT
validate_aut() {
  if [ -z "$1" ]; then
    echo "Invalid AUT value: $1. Expected a non-empty string."
    exit 1
  fi
}

# Process command-line arguments
while [ $# -gt 0 ]; do
  case "$1" in
    --script=*)
      SCRIPT_TO_RUN="${1#*=}"
      ;;
    --environment=*)
      ENVIRONMENT="${1#*=}"
      validate_environment "$ENVIRONMENT"
      ;;
    --scenario=*)
      SCENARIO_TYPE="${1#*=}"
      ;;
    --test-type=*)
      TEST_TYPE="${1#*=}"
      validate_test_type "$TEST_TYPE"
      ;;
    --headless=*)
      HEADLESS_BROWSER="${1#*=}"
      ;;
    --ramping-stages=*)
      RAMPING_STAGES="${1#*=}"
      ;;
    --use-kong=*)
      USE_KONG="${1#*=}"
      ;;
    --aut=*)
      AUT="${1#*=}"
      validate_aut "$AUT"
      ;;
    --time-unit=*)
      TIME_UNIT="${1#*=}"
      ;;
    --selection-mode=*)
      SELECTION_MODE="${1#*=}"
      ;;
    --webdashboard=*)
      WEBDASHBOARD_ENABLED="${1#*=}"
      ;;
    --generate-performance-dashboard=*) # Flag for performance dashboard
      GENERATE_PERFORMANCE_DASHBOARD="${1#*=}"
      ;;
    --generate-standard-report=*) # Flag for standard report
      GENERATE_STANDARD_REPORT="${1#*=}"
      ;;
    --sla-config=*) # SLA configuration JSON for performance thresholds
      SLA_CONFIG="${1#*=}"
      ;;
    --csv-filename=*) # Accept --csv-filename as a valid parameter
      CSV_FILENAME="${1#*=}"
      ;;
    --influx-enabled=*)
      INFLUX_ENABLED="${1#*=}"
      ;;
    --transaction-distribution=*) # Override transaction weights (ex: HistoryTransactions:45,Accounts:33,...)
      TRANSACTION_DISTRIBUTION="${1#*=}"
      ;;
    *)
      echo "Unknown parameter: $1"
      exit 1
      ;;
  esac
  shift
done

# Validate required parameters
if [ -z "$SCRIPT_TO_RUN" ]; then
  echo "Error: --script parameter is required"
  exit 1
fi

if [ -z "$ENVIRONMENT" ]; then
  echo "Error: --environment parameter is required"
  exit 1
fi

if [ -z "$TEST_TYPE" ]; then
  echo "Error: --test-type parameter is required"
  exit 1
fi

CONFIG_FILE="env/${ENVIRONMENT}.json"
echo "Resolving BASE_URL from config file: $CONFIG_FILE"
export USE_KONG
if [ -f "$CONFIG_FILE" ]; then
  BASE_URL=$(node -e "
    const config = JSON.parse(require('fs').readFileSync('$CONFIG_FILE', 'utf8'));
    const useKong = (process.env.USE_KONG || '').toLowerCase() === 'true';
    if (useKong && config.d1flex_kong && config.d1flex_kong.baseURL) {
      console.log(config.d1flex_kong.baseURL); process.exit(0);
    }
    function findBaseURL(obj) {
      if (typeof obj !== 'object' || obj === null) return null;
      if (obj.baseURL) return obj.baseURL;
      for (const key in obj) {
        const result = findBaseURL(obj[key]);
        if (result) return result;
      }
      return null;
    }
    console.log(findBaseURL(config) || '');
  ")
fi
if [ -z "$BASE_URL" ]; then
  echo "Error: baseURL must be defined in env/${ENVIRONMENT}.json (d1flex or d1flex_kong section)."
  exit 1
fi

echo "Using BASE_URL: $BASE_URL"

# Export environment variables
export ENVIRONMENT
export SCENARIO_TYPE
export HEADLESS_BROWSER
export RAMPING_STAGES
export BASE_URL
export AUT # Export AUT itself
# If CSV_FILENAME is a simple filename and a matching file exists under testdata/,
# prefer that testdata path so users can pass just the basename.
if [ ! -f "$CSV_FILENAME" ] && [ -f "testdata/$CSV_FILENAME" ]; then
  CSV_FILENAME="testdata/$CSV_FILENAME"
fi

export CSV_FILENAME # Explicitly export the CSV file name
export TIME_UNIT
export SELECTION_MODE
export GENERATE_PERFORMANCE_DASHBOARD="$GENERATE_PERFORMANCE_DASHBOARD"

# Set K6_BROWSER_HEADLESS based on the parameter
export K6_BROWSER_HEADLESS=$HEADLESS_BROWSER
export USE_KONG

# Validate test type and scenario type
validate_test_type "$TEST_TYPE"
validate_scenario_type "$SCENARIO_TYPE"

# Handle transaction distribution override
if [ -n "$TRANSACTION_DISTRIBUTION" ] && [ "$TRANSACTION_DISTRIBUTION" != "none" ]; then
  export TRANSACTION_DISTRIBUTION
  echo "Transaction distribution override enabled: $TRANSACTION_DISTRIBUTION"
else
  # If explicitly set to 'none' or omitted, clear any inherited value to avoid stale weights
  if [ "$TRANSACTION_DISTRIBUTION" = "none" ]; then
    echo "Clearing TRANSACTION_DISTRIBUTION (none specified)"
  else
    echo "No transaction distribution override provided; using script-defined weights"
  fi
  unset TRANSACTION_DISTRIBUTION 2>/dev/null || true
fi

# Set the tests folder based on the test type
TESTS_FOLDER="tests/$(echo $TEST_TYPE | tr '[:upper:]' '[:lower:]')"

# Create the results directory if it doesn't exist
mkdir -p results

# Generate timestamp for unique file names
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

# Define the report filenames with timestamp
RESULTS_PREFIX="results/${TEST_TYPE}_${AUT}_${SCENARIO_TYPE}_${TIMESTAMP}"
RESULTS_JSON="${RESULTS_PREFIX}.json"
SUMMARY_JSON="${RESULTS_PREFIX}_summary.json"
RESULTS_HTML="${RESULTS_PREFIX}_dashboard.html"

# Build k6 run command with optional web-dashboard output
K6_OUT_ARGS="--out json=$RESULTS_JSON --summary-export=$SUMMARY_JSON"
if [ "$WEBDASHBOARD_ENABLED" = "true" ]; then
  # Set K6_WEB_DASHBOARD_PERIOD to ensure graphs are generated
  # The report only includes graphs if test duration > 3 * aggregation period
  export K6_WEB_DASHBOARD_PERIOD=1s
  K6_OUT_ARGS="$K6_OUT_ARGS --out web-dashboard=$RESULTS_HTML"
fi

# Influx output addition (simplified): only if INFLUXDB_URL is set.
if [ -n "$INFLUXDB_URL" ]; then
  echo "Adding InfluxDB output (explicit INFLUXDB_URL): $INFLUXDB_URL"
  K6_OUT_ARGS="$K6_OUT_ARGS --out influxdb=$INFLUXDB_URL"
elif [ -n "$INFLUX_ENABLED" ]; then
  echo "[DEPRECATED] INFLUX_ENABLED is deprecated. Set INFLUXDB_URL to enable Influx output."
fi

# Run the k6 command
echo "DEBUG: launching k6 with CSV_FILENAME='$CSV_FILENAME' and BASE_URL='$BASE_URL'"

# Assemble base k6 command arguments (without optional distribution override)
K6_CMD=(k6 run
  -e ENVIRONMENT="$ENVIRONMENT"
  -e SCENARIO_TYPE="$SCENARIO_TYPE"
  -e RAMPING_STAGES="$RAMPING_STAGES"
  -e BASE_URL="$BASE_URL"
  -e USE_KONG="$USE_KONG"
  -e CSV_FILENAME="$CSV_FILENAME"
  -e TIME_UNIT="$TIME_UNIT"
  -e HEADLESS_BROWSER="$HEADLESS_BROWSER"
  -e SELECTION_MODE="$SELECTION_MODE"
  -e TEST_TYPE="$TEST_TYPE"
  -e AUT="$AUT"
  -e GENERATE_PERFORMANCE_DASHBOARD="$GENERATE_PERFORMANCE_DASHBOARD"
  -e REFRESH_INTERVAL_MS="${REFRESH_INTERVAL_MS:-600000}"
  -e DEBUG="${DEBUG:-false}"
  -e DEBUG_TOKEN_CACHING="${DEBUG_TOKEN_CACHING:-false}"
  -e FULL_RESPONSE_LOG="${FULL_RESPONSE_LOG:-false}"
)

# Conditionally append transaction distribution override
if [ -n "$TRANSACTION_DISTRIBUTION" ]; then
  K6_CMD+=( -e TRANSACTION_DISTRIBUTION="$TRANSACTION_DISTRIBUTION" )
fi

# Append script path and output arguments last
K6_CMD+=("$TESTS_FOLDER/$SCRIPT_TO_RUN")
# shellcheck disable=SC2086  # We intentionally expand K6_OUT_ARGS into separate tokens
K6_CMD+=($K6_OUT_ARGS)

# Print the full command (single-line) so it's easy to copy/paste for debugging
echo "K6 command: ${K6_CMD[*]}"

# Execute the k6 command
"${K6_CMD[@]}"

# Process results with appropriate metrics based on test type - keeping standard report generation
echo "Setting K6_REPORT_TEST_TYPE for Node.js script to: $TEST_TYPE"
export K6_REPORT_TEST_TYPE="$TEST_TYPE"

echo "Processing results for $TEST_TYPE test..."
export K6_REPORT_AUT="$AUT" # Export AUT for the results processor

# Create processed JSON file for protocol report generators
TEST_TYPE_LOWER=$(echo "$TEST_TYPE" | tr '[:upper:]' '[:lower:]')
PROCESSED_JSON="temp/${TEST_TYPE_LOWER}_processed.json"

# If webdashboard flag is enabled, print the dashboard HTML location
if [ "$WEBDASHBOARD_ENABLED" = "true" ]; then
  echo "[INFO] k6 HTML dashboard generated at $RESULTS_HTML"
fi

# Only generate performance/summary reports if not a usersetup test
if [[ "$AUT" != "d1flexuiusersetup" ]]; then
  # Generate the Performance Dashboard and Summary Report only if test type is API

  if [ "$TEST_TYPE_LOWER" = "api" ]; then
    # Generate the Performance Dashboard based on test type
    if [ "$GENERATE_PERFORMANCE_DASHBOARD" = "true" ]; then
      echo "\n----- Generating Performance Dashboard -----"
      
      # Define the final dashboard path with timestamp
      DASHBOARD_OUTPUT_PATH="results/${TEST_TYPE}_${AUT}_${SCENARIO_TYPE}_${TIMESTAMP}_dashboard.html"
      
      # Use the centralized run.js for performance dashboard generation
      echo "Using centralized run.js for performance dashboard generation"
      
      # Pass the SLA configuration to the dashboard generator
      echo "Using SLA configuration: $SLA_CONFIG"
      export K6_SLA_CONFIG="$SLA_CONFIG"
      
      node dashboards_builder/run.js \
        "$RESULTS_JSON" \
        "$SUMMARY_JSON" \
        "$DASHBOARD_OUTPUT_PATH" \
        "$TEST_TYPE" \
        "$AUT" \
        "$SCENARIO_TYPE" \
        "performance"

      echo "\n----- Performance Dashboard Generation Complete -----"
      echo "Dashboard available at: $DASHBOARD_OUTPUT_PATH"
    fi

    # Generate the Summary Report based on test type
    if [ "$GENERATE_STANDARD_REPORT" = "true" ]; then
      echo "\n----- Generating Summary Report -----"
      
      # Define the final summary report path with timestamp
      SUMMARY_REPORT_PATH="results/${TEST_TYPE}_${AUT}_${SCENARIO_TYPE}_${TIMESTAMP}_summary.html"
      
      # For API tests: Use the centralized run.js for summary report generation
      echo "Using centralized run.js for API summary report generation"
      node dashboards_builder/run.js \
        "$RESULTS_JSON" \
        "$SUMMARY_JSON" \
        "$SUMMARY_REPORT_PATH" \
        "$TEST_TYPE" \
        "$AUT" \
        "$SCENARIO_TYPE" \
        "summary"

      echo "\n----- Summary Report Generation Complete -----"
      echo "Summary report available at: $SUMMARY_REPORT_PATH"
    fi
  else
    echo "Skipping performance dashboard and summary report generation for test type: $TEST_TYPE"
  fi
else
  echo "Skipping performance dashboard and summary report generation for user setup test ($AUT)"
fi

# Summary of generated reports
echo "
Test Summary:"
echo "Test Type: $TEST_TYPE"
echo "Application: $AUT"
echo "Scenario: $SCENARIO_TYPE"
echo "Raw Results: $RESULTS_JSON"
echo "Summary: $SUMMARY_JSON"