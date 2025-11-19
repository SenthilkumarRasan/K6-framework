# Stage 1: Get k6 from the official image
FROM grafana/k6 AS k6

# Stage 2: Your Node.js environment
FROM node:20-bookworm

ARG ART_ID_TOKEN
# Install necessary dependencies for running k6 with browser testing
RUN apt-get update && apt-get install -y --no-install-recommends chromium

# Copy k6 binary from the first stage
COPY --from=k6 /usr/bin/k6 /usr/bin/k6

# Set the working directory
WORKDIR /app

# Copy all files from the repository into the container
COPY . .

RUN node -v && npm -v
ENV NODE_TLS_REJECT_UNAUTHORIZED='0'

RUN \
npm config set strict-ssl false && \
echo "//artifactory.fis.dev/artifactory/api/npm/deeqe-npm-dev/:_authToken=\"$ART_ID_TOKEN\"" > .npmrc && \
echo "email = svc-bpf-internal@fisglobal.com" >> .npmrc && \
echo "always-auth = true" >> .npmrc && \
echo "registry=https://artifactory.fis.dev/artifactory/api/npm/deeqe-npm-dev/" >> .npmrc

# Install Node.js dependencies (if package.json exists)
RUN if [ -f package.json ]; then npm install; fi

USER root
RUN chmod +x /app/run_k6_tests.sh
RUN chown -R node:node /app

USER node

# Set the entrypoint to the shell script
ENTRYPOINT ["./run_k6_tests.sh"]
# Uncomment the following line to run k6 with browser testing as default
# CMD ["--script=k6Browsertestwcorevitals.js", "--test-type=BROWSER", "--environment=qa", "--scenario=smoke", "--headless=true"]

# Keep the container running for debugging purposes
# CMD ["tail", "-f", "/dev/null"]