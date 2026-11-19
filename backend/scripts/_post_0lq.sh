#!/bin/bash
set -e
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
OPENAI_API_KEY=sk-a node scripts/_smoke_audit_c_fix_0lq.js
grep -q cleanBoardSnippet services/leadScoring.js && echo OK wire_snippet
grep -q renderEmptyBoard ../ops-console/app/renderer.js && echo OK wire_empty
grep -q 'target.dataset.reply' ../frontend/app.js && echo OK wire_bad_target
grep -q 'updates.js?v=247' ../frontend/index.html && echo OK bump247
pm2 jlist | node -e '
let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{
  const j=JSON.parse(d); const e=j.find(x=>x.name==="tgbot").pm2_env;
  const pl=String(e.PROXY_LIST||"").split(";").filter(Boolean);
  console.log("pm2",e.status,"PROXY",pl.length);
  if(e.status!=="online"||pl.length<5) process.exit(1);
});
'
echo POST_0lq_A_OK
