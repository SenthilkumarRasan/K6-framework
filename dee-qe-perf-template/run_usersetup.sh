#!/bin/bash

# Simplified user setup runner for d1flexbrowserusersetup

# Default values
ENV="uat"
USERS=5
ITERATIONS=30
CSV_FILENAME="d1flexuiusersetup_uat.csv"
BASE_URL=""
SELECTION_MODE="global_sequential"
AUT="d1flexuiusersetup"
TRANSFER_ITERATIONS=1

show_usage() {
  echo "Usage: $0 --env=ENV --users=VUS --iterations=ITER --csv_filename=FILENAME --base_url=URL"
  echo "  --env=ENV             Environment (uat, perf, etc.)"
  echo "  --users=VUS           Number of virtual users (VUs)"
  echo "  --iterations=ITER     Number of iterations"
  echo "  --csv_filename=FILE   CSV filename in testdata/ (e.g. d1flexuiusersetup_uat.csv)"
  echo "  --base_url=URL        Base URL for the test (required)"
  echo "Example: $0 --env=uat --users=5 --iterations=30 --csv_filename=d1flexuiusersetup_uat.csv --base_url=https://example.com"
}

# Parse arguments
for i in "$@"; do
  case $i in
    --env=*)
      ENV="${i#*=}"
      shift
      ;;
    --users=*)
      USERS="${i#*=}"
      shift
      ;;
    --iterations=*)
      ITERATIONS="${i#*=}"
      shift
      ;;
    --csv_filename=*)
      CSV_FILENAME="${i#*=}"
      shift
      ;;
    --base_url=*)
      BASE_URL="${i#*=}"
      shift
      ;;
    --transfer_iterations=*)
      TRANSFER_ITERATIONS="${i#*=}"
      shift
      ;;
    --help)
      show_usage
      exit 0
      ;;
    *)
      echo "Unknown option: $i"
      show_usage
      exit 1
      ;;
  esac
done

if [ -z "$ENV" ] || [ -z "$USERS" ] || [ -z "$ITERATIONS" ] || [ -z "$CSV_FILENAME" ] || [ -z "$BASE_URL" ]; then
  show_usage
  exit 1
fi

# Hardcoded values
SCRIPT="d1flexbrowserusersetup.js"
TEST_TYPE="BROWSER"
HEADLESS="false"

OUTPUT_FILE="test_output_$(date +%Y%m%d_%H%M%S).log"
TARGET_CSV="./testdata/d1flexapi_${ENV}.csv"

# Run the test
echo "Setting environment variables: VUS=$USERS, ITERATIONS=$ITERATIONS"
export VUS=$USERS 
export ITERATIONS=$ITERATIONS
# Explicitly export required variables
export ENVIRONMENT=$ENV
export TEST_TYPE=$TEST_TYPE
export HEADLESS=$HEADLESS
export BASE_URL=$BASE_URL
export CSV_FILENAME=$CSV_FILENAME
export SCENARIO_TYPE="smoke"
export TRANSFER_ITERATIONS=$TRANSFER_ITERATIONS

echo "Running test with the following parameters:"
echo "- Environment: $ENV"
echo "- Number of users: $USERS"
echo "- Number of iterations: $ITERATIONS"
echo "- CSV filename: $CSV_FILENAME"
echo "- Base URL: $BASE_URL"
echo "- Target CSV: $TARGET_CSV"
echo "- Script: $SCRIPT"
echo ""
echo "Starting test execution..."

./run_k6_tests.sh \
  --script=$SCRIPT \
  --environment=$ENV \
  --test-type=$TEST_TYPE \
  --base-url=$BASE_URL \
  --csv-filename=$CSV_FILENAME \
  --headless=$HEADLESS \
  --selection-mode=$SELECTION_MODE \
  --scenario=smoke \
  --aut=$AUT | tee "$OUTPUT_FILE"

echo -e "\nExtracting user data from test output and appending to $TARGET_CSV..."

# Ensure CSV exists with header for all 5 fields
if [ ! -f "$TARGET_CSV" ]; then
  echo "fiIdentifier,username,password,accountid,customerid" > "$TARGET_CSV"
  echo "Created $TARGET_CSV with header."
fi

# Simplified but very robust solution to extract the user data
echo "DEBUG: Looking for the exact CSV format in the log output..."

# Create a copy of the log file to handle any binary data in the log 
grep -a '' "$OUTPUT_FILE" > clean_output.tmp

# Use the tee command to log the output being redirected to extracted_users.tmp
# for debugging purposes, so we can see what our grep is capturing
grep -a "021[0-9]\{6\},apiuser[0-9]\+,Password#0,[0-9]\+,[0-9]\+" clean_output.tmp | tee extraction_debug.tmp > extracted_users.tmp

# If we didn't find anything, try just searching for the 021 prefix which is unique to our data
if [ ! -s extracted_users.tmp ]; then
  echo "DEBUG: Using a more general pattern to search for user data..."
  grep -a "021[0-9]\{6\}," clean_output.tmp | grep -a ",Password#0," | tee extraction_debug.tmp > extracted_users.tmp
fi

# Final diagnostic - show what we found or didn't find
if [ -s extracted_users.tmp ]; then
  echo "DEBUG: Successfully found user data:"
  cat extracted_users.tmp
else
  echo "DEBUG: No user data found in log. Here are relevant log snippets:"
  grep -a -E "(apiuser|Password|021|user data|CSV)" clean_output.tmp | tail -n 20
fi

# Clean up temporary files
rm -f clean_output.tmp extraction_debug.tmp

if [ ! -s extracted_users.tmp ]; then
  echo "WARNING: No user data patterns found in the test output."
  echo "DEBUG: Here are the last 50 lines of the output file to help diagnose:"
  tail -n 50 "$OUTPUT_FILE" | grep -E "INFO|user|CSV|021" 
  rm -f extracted_users.tmp
else
  # Validate that each line has exactly 5 fields (fiIdentifier,username,password,accountid,customerid)
  INVALID_LINES=$(grep -v -E '^[^,]+,[^,]+,[^,]+,[^,]+,[^,]+$' extracted_users.tmp)
  if [ -n "$INVALID_LINES" ]; then
    echo "WARNING: Found invalid data lines (not 5 fields). Filtering them out."
    grep -E '^[^,]+,[^,]+,[^,]+,[^,]+,[^,]+$' extracted_users.tmp > valid_users.tmp
    mv valid_users.tmp extracted_users.tmp
  fi

  # Count the lines that were extracted
  LINE_COUNT=$(wc -l < extracted_users.tmp)
  echo "Successfully extracted $LINE_COUNT user data lines from the test output."
  
  # Preview the extracted data
  echo "Preview of extracted data:"
  head -n 5 extracted_users.tmp

  # Merge with existing data, preserving uniqueness
  if [ -f "$TARGET_CSV" ]; then
    # Create a temporary file with current users (excluding header)
    tail -n +2 "$TARGET_CSV" > current_users.tmp
    cat current_users.tmp extracted_users.tmp | sort -u > combined_users.tmp
  else
    cat extracted_users.tmp | sort -u > combined_users.tmp
  fi

  # Write back to target CSV with header
  echo "fiIdentifier,username,password,accountid,customerid" > "$TARGET_CSV"
  cat combined_users.tmp >> "$TARGET_CSV"
  rm -f current_users.tmp combined_users.tmp extracted_users.tmp
  
  # Count how many users we have in the CSV
  USER_COUNT=$(wc -l < "$TARGET_CSV")
  UNIQUE_COUNT=$((USER_COUNT - 1))  # Subtract 1 for the header
  
  echo "Updated $TARGET_CSV with $UNIQUE_COUNT unique users."
  echo "Preview of updated CSV file:"
  head -n 6 "$TARGET_CSV"
  echo "..."
  echo "CSV file format verified: All entries have 5 fields (fiIdentifier,username,password,accountid,customerid)"
fi

# Cleanup
echo "Removing temporary output file: $OUTPUT_FILE"
rm "$OUTPUT_FILE"
echo "Done!"
