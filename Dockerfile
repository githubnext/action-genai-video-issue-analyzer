# For additional guidance on containerized actions, see https://docs.github.com/en/actions/sharing-automations/creating-actions/creating-a-docker-container-action
FROM node:lts-alpine


# Install packages
RUN apk add --no-cache git ffmpeg curl

# check
RUN node --version
RUN ffmpeg -version

# Set working directory
WORKDIR /genaiscript/action

# Copy source code
COPY . .

# Make entrypoint script executable
RUN chmod +x entrypoint.sh

# Install dependencies
RUN npm ci

# GitHub Action forces the WORKDIR to GITHUB_WORKSPACE 
ENTRYPOINT ["./entrypoint.sh"]