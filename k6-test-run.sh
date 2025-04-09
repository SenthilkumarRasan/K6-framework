#!/bin/bash

# Check if script name is passed as an argument
if [ -z "$1" ]; then
  echo "Error: No script name provided. Please pass the script name as an argument."
  echo "Usage: $0 <script-name>"
  echo "Example: STACK=qa SCENARIO=smoke k6-test-run.sh d1.js"
  exit 1
fi

SCRIPT_NAME=$1

# Check if STACK environment variable is set
if [ -z "$STACK" ]; then
  echo 'Error: STACK environment variable is not set. Please set it using STACK=<value>.'

  echo "Here is an example: STACK=qa SCENARIO=smoke k6-test-run.sh d1.js"
  exit 1
fi

# Check if SCENARIO environment variable is set
if [ -z "$SCENARIO" ]; then
  echo 'Error: SCENARIO environment variable is not set. Please set it using SCENARIO=<value>.'
  exit 1
fi

# Run the k6 tests
k6 run tests/$SCRIPT_NAME -e STACK=$STACK -e SCENARIO=$SCENARIO