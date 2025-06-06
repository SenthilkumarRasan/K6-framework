#!/bin/sh

# Default k6 command
K6_COMMAND="k6 run --insecure-skip-tls-verify"

# Default scenario type
SCENARIO_TYPE="smoke"

# Default headless browser mode
HEADLESS_BROWSER=false

# Default base URL (can be overridden)
BASE_URL=""

# Default vertical (CSV file name without extension)
VERTICAL="allrecipes"

# Default time unit for arrival rate
TIME_UNIT="1s"

# Default selection mode for CSV data
SELECTION_MODE="global_sequential"

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

# Function to validate vertical
validate_vertical() {
  if [ -z "$1" ]; then
    echo "Invalid vertical value: $1. Expected a non-empty string."
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
    --vertical=*)
      VERTICAL="${1#*=}"
      validate_vertical "$VERTICAL"
      ;;
    --time-unit=*)
      TIME_UNIT="${1#*=}"
      ;;
    --selection-mode=*)
      SELECTION_MODE="${1#*=}"
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
export CSV_FILENAME="${VERTICAL}.csv"
export TIME_UNIT
export SELECTION_MODE

# Set K6_BROWSER_HEADLESS based on the parameter
export K6_BROWSER_HEADLESS=$HEADLESS_BROWSER

# Validate test type and scenario type
validate_test_type "$TEST_TYPE"
validate_scenario_type "$SCENARIO_TYPE"

# Set the tests folder based on the test type
TESTS_FOLDER="tests/$(echo $TEST_TYPE | tr '[:upper:]' '[:lower:]')"

# Create the results directory if it doesn't exist
mkdir -p results

# Create screenshots directory if running browser tests
if [ "$TEST_TYPE" = "BROWSER" ]; then
  mkdir -p screenshots
  echo "Created screenshots directory for browser tests"
fi

# Construct the k6 command
k6 run \
  -e STACK="$ENVIRONMENT" \
  -e SCENARIO="$SCENARIO_TYPE" \
  -e RAMPING_STAGES="$RAMPING_STAGES" \
  -e BASE_URL="$BASE_URL" \
  -e CSV_FILENAME="$CSV_FILENAME" \
  -e TIME_UNIT="$TIME_UNIT" \
  -e HEADLESS_BROWSER="$HEADLESS_BROWSER" \
  -e SELECTION_MODE="$SELECTION_MODE" \
  $TESTS_FOLDER/$SCRIPT_TO_RUN  --out json=results/results.json

# Process results with appropriate metrics based on test type
echo "Setting K6_REPORT_TEST_TYPE for Node.js script to: $TEST_TYPE"
export K6_REPORT_TEST_TYPE="$TEST_TYPE"

echo "Processing results for $TEST_TYPE test..."
# In run_k6_tests.sh, before calling the node script:
node utils/process-k6-results.js results/results.json $TEST_TYPE