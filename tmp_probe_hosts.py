import urllib.request,sys
sys.stdout.reconfigure(encoding="utf-8")
hosts=[
"https://dolphin-anty-api.com/health",
"https://app.dolphin-anty-mirror3.com/",
"https://app.dolphin-anty-mirror3.net/",
"https://app.dolphin-anty-mirror4.net/",
"https://app.dolphin-anty-mirror4.com/",
"https://app.dolphin-anty-mirror4.org/",
"https://app.dolphin-anty-mirror2.net/",
"https://dolphin-anty-cdn.com/",
"https://app.traffic-mirror.com/",
]
for u in hosts:
  try:
    r=urllib.request.urlopen(u, timeout=7)
    print("OK", r.status, u)
  except Exception as e:
    print("ERR", u, "::", e)
