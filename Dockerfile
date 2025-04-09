FROM grafana/k6:latest

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
ENTRYPOINT ["./run_k6_tests.sh"]
