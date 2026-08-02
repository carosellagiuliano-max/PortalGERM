#!/bin/sh
set -eu

node --conditions=react-server /app/dist/phase33/runtime-preflight.mjs
exec node /app/server.js
