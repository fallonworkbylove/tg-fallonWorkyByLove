#!/usr/bin/env python3
"""SSH helper for new HOSTKEY NL VPS. Password via env NL_VPS_PASS."""
import os
import sys
import paramiko

HOST = os.environ.get("NL_VPS_HOST", "31.57.143.31")
USER = os.environ.get("NL_VPS_USER", "root")
PASS = os.environ.get("NL_VPS_PASS", "")


def client():
    if not PASS:
        raise SystemExit("Set NL_VPS_PASS")
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(
        HOST,
        username=USER,
        password=PASS,
        timeout=40,
        allow_agent=False,
        look_for_keys=False,
    )
    return c


def run(cmd, timeout=120):
    c = client()
    try:
        stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout)
        out = stdout.read().decode("utf-8", "replace")
        err = stderr.read().decode("utf-8", "replace")
        code = stdout.channel.recv_exit_status()
        sys.stdout.write(out)
        if err:
            sys.stderr.write(err)
        return code
    finally:
        c.close()


if __name__ == "__main__":
    cmd = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else "uname -a"
    raise SystemExit(run(cmd))
