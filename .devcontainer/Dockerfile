# See here for image contents: https://github.com/microsoft/vscode-dev-containers/tree/v0.205.2/containers/javascript-node/.devcontainer/base.Dockerfile

# [Choice] Node.js version (use -bullseye variants on local arm64/Apple Silicon): 16, 14, 12, 16-bullseye, 14-bullseye, 12-bullseye, 16-buster, 14-buster, 12-buster
ARG VARIANT="20-bookworm"
FROM mcr.microsoft.com/vscode/devcontainers/javascript-node:1-${VARIANT}

# Install build dependencies including Java (needed for google-closure-compiler on arm64)
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install cmake default-jre-headless

RUN git clone https://github.com/emscripten-core/emsdk.git /emsdk && \
    sudo /emsdk/emsdk install 3.1.71 && \
    sudo /emsdk/emsdk activate 3.1.71 && \
    sudo ln -s /emsdk/upstream/emscripten /usr/share/emscripten

# Add emscripten and its bundled node to PATH.
# The node directory name varies by architecture (e.g. _64bit vs _arm64),
# so we discover it dynamically at build time.
RUN EMSDK_NODE_DIR=$(ls /emsdk/node/ | head -1) && \
    echo "export PATH=\"\$PATH:/emsdk:/emsdk/upstream/emscripten:/emsdk/node/${EMSDK_NODE_DIR}/bin\"" >> /etc/environment
ENV PATH="$PATH:/emsdk:/emsdk/upstream/emscripten"

# Install JS tools for emscripten.
# google-closure-compiler (Java-based jar) works on all architectures;
# the linux-native binary is x64-only so we ignore optional deps.
RUN cd /emsdk/upstream/emscripten/ && sudo npm install acorn google-closure-compiler --force

# [Optional] Uncomment if you want to install an additional version of node using nvm
# ARG EXTRA_NODE_VERSION=10
# RUN su node -c "source /usr/local/share/nvm/nvm.sh && nvm install ${EXTRA_NODE_VERSION}"

# [Optional] Uncomment if you want to install more global node modules
# RUN su node -c "npm install -g <your-package-list-here>"
