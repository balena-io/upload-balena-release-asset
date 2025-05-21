#!/usr/bin/env bash

npx esbuild src/index.ts --bundle --platform=node --outfile=build/index.cjs --format=cjs \
  --loader:.map=text \
  --loader:.yml=text \
  --loader:.lintstagedrc=text \
  --loader:.editorconfig=text \
  --loader:.md=text \
  --loader:.txt=text \
  --loader:.d.ts=text \
  --external:./node_modules/pinejs-client-core/.husky/pre-commit \
  --external:./node_modules/balena-sdk/LICENSE \
  --external:./node_modules/balena-sdk/node_modules/@types/node/LICENSE \
  --external:./node_modules/balena-sdk/node_modules/undici-types/LICENSE \
  --minify