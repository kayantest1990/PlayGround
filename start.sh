#!/usr/bin/env bash
# Shoes Store API + static storefront.
# Installs dependencies, publishes deployment output, serves in the foreground.
# Every setup command is timed with /usr/bin/time -p (final exec replaces the shell, so it cannot be wrapped).
set -euo pipefail
# NOTE: cd is a shell builtin and cannot be wrapped by /usr/bin/time; all external commands below are timed.
cd "$(dirname "$0")"
PROJECT_DIR="$(pwd)"
STATIC_DIR="$PROJECT_DIR/public"
PORT="${PORT:-3000}"
export PORT
WEB_DIR="${OPENCODE_WEB_DIR:-/home/runner/work/_temp/omgithub-web}"

/usr/bin/time -p test -f "$PROJECT_DIR/package.json"
/usr/bin/time -p test -f "$STATIC_DIR/index.html"
/usr/bin/time -p test -f "$PROJECT_DIR/server.js"
if /usr/bin/time -p test ! -d "$PROJECT_DIR/node_modules"; then
  /usr/bin/time -p npm install --no-audit --no-fund
fi
/usr/bin/time -p mkdir -p "$WEB_DIR"
/usr/bin/time -p env PROJECT_DIR="$PROJECT_DIR" STATIC_DIR="$STATIC_DIR" WEB_DIR="$WEB_DIR" node -e "const fs=require('fs'),path=require('path');fs.writeFileSync(path.join(process.env.WEB_DIR,'deployment-output.json'),JSON.stringify({project:process.env.PROJECT_DIR,directory:process.env.STATIC_DIR}));"
/usr/bin/time -p cat "$WEB_DIR/deployment-output.json"
echo ""
echo "Serving Shoes Store on PORT=$PORT (project=$PROJECT_DIR static=$STATIC_DIR)"
exec node "$PROJECT_DIR/server.js"
