FROM ubuntu:24.04

# `NODE_OPTIONS` enables TypeScript type stripping for every Node process in the
# VM (including any Node < 22.18 that the runtime may put ahead of this image's
# node on PATH), so `npm test` runs the .ts test files without a build step.
ENV DEBIAN_FRONTEND=noninteractive \
    NODE_OPTIONS=--experimental-strip-types

# System packages plus Node.js 24 (matches the publish workflow) from NodeSource.
# `pi` is installed globally so the documented preview command resolves on PATH.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates curl git gnupg tmux ncurses-bin \
    && install -d -m 0755 /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
        | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" \
        > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g @earendil-works/pi-coding-agent@0.81.1 \
    && rm -rf /var/lib/apt/lists/*

USER ubuntu
