#!/usr/bin/env bash

npx esbuild src/index.ts --bundle --platform=node --outfile=build/index.cjs --format=cjs \
  --external:balena-sdk

