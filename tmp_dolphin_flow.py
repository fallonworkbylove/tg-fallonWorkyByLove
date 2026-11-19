import re
import sys

sys.stdout.reconfigure(encoding="utf-8")
bg = open(
    r"C:\Users\lox\AppData\Local\Temp\dolphin_asar_extract\js_dist\background.js",
    encoding="utf-8",
    errors="replace",
).read()

keys = [
    "checkLatestVersion",
    "choosingLocalApiHost",
    "localApiAlreadyDownloaded",
    "definingInterfaceHost",
    "errorChoosingHostLocalApi",
    "errorChoosingInterfaceHost",
    "webContents.send(",
]
for k in keys:
    print(k, len(re.findall(re.escape(k), bg)))

print("\n=== send events ===")
for m in re.finditer(r"""webContents\.send\(["']([^"']+)["']""", bg):
    ev = m.group(1)
    if any(
        x in ev.lower()
        for x in ["local", "api", "host", "error", "splash", "download", "unpack", "interface", "version"]
    ):
        print(ev, "at", m.start())

print("\n=== around app ready / splash create ===")
for pat in ["createSplash", "splash.html", "loadFile", "ready-to-show", "app.whenReady", "downloadAndStart"]:
    for m in re.finditer(pat, bg):
        print("---", pat, m.start())
        print(bg[m.start() - 100 : m.start() + 400].replace("\n", " ")[:450])
        print()
        break
