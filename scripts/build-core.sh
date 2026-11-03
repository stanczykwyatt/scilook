#!/bin/bash
# Rebuilds the bundled preview code (Sources/SciLookCore/Resources/scilook.js) from js/.
set -euo pipefail
cd "$(dirname "$0")/../js"
npm ci --ignore-scripts --no-audit --no-fund >/dev/null
node build.mjs
