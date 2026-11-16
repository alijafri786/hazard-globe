#!/usr/bin/env bash
# Sets up (or updates) the Hazard Globe server on a small Debian or Ubuntu VM, behind Caddy for HTTPS.
#
#   curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/alijafri786/hazard-globe/main/deploy/vm-setup.sh \
#     | sudo APP_ORIGIN=https://hazard-globe.example.workers.dev bash
#
# APP_ORIGIN  where people open the web app (required): used for WEB_ORIGIN and PUBLIC_URL.
# API_HOST    hostname for the server (optional). Defaults to <external-ip>.sslip.io, which resolves to
#             the VM's IP with no DNS setup. Reserve the IP as static, or the name stops working when it changes.
# ORIGIN_SECRET  shared secret the Cloudflare Worker sends in X-Origin-Auth (optional). Generated on the first
#             run and kept in /etc/caddy/origin-secret. Caddy refuses requests without it, so the server can only
#             be reached through your Worker: give the Worker the same value as its ORIGIN_SECRET secret.
#
# The VM needs ports 80 and 443 open (Caddy gets its certificate over port 80). The server listens on
# 127.0.0.1:8787 only, behind Caddy. Running the script again pulls the latest code and restarts.
set -euo pipefail

: "${APP_ORIGIN:?Set APP_ORIGIN to the web app address, e.g. https://hazard-globe.example.workers.dev}"
APP_ORIGIN=${APP_ORIGIN%/}
REPO=${REPO:-https://github.com/alijafri786/hazard-globe}
BRANCH=${BRANCH:-main}
DIR=/opt/hazard-globe
SERVICE_USER=hazard

if [ "$(id -u)" -ne 0 ]; then echo "Run as root (sudo)." >&2; exit 1; fi

external_ip() {
  curl -fsS -m 5 -H 'Metadata-Flavor: Google' \
    http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip \
    || curl --proto '=https' --tlsv1.2 -fsS -m 5 https://api.ipify.org
}
API_HOST=${API_HOST:-$(external_ip | tr . -).sslip.io}

echo "==> Packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ca-certificates curl git caddy

if ! node --version 2>/dev/null | grep -Eq '^v(2[2-9]|[3-9][0-9])\.'; then
  echo "==> Node.js 22"
  # HTTPS only, even across redirects: this script runs as root
  curl --proto '=https' --tlsv1.2 -fsSL https://deb.nodesource.com/setup_22.x | bash -
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
# The checkout belongs to the service user and git runs as that user: run as root, git refuses a checkout
# owned by someone else ("dubious ownership"), which would break every update
as_service() { sudo -u "$SERVICE_USER" -H "$@"; }
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" "$DIR"
chown -R "$SERVICE_USER:$SERVICE_USER" "$DIR"
if [ -d "$DIR/.git" ]; then
  as_service git -C "$DIR" fetch --depth 1 origin "$BRANCH"
  as_service git -C "$DIR" reset --hard FETCH_HEAD
else
  as_service git clone --depth 1 --branch "$BRANCH" "$REPO" "$DIR"
fi
as_service mkdir -p "$DIR/server/data"

echo "==> Build"
as_service bash -c "cd '$DIR' && npm ci --workspace server --no-audit --no-fund && npm run build --workspace server"

ENV_FILE="$DIR/server/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "==> server/.env (new VAPID keys)"
  KEYS=$(cd "$DIR/server" && node -e "const k=require('web-push').generateVAPIDKeys();console.log(k.publicKey+' '+k.privateKey)")
  cat > "$ENV_FILE" <<EOF
PORT=8787
# Only Caddy, on this machine, talks to the server
HOST=127.0.0.1
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
  # Setups from before HOST existed listened on every interface
  grep -q '^HOST=' "$ENV_FILE" || printf '\n# Only Caddy, on this machine, talks to the server\nHOST=127.0.0.1\n' >> "$ENV_FILE"
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
SECRET_FILE=/etc/caddy/origin-secret
if [ -n "${ORIGIN_SECRET:-}" ]; then
  printf '%s' "$ORIGIN_SECRET" > "$SECRET_FILE"
elif [ ! -s "$SECRET_FILE" ]; then
  head -c 32 /dev/urandom | base64 | tr -d '/+=\n' > "$SECRET_FILE"
fi
ORIGIN_SECRET=$(cat "$SECRET_FILE")
case "$ORIGIN_SECRET" in
  '' | *[!A-Za-z0-9_-]*) echo "ORIGIN_SECRET may only contain letters, digits, - and _." >&2; exit 1 ;;
esac
chown root:caddy "$SECRET_FILE"
chmod 640 "$SECRET_FILE"

cat > /etc/caddy/Caddyfile <<EOF
$API_HOST {
	encode zstd gzip

	# Only the Cloudflare Worker knows the secret, so the server can't be reached around it
	@worker header X-Origin-Auth "$ORIGIN_SECRET"
	handle @worker {
		request_header -X-Origin-Auth
		reverse_proxy 127.0.0.1:8787 {
			# Only the Worker gets this far, and it sets X-Forwarded-For to the visitor's address: keep it,
			# so the server's TRUST_PROXY=2 (Worker + Caddy) finds the visitor
			trusted_proxies 0.0.0.0/0 ::/0
		}
	}
	respond 403
}
EOF
chown root:caddy /etc/caddy/Caddyfile
chmod 640 /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy

# /api/health answers at once; /api/events waits for the first GDACS poll, which can take minutes
for _ in $(seq 1 30); do
  curl -fs -m 5 -o /dev/null http://127.0.0.1:8787/api/health && break
  sleep 2
done

echo
if curl -fs -m 5 -o /dev/null http://127.0.0.1:8787/api/health; then
  echo "Server is up."
else
  echo "Server didn't answer yet: check 'journalctl -u hazard-globe -n 50'." >&2
fi
echo "On the Cloudflare Worker (Settings > Variables and Secrets), set:"
echo "  API_ORIGIN     https://$API_HOST   (type: Text)"
echo "  ORIGIN_SECRET  the contents of $SECRET_FILE   (type: Secret; show it with: sudo cat $SECRET_FILE)"
