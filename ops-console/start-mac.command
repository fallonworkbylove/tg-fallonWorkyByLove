#!/bin/bash
cd "$(dirname "$0")"
APP=$(ls -d dist/mac*/LoveRussian\ OPS.app 2>/dev/null | head -n1)
if [ -n "$APP" ]; then
  open "$APP"
  exit 0
fi
if [ ! -d node_modules/electron ]; then
  npm install
fi
npx --no-install electron .
