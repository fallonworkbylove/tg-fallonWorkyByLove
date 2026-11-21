#!/usr/bin/env python3
"""
0q5 — Windows/Mac ship helper: scp files → /tmp/<tag> → run remote py.

Usage (from repo root):
  python backend/scripts/_ship_tag.py 0q5
  python backend/scripts/_ship_tag.py 0q5 --host root@loverussian.duckdns.org

Env:
  LOVERUSSIAN_SSH  default root@loverussian.duckdns.org
  LOVERUSSIAN_KEY  optional path to private key (-i)
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def run(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess:
    print("+", " ".join(cmd))
    return subprocess.run(cmd, cwd=str(ROOT), check=check)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("tag", help="release tag e.g. 0q5")
    ap.add_argument("--host", default=os.environ.get("LOVERUSSIAN_SSH", "root@loverussian.duckdns.org"))
    ap.add_argument("--key", default=os.environ.get("LOVERUSSIAN_KEY", ""))
    ap.add_argument("--no-restart", action="store_true", help="only scp + remote copy/smoke (still runs remote)")
    args = ap.parse_args()
    tag = args.tag.strip()
    if not tag:
        print("tag required", file=sys.stderr)
        return 1

    ssh_base = ["ssh"]
    scp_base = ["scp"]
    if args.key:
        ssh_base += ["-i", args.key]
        scp_base += ["-i", args.key]

    remote_py = ROOT / "backend" / "scripts" / f"_run_{tag}_remote.py"
    smoke = ROOT / "backend" / "scripts" / f"_smoke_{tag}.js"
    if not remote_py.exists():
        print(f"missing {remote_py}", file=sys.stderr)
        return 1
    if not smoke.exists():
        print(f"missing {smoke}", file=sys.stderr)
        return 1

    # Flat names expected by _run_*_remote.py
    mapping = [
        (ROOT / "backend" / "services" / "softHumanGates.js", "softHumanGates.js"),
        (ROOT / "backend" / "services" / "softHumanLite.js", "softHumanLite.js"),
        (ROOT / "backend" / "services" / "messageAnalysis.js", "messageAnalysis.js"),
        (ROOT / "backend" / "services" / "aiResponder.js", "aiResponder.js"),
        (ROOT / "backend" / "services" / "humanThinLayer.js", "humanThinLayer.js"),
        (ROOT / "backend" / "services" / "aiResponderPostprocess.js", "aiResponderPostprocess.js"),
        (ROOT / "backend" / "services" / "replyPipeline.js", "replyPipeline.js"),
        (ROOT / "backend" / "services" / "humanizeSpeech.js", "humanizeSpeech.js"),
        (ROOT / "backend" / "middleware" / "httpRateLimit.js", "httpRateLimit.js"),
        (ROOT / "backend" / "middleware" / "telegramAuth.js", "telegramAuth.js"),
        (ROOT / "backend" / "middleware" / "debugUser.js", "debugUser.js"),
        (ROOT / "backend" / "server.js", "server.js"),
        (ROOT / "backend" / "services" / "helpRequestNotifier.js", "helpRequestNotifier.js"),
        (ROOT / "backend" / "scripts" / "_smoke_security_0ix.js", "_smoke_security_0ix.js"),
        (ROOT / "frontend" / "index.html", "index_frontend.html"),
        (ROOT / "ops-console" / "app" / "index.html", "index_ops.html"),
        (ROOT / "frontend" / "updates.js", "updates_fe.js"),
        (ROOT / "ops-console" / "app" / "updates.js", "updates_ops.js"),
        (ROOT / "frontend" / "styles.css", "styles.css"),
        (ROOT / "CHANGELOG_TG.md", "CHANGELOG_TG.md"),
        (smoke, f"_smoke_{tag}.js"),
        (ROOT / "docs" / "agent" / "SMELL_INDEX.md", "SMELL_INDEX.md"),
        (ROOT / "docs" / "agent" / "GATE_CATALOG.md", "GATE_CATALOG.md"),
        (ROOT / "backend" / "scripts" / "_gen_smell_catalog.js", "_gen_smell_catalog.js"),
        (ROOT / "backend" / "scripts" / "_scaffold_gate.js", "_scaffold_gate.js"),
        (ROOT / "backend" / "scripts" / "_ship_tag.py", "_ship_tag.py"),
        (remote_py, f"_run_{tag}_remote.py"),
    ]

    run(ssh_base + [args.host, f"mkdir -p /tmp/{tag}"])
    for local, remote_name in mapping:
        if not local.exists():
            print(f"SKIP missing {local}")
            continue
        run(scp_base + [str(local), f"{args.host}:/tmp/{tag}/{remote_name}"])

    # remote runner itself must live under /tmp/tag then we execute it
    remote_cmd = f"python3 /tmp/{tag}/_run_{tag}_remote.py"
    if args.no_restart:
        print("NOTE: remote script still restarts pm2 unless you edit it; --no-restart is advisory")
    r = run(ssh_base + [args.host, remote_cmd], check=False)
    return r.returncode


if __name__ == "__main__":
    raise SystemExit(main())
