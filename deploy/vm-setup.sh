#!/usr/bin/env bash
# Sets up (or updates) the Hazard Globe server on a small Debian or Ubuntu VM, behind Caddy for HTTPS.
#
#   curl -fsSL https://raw.githubusercontent.com/alijafri786/hazard-globe/main/deploy/vm-setup.sh \
#     | sudo APP_ORIGIN=https://hazard-globe.example.workers.dev bash
#
# APP_ORIGIN  where people open the web app (required): used for WEB_ORIGIN and PUBLIC_URL.
# API_HOST    hostname for the server (optional). Defaults to <external-ip>.sslip.io, which resolves to
#             the VM's IP with no DNS setup. Reserve the IP as static, or the name stops working when it changes.
#
# The VM needs ports 80 and 443 open (Caddy gets its certificate over port 80). Port 8787 stays closed:
# the server is only reached through Caddy. Running the script again pulls the latest code and restarts.
set -euo pipefail

: "${APP_ORIGIN:?Set APP_ORIGIN to the web app's address, e.g. https://hazard-globe.example.workers.dev}"
APP_ORIGIN=${APP_ORIGIN%/}
REPO=${REPO:-https://github.com/alijafri786/hazard-globe}
BRANCH=${BRANCH:-main}
DIR=/opt/hazard-globe
SERVICE_USER=hazard

if [ "$(id -u)" -ne 0 ]; then echo "Run as root (sudo)." >&2; exit 1; fi

external_ip() {
  curl -fsS -m 5 -H 'Metadata-Flavor: Google' \
    http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip \
    || curl -fsS -m 5 https://api.ipify.org
}
API_HOST=${API_HOST:-$(external_ip | tr . -).sslip.io}

echo "==> Packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ca-certificates curl git caddy

if ! node --version 2>/dev/null | grep -Eq '^v(2[2-9]|[3-9][0-9])\.'; then
  echo "==> Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -q nodejs
fi

# 1 GB machines run out of memory compiling TypeScript without some swap
if ! swapon --show --noheadings | grep -q .; then
  echo "==> 1 GB swap file"
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

id "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --home-dir "$DIR" --shell /usr/sbin/nologin "$SERVICE_USER"

echo "==> Code ($BRANCH)"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$DIR" reset --hard FETCH_HEAD
else
  git clone --depth 1 --branch "$BRANCH" "$REPO" "$DIR"
fi
mkdir -p "$DIR/server/data"
chown -R "$SERVICE_USER:$SERVICE_USER" "$DIR"

echo "==> Build"
sudo -u "$SERVICE_USER" -H bash -c "cd '$DIR' && npm ci --workspace server --no-audit --no-fund && npm run build --workspace server"

ENV_FILE="$DIR/server/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "==> server/.env (new VAPID keys)"
  KEYS=$(cd "$DIR/server" && node -e "const k=require('web-push').generateVAPIDKeys();console.log(k.publicKey+' '+k.privateKey)")
  cat > "$ENV_FILE" <<EOF
PORT=8787
WEB_ORIGIN=$APP_ORIGIN
PUBLIC_URL=$APP_ORIGIN
# Caddy and the Cloudflare Worker both sit in front of the server
TRUST_PROXY=2
DATA_FILE=$DIR/server/data/store.json
POLL_INTERVAL_MINUTES=15
VAPID_PUBLIC_KEY=${KEYS% *}
VAPID_PRIVATE_KEY=${KEYS#* }
VAPID_SUBJECT=$APP_ORIGIN
# Optional extras: see server/.env.example (email, Telegram, fires, ships, faster flights)
EOF
  chown "$SERVICE_USER:$SERVICE_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
else
  echo "==> Keeping existing server/.env"
fi

echo "==> Service"
cat > /etc/systemd/system/hazard-globe.service <<EOF
[Unit]
Description=Hazard Globe server
After=network-online.target
Wants=network-online.target

[Service]
User=$SERVICE_USER
WorkingDirectory=$DIR/server
ExecStart=/usr/bin/node --max-old-space-size=384 dist/index.js
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$DIR/server/data

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable hazard-globe >/dev/null
systemctl restart hazard-globe

echo "==> Caddy for https://$API_HOST"
cat > /etc/caddy/Caddyfile <<EOF
$API_HOST {
	encode zstd gzip
	reverse_proxy 127.0.0.1:8787 {
		# Keep the client address the Cloudflare Worker sends; the server's TRUST_PROXY=2 reads past it
		trusted_proxies 0.0.0.0/0 ::/0
	}
}
EOF
systemctl reload caddy || systemctl restart caddy

for _ in $(seq 1 30); do
  curl -fsS -o /dev/null http://127.0.0.1:8787/api/events && break
  sleep 2
done

echo
if curl -fsS -o /dev/null http://127.0.0.1:8787/api/events; then
  echo "Server is up."
else
  echo "Server didn't answer yet: check 'journalctl -u hazard-globe -n 50'." >&2
fi
echo "Set API_ORIGIN on the Worker to: https://$API_HOST"
