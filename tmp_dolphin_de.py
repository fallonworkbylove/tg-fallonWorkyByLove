import re
import sys

sys.stdout.reconfigure(encoding="utf-8")
d = open(
    r"C:\Users\lox\AppData\Local\Temp\dolphin_asar_extract\public\splash\splash.bundle.js",
    encoding="utf-8",
    errors="replace",
).read()
for pat in ["async function De", "function De(", "De=async", "await De("]:
    print(pat, d.find(pat))
m = re.search(r"async function De\(|function De\(|De=async\(", d)
if m:
    print("FOUND", m.start())
    print(d[m.start() : m.start() + 2500])

bg = open(
    r"C:\Users\lox\AppData\Local\Temp\dolphin_asar_extract\js_dist\background.js",
    encoding="utf-8",
    errors="replace",
).read()
for m in re.finditer(r"downloadLocalApi", bg):
    print("bg hit", m.start(), bg[m.start() - 80 : m.start() + 200].replace("\n", " ")[:280])
    break
for m in re.finditer(r"""ipcMain\.(on|handle)\(["']downloadLocalApi["']""", bg):
    print("IPC", m.start())
    print(bg[m.start() : m.start() + 500])
