FROM mcr.microsoft.com/devcontainers/javascript-node:1-20-bookworm
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends postgresql postgresql-contrib && rm -rf /var/lib/apt/lists/*
