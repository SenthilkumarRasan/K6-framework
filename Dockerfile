FROM grafana/k6:latest

# Install Node.js (example: Node 18)
RUN apk add --no-cache nodejs npm

# Set the working directory
WORKDIR /app

# Copy all files from the repository into the container
COPY . .

# Switch to root user to set permissions
USER root
RUN chmod +x /app/run_k6_tests.sh

# Switch back to the default user
USER k6

# Set the entrypoint to the shell script
ENTRYPOINT ["/app/run_k6_tests.sh"]

# Default command with all possible command line options
# These can be overridden at runtime
CMD ["--script=verticalBrowser.js", "--test-type=BROWSER", "--scenario=custom-tps", "--environment=qa", "--headless=true", "--aut=shape", "--time-unit=1m", "--base-url=https://example.com", "--ramping-stages=10s:1,2m:35,10s:1"]