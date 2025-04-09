#!/bin/sh

# Default k6 command
K6_COMMAND="k6 run --insecure-skip-tls-verify"

# Default scenario type
SCENARIO_TYPE="smoke"

# Default headless browser mode
HEADLESS_BROWSER=false

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
    *)
      echo "Unknown parameter: $1"
      exit 1
      ;;
  esac
  shift
done

# Export environment variables
export ENVIRONMENT
export SCENARIO_TYPE
export HEADLESS_BROWSER
export RAMPING_STAGES

# Set K6_BROWSER_HEADLESS based on the parameter
export K6_BROWSER_HEADLESS=$HEADLESS_BROWSER

# Validate test type and scenario type
validate_test_type "$TEST_TYPE"
validate_scenario_type "$SCENARIO_TYPE"

# Set the tests folder based on the test type
TESTS_FOLDER="tests/$(echo $TEST_TYPE | tr '[:upper:]' '[:lower:]')"

# Run the specified script
echo "Executing $K6_COMMAND $TESTS_FOLDER/$SCRIPT_TO_RUN"
eval "$K6_COMMAND $TESTS_FOLDER/$SCRIPT_TO_RUN"
