#!/bin/sh

# Default k6 command
K6_COMMAND="k6 run --insecure-skip-tls-verify"

# Default scenario type
SCENARIO_TYPE="smoke"

# Default headless browser mode
HEADLESS_BROWSER=false

# Default base URL (can be overridden)
BASE_URL=""

# Default AUT (Application Under Test - CSV file name without extension)
AUT="allrecipes"

# Default time unit for arrival rate
TIME_UNIT="1s"

# Default selection mode for CSV data
SELECTION_MODE="global_sequential"

# Default value for the flag
CAPTURE_MANTLE_METRICS_ENABLED="true"

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
    --base-url=*)
      BASE_URL="${1#*=}"
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
    --capture-mantle-metrics=*) # New flag
      CAPTURE_MANTLE_METRICS_ENABLED="${1#*=}"
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
if [ -z "$BASE_URL" ]; then
  echo "Error: --base-url parameter is required"
  exit 1
fi

# Export environment variables
export ENVIRONMENT
export SCENARIO_TYPE
export HEADLESS_BROWSER
export RAMPING_STAGES
export BASE_URL
export AUT # Export AUT itself
export CSV_FILENAME="${AUT}.csv"
export TIME_UNIT
export SELECTION_MODE
export CAPTURE_MANTLE_METRICS="$CAPTURE_MANTLE_METRICS_ENABLED" # Export the flag
export GENERATE_PERFORMANCE_DASHBOARD="$GENERATE_PERFORMANCE_DASHBOARD"

# Set K6_BROWSER_HEADLESS based on the parameter
export K6_BROWSER_HEADLESS=$HEADLESS_BROWSER

# Validate test type and scenario type
validate_test_type "$TEST_TYPE"
validate_scenario_type "$SCENARIO_TYPE"

# Set the tests folder based on the test type
TESTS_FOLDER="tests/$(echo $TEST_TYPE | tr '[:upper:]' '[:lower:]')"

# Create the results directory if it doesn't exist
mkdir -p results

# Define the report filenames
RESULTS_PREFIX="results/${TEST_TYPE}_${AUT}_${SCENARIO_TYPE}"
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

# Run the k6 command
k6 run \
  -e ENVIRONMENT="$ENVIRONMENT" \
  -e SCENARIO="$SCENARIO_TYPE" \
  -e RAMPING_STAGES="$RAMPING_STAGES" \
  -e BASE_URL="$BASE_URL" \
  -e CSV_FILENAME="$CSV_FILENAME" \
  -e TIME_UNIT="$TIME_UNIT" \
  -e HEADLESS_BROWSER="$HEADLESS_BROWSER" \
  -e SELECTION_MODE="$SELECTION_MODE" \
  -e CAPTURE_MANTLE_METRICS="$CAPTURE_MANTLE_METRICS" \
  -e APP_NAME="$AUT" \
  -e TEST_TYPE="$TEST_TYPE" \
  -e AUT="$AUT" \
  -e SCENARIO_TYPE="$SCENARIO_TYPE" \
  -e GENERATE_PERFORMANCE_DASHBOARD="$GENERATE_PERFORMANCE_DASHBOARD" \
  $TESTS_FOLDER/$SCRIPT_TO_RUN $K6_OUT_ARGS

# Process results with appropriate metrics based on test type - keeping standard report generation
echo "Setting K6_REPORT_TEST_TYPE for Node.js script to: $TEST_TYPE"
export K6_REPORT_TEST_TYPE="$TEST_TYPE"

echo "Processing results for $TEST_TYPE test..."
export K6_REPORT_AUT="$AUT" # Export AUT for the results processor

# Create processed JSON file for protocol report generators
PROCESSED_JSON="temp/${TEST_TYPE,,}_processed.json"

# If webdashboard flag is enabled, print the dashboard HTML location
if [ "$WEBDASHBOARD_ENABLED" = "true" ]; then
  echo "[INFO] k6 HTML dashboard generated at $RESULTS_HTML"
fi

# Generate the Performance Dashboard based on test type
if [ "$GENERATE_PERFORMANCE_DASHBOARD" = "true" ]; then
  echo "\n----- Generating Performance Dashboard -----"
  
  # Define the final dashboard path
  DASHBOARD_OUTPUT_PATH="results/${TEST_TYPE}_${AUT}_${SCENARIO_TYPE}_dashboard.html"
  
  # Use the centralized run.js for performance dashboard generation
  echo "Using centralized run.js for performance dashboard generation"
  
  # Pass the SLA configuration to the dashboard generator
  echo "Using SLA configuration: $SLA_CONFIG"
  export K6_SLA_CONFIG="$SLA_CONFIG"
  
  node utils/dashboards/run.js \
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
  
  # Define the final summary report path
  SUMMARY_REPORT_PATH="results/${TEST_TYPE}_${AUT}_${SCENARIO_TYPE}_summary.html"
  
  # Process based on test type - API uses run.js, PROTOCOL/BROWSER use process-k6-results.js directly
  # Use tr for lowercase conversion instead of ${var,,} for better shell compatibility
  TEST_TYPE_LOWER=$(echo "$TEST_TYPE" | tr '[:upper:]' '[:lower:]')
  if [ "$TEST_TYPE_LOWER" = "api" ]; then
    # For API tests: Use the centralized run.js for summary report generation
    echo "Using centralized run.js for API summary report generation"
    node utils/dashboards/run.js \
      "$RESULTS_JSON" \
      "$SUMMARY_JSON" \
      "$SUMMARY_REPORT_PATH" \
      "$TEST_TYPE" \
      "$AUT" \
      "$SCENARIO_TYPE" \
      "summary"
  else
    # For PROTOCOL and BROWSER tests: Use process-k6-results.js directly
    echo "Using process-k6-results.js directly for ${TEST_TYPE} summary report"
    node utils/process-k6-results.js "$RESULTS_JSON" "$SUMMARY_REPORT_PATH"
  fi

  echo "\n----- Summary Report Generation Complete -----"
  echo "Summary report available at: $SUMMARY_REPORT_PATH"
fi

# Summary of generated reports
echo "
Test Summary:"
echo "Test Type: $TEST_TYPE"
echo "Application: $AUT"
echo "Scenario: $SCENARIO_TYPE"
echo "Raw Results: $RESULTS_JSON"
echo "Summary: $SUMMARY_JSON"