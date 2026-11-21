#!/usr/bin/env python3
"""Single-tar ship helper (avoids SSH rate-limit on many scp). Usage: python backend/scripts/_ship_tar.py 0rk"""
from __future__ import annotations
import argparse, os, subprocess, sys, tarfile, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("tag")
    ap.add_argument("--host", default=os.environ.get("LOVERUSSIAN_SSH", "root@loverussian.duckdns.org"))
    ap.add_argument("--retries", type=int, default=3)
    args = ap.parse_args()
    tag = args.tag.strip()
    smoke = ROOT / "backend" / "scripts" / f"_smoke_{tag}.js"
    remote_py = ROOT / "backend" / "scripts" / f"_run_{tag}_remote.py"
    if not smoke.exists() or not remote_py.exists():
        print("missing smoke/remote", file=sys.stderr)
        return 1

    mapping = [
        (ROOT / "backend/services/softHumanGates.js", "softHumanGates.js"),
        (ROOT / "backend/services/softHumanLite.js", "softHumanLite.js"),
        (ROOT / "backend/services/messageAnalysis.js", "messageAnalysis.js"),
        (ROOT / "backend/services/aiResponder.js", "aiResponder.js"),
        (ROOT / "backend/services/humanThinLayer.js", "humanThinLayer.js"),
        (ROOT / "backend/services/aiResponderPostprocess.js", "aiResponderPostprocess.js"),
        (ROOT / "backend/services/replyPipeline.js", "replyPipeline.js"),
        (ROOT / "backend/services/humanizeSpeech.js", "humanizeSpeech.js"),
        (ROOT / "backend/middleware/httpRateLimit.js", "httpRateLimit.js"),
        (ROOT / "backend/middleware/telegramAuth.js", "telegramAuth.js"),
        (ROOT / "backend/middleware/debugUser.js", "debugUser.js"),
        (ROOT / "backend/server.js", "server.js"),
        (ROOT / "backend/services/helpRequestNotifier.js", "helpRequestNotifier.js"),
        (ROOT / "backend/scripts/_smoke_security_0ix.js", "_smoke_security_0ix.js"),
        (ROOT / "frontend/index.html", "index_frontend.html"),
        (ROOT / "ops-console/app/index.html", "index_ops.html"),
        (ROOT / "frontend/updates.js", "updates_fe.js"),
        (ROOT / "ops-console/app/updates.js", "updates_ops.js"),
        (ROOT / "frontend/styles.css", "styles.css"),
        (ROOT / "CHANGELOG_TG.md", "CHANGELOG_TG.md"),
        (smoke, f"_smoke_{tag}.js"),
        (ROOT / "docs/agent/SMELL_INDEX.md", "SMELL_INDEX.md"),
        (ROOT / "docs/agent/GATE_CATALOG.md", "GATE_CATALOG.md"),
        (ROOT / "backend/scripts/_gen_smell_catalog.js", "_gen_smell_catalog.js"),
        (ROOT / "backend/scripts/_scaffold_gate.js", "_scaffold_gate.js"),
        (ROOT / "backend/scripts/_ship_tag.py", "_ship_tag.py"),
        (remote_py, f"_run_{tag}_remote.py"),
    ]
    tar_path = Path(os.environ.get("TEMP", "/tmp")) / f"{tag}_ship.tar"
    with tarfile.open(tar_path, "w") as tf:
        for local, remote in mapping:
            if not local.exists():
                print("MISS", local, file=sys.stderr)
                return 1
            info = tf.gettarinfo(str(local), arcname=remote)
            info.mtime = int(time.time()) - 120
            with open(local, "rb") as fh:
                tf.addfile(info, fh)

    remote_cmd = (
        f"set -e; rm -rf /tmp/{tag}; mkdir -p /tmp/{tag}; "
        f"tar -xf /tmp/{tag}_ship.tar -C /tmp/{tag}; "
        f"python3 /tmp/{tag}/_run_{tag}_remote.py"
    )
    for i in range(args.retries):
        try:
            subprocess.check_call(
                ["scp", "-o", "ConnectTimeout=30", str(tar_path), f"{args.host}:/tmp/{tag}_ship.tar"]
            )
            subprocess.check_call(["ssh", "-o", "ConnectTimeout=30", args.host, remote_cmd])
            print(f"SHIP_{tag.upper()}_OK")
            return 0
        except subprocess.CalledProcessError as e:
            print(f"RETRY {i + 1}", e, file=sys.stderr)
            time.sleep(12)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
