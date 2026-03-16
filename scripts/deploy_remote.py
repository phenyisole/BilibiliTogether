import os
import posixpath
import sys
from pathlib import Path

import paramiko


LOCAL_ROOT = Path(__file__).resolve().parents[1]
REMOTE_ROOT = "/home/ubuntu/BilibiliTogether"
EXCLUDE_DIRS = {".git", "node_modules", "__pycache__"}


def env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
      raise RuntimeError(f"Missing environment variable: {name}")
    return value


HOST = env("DEPLOY_HOST")
USER = env("DEPLOY_USER")
PASSWORD = env("DEPLOY_PASSWORD")

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="ignore")


def run(client: paramiko.SSHClient, command: str, sudo: bool = False, timeout: int = 1800) -> None:
    full_command = command
    if sudo:
        escaped = command.replace("'", "'\"'\"'")
        full_command = f"sudo -S -p '' bash -lc '{escaped}'"

    print(f"\n$ {full_command}")
    stdin, stdout, stderr = client.exec_command(full_command, timeout=timeout)
    if sudo:
        stdin.write(PASSWORD + "\n")
        stdin.flush()

    out = stdout.read().decode("utf-8", errors="ignore")
    err = stderr.read().decode("utf-8", errors="ignore")
    if out:
        print(out)
    if err:
        print(err)

    status = stdout.channel.recv_exit_status()
    if status != 0:
        raise RuntimeError(f"Command failed with status {status}: {command}")


def ensure_remote_dir(sftp: paramiko.SFTPClient, remote_path: str) -> None:
    parts = []
    current = remote_path
    while current not in ("", "/"):
        parts.append(current)
        current = posixpath.dirname(current)

    for part in reversed(parts):
        try:
            sftp.stat(part)
        except FileNotFoundError:
            sftp.mkdir(part)


def upload_tree(client: paramiko.SSHClient) -> None:
    sftp = client.open_sftp()
    try:
        for root, dirs, files in os.walk(LOCAL_ROOT):
            dirs[:] = [name for name in dirs if name not in EXCLUDE_DIRS]
            rel_dir = os.path.relpath(root, LOCAL_ROOT)
            remote_dir = REMOTE_ROOT if rel_dir == "." else posixpath.join(REMOTE_ROOT, rel_dir.replace("\\", "/"))
            ensure_remote_dir(sftp, remote_dir)

            for file_name in files:
                local_path = os.path.join(root, file_name)
                remote_path = posixpath.join(remote_dir, file_name)
                sftp.put(local_path, remote_path)
                print(f"uploaded {remote_path}")
    finally:
        sftp.close()


def main() -> None:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(hostname=HOST, username=USER, password=PASSWORD, timeout=30)

    try:
        run(client, f"mkdir -p {REMOTE_ROOT}")
        upload_tree(client)

        run(client, "apt-get update", sudo=True)
        run(client, "apt-get install -y curl ca-certificates gnupg nginx", sudo=True)
        run(client, "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -", sudo=True)
        run(client, "apt-get install -y nodejs", sudo=True)
        run(client, "npm install -g pm2", sudo=True)

        run(client, f"cd {REMOTE_ROOT} && npm install")
        run(client, "pm2 delete bilibili-together || true")
        run(client, f"cd {REMOTE_ROOT} && pm2 start ecosystem.config.cjs")
        run(client, "pm2 save")
        run(client, "env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu", sudo=True)

        nginx_conf = """cat > /etc/nginx/sites-available/bilibili-together <<'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF"""
        run(client, nginx_conf, sudo=True)
        run(client, "ln -sf /etc/nginx/sites-available/bilibili-together /etc/nginx/sites-enabled/bilibili-together", sudo=True)
        run(client, "rm -f /etc/nginx/sites-enabled/default", sudo=True)
        run(client, "nginx -t", sudo=True)
        run(client, "systemctl restart nginx", sudo=True)
        run(client, "systemctl enable nginx", sudo=True)

        run(client, "pm2 status bilibili-together")
        run(client, "curl -i http://127.0.0.1:8787/healthz")
        run(client, "curl -i http://127.0.0.1/healthz")
    finally:
        client.close()

    print("\nDEPLOY_OK")


if __name__ == "__main__":
    main()
