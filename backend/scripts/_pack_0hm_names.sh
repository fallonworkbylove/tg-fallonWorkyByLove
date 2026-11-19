#!/bin/bash
# rename uploaded files for deploy script expectations
set -euo pipefail
D=/tmp/0hm
cd "$D"
[ -f updates.js ] && mv -f updates.js frontend_updates.js
[ -f index.html ] && mv -f index.html frontend_index.html
# ops updates may collide name — second scp used updates.js for ops; if only one, copy
if [ -f frontend_updates.js ] && [ ! -f ops_updates.js ]; then
  # ops was uploaded as separate path; expect ops_updates.js already or duplicate
  true
fi
ls -la "$D"
sed -i 's/\r$//' "$D/_deploy_0hm.sh"
bash "$D/_deploy_0hm.sh" "$D"
