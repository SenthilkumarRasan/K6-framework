# dee-qe-perf-template
K6 based Performance Test framework template

## Installation 

### Mac
brew install k6

### Windows
winget install k6

## How to run on defined environment with selected workload sceanrio

k6 run tests/d1.js -e STACK=qa -e SCENARIO=stage.stress

k6 run tests/fistest.js -e STACK=cloudfis -e SCENARIO=smoke

k6 run tests/bpfEndpointTest.js -e STACK=bpf -e SCENARIO=stage.averageLow

## Running with shell script

STACK=qa SCENARIO=smoke bash k6-test-run.sh d1.js

Here d1.js is the name of the performance script to be executed on qa stack with smoke workload scenario.

## How to see full debug log

k6 run tests/d1.js -e STACK=qa SCENARIO=smoke --http-debug="full"

## Reporting

### default reporting
k6 print out summary results to stdout

### use --out flag to send out Real-time metrics to database, for example Influxdb
k6 run tests/d1.js --out influxdb=http://localhost:8086/k6

### use helper function handleSummary() to generate html formatted summary

### How to see dashboard report
Run test with the K6_WEB_DASHBOARD and K6_WEB_DASHBOARD_EXPORT parameters to get overtime performance overview charts
VUs, Transfer rate, HTTP Request Duration, Iteration Duration, TLS handshaking, Request Waiting and many more.

K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT=results/test-report.html k6 run tests/d1.js -e STACK=qa -e SCENARIO=stage.averageLow