#!/bin/bash
ps aux | grep -E '0lr_audit|hard_audit|ultra' | grep -v grep || echo none
echo '---'
wc -l /tmp/0lr_audit/out.txt 2>/dev/null
tail -40 /tmp/0lr_audit/out.txt 2>/dev/null
