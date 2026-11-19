#!/usr/bin/env python3
"""Upload a local file to NL VPS and optionally run it. Env: NL_VPS_PASS."""
import os
import sys
import paramiko

HOST = os.environ.get("NL_VPS_HOST", "31.57.143.31")
USER = os.environ.get("NL_VPS_USER", "root")
PASS = os.environ.get("NL_VPS_PASS", "")


def main():
    if len(sys.argv) < 3:
        print("usage: _nl_put_and_run.py local_path remote_path [--bash]")
        return 2
    if not PASS:
        print("Set NL_VPS_PASS")
        return 2
    local, remote = sys.argv[1], sys.argv[2]
    do_bash = "--bash" in sys.argv
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASS, timeout=40, allow_agent=False, look_for_keys=False)
    sftp = c.open_sftp()
    sftp.put(local, remote)
    sftp.close()
    print(f"UPLOADED {local} -> {remote}")
    if do_bash:
        cmd = f"sed -i 's/\\r$//' {remote} && bash {remote}"
        stdin, stdout, stderr = c.exec_command(cmd, timeout=600)
        sys.stdout.write(stdout.read().decode("utf-8", "replace"))
        sys.stderr.write(stderr.read().decode("utf-8", "replace"))
        code = stdout.channel.recv_exit_status()
        c.close()
        return code
    c.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
