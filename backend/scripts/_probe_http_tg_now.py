#!/usr/bin/env python3
import base64
import socket

RAW = """
45.139.54.158:63513:66uC85M2ZJU5:xyFuQApb5NgB
92.119.161.150:62657:66uC85M2ZJU5:xyFuQApb5NgB
45.147.1.200:62509:66uC85M2ZJU5:xyFuQApb5NgB
193.201.127.216:63401:66uC85M2ZJU5:xyFuQApb5NgB
194.104.237.233:63253:66uC85M2ZJU5:xyFuQApb5NgB
185.207.213.38:64029:66uC85M2ZJU5:xyFuQApb5NgB
104.164.205.112:63647:66uC85M2ZJU5:xyFuQApb5NgB
104.164.209.27:62913:66uC85M2ZJU5:xyFuQApb5NgB
130.49.17.174:62565:66uC85M2ZJU5:xyFuQApb5NgB
155.212.34.47:64393:66uC85M2ZJU5:xyFuQApb5NgB
138.249.212.178:63683:66uC85M2ZJU5:xyFuQApb5NgB
""".strip().splitlines()

DEST = ("149.154.167.51", 443)


def probe(host, port, user, password, timeout=8.0):
    s = socket.create_connection((host, port), timeout=timeout)
    try:
        auth = base64.b64encode(f"{user}:{password}".encode()).decode()
        req = (
            f"CONNECT {DEST[0]}:{DEST[1]} HTTP/1.1\r\n"
            f"Host: {DEST[0]}:{DEST[1]}\r\n"
            f"Proxy-Authorization: Basic {auth}\r\n"
            f"\r\n"
        )
        s.sendall(req.encode())
        s.settimeout(timeout)
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = s.recv(4096)
            if not chunk:
                break
            buf += chunk
        line = buf.split(b"\r\n", 1)[0].decode("latin1", "replace")
        ok = line.startswith("HTTP/1.0 200") or line.startswith("HTTP/1.1 200")
        return ok, line[:90]
    finally:
        try:
            s.close()
        except Exception:
            pass


def main():
    ok_n = 0
    for line in RAW:
        host, port, user, password = line.strip().split(":")
        try:
            ok, msg = probe(host, int(port), user, password)
        except Exception as e:
            ok, msg = False, str(e)[:70]
        print(("HTTP_OK" if ok else "HTTP_FAIL"), f"{host}:{port}", msg, flush=True)
        if ok:
            ok_n += 1
    print("HTTP_OK_TOTAL", ok_n, "/", len(RAW), flush=True)


if __name__ == "__main__":
    main()
