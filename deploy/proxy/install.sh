#!/usr/bin/env bash
# Puts the site on a server in Iran as a reverse proxy to the Cloudflare Worker (Cloudflare itself is
# blocked there): visitors open https://<domain> on this server, which forwards to <worker>.workers.dev.
#   sudo bash install.sh kadochie.ir gift-shop.m-cyber-warrior.workers.dev
# Uses nginx when it is installed (HTTPS via certbot), otherwise Caddy.
# Prints PROXY_SECRET: set the same value on the Worker (npx wrangler secret put PROXY_SECRET)
# BEFORE pointing the domain here. Run again any time (e.g. after the DNS change, for HTTPS); the
# secret is kept.
set -euo pipefail

DOMAIN="${1:-}"
WORKER="${2:-}"
if [ -z "$DOMAIN" ] || [ -z "$WORKER" ]; then echo "usage: sudo bash $0 <domain> <worker host, e.g. gift-shop.NAME.workers.dev>"; exit 1; fi
if [ "$(id -u)" != 0 ]; then echo "run as root (sudo)"; exit 1; fi
WORKER="${WORKER#https://}"; WORKER="${WORKER%%/*}"

install -d -m 0700 /etc/gift-shop-proxy
[ -f /etc/gift-shop-proxy/secret ] || (umask 077 && openssl rand -hex 32 >/etc/gift-shop-proxy/secret)
SECRET="$(cat /etc/gift-shop-proxy/secret)"

apt_install() {
  if ! apt-get update -qq; then
    echo "apt-get update failed (often a third-party package source blocked from Iran, see the E: lines above)."
    echo "Disable that source in /etc/apt/sources.list.d/ (e.g. mv tailscale.list tailscale.list.off) and run again."
    exit 1
  fi
  apt-get install -y -qq "$@" >/dev/null
}

reachable() {
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://$WORKER/" || true)"
  if [ "$code" != 000 ]; then echo "this server reaches https://$WORKER (HTTP $code)"; else echo "this server can NOT reach https://$WORKER, so the proxy cannot work from here"; fi
}

if command -v nginx >/dev/null; then
  echo "==> nginx"
  CERT="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
  KEY="/etc/letsencrypt/live/$DOMAIN/privkey.pem"
  PROXY="
    client_max_body_size 40m;
    location / {
        proxy_pass https://$WORKER;
        proxy_http_version 1.1;
        proxy_ssl_server_name on;
        proxy_ssl_name $WORKER;
        proxy_set_header Host $WORKER;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Proxy-Secret $SECRET;
        proxy_redirect off;
        proxy_read_timeout 120s;
    }"
  CONF=/etc/nginx/sites-available/gift-shop-proxy
  if [ -f "$CERT" ]; then
    cat >"$CONF" <<NGINX
server {
    listen 80;
    server_name $DOMAIN;
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 301 https://\$host\$request_uri; }
}
server {
    listen 443 ssl;
    server_name $DOMAIN;
    ssl_certificate $CERT;
    ssl_certificate_key $KEY;
$PROXY
}
NGINX
  else
    cat >"$CONF" <<NGINX
server {
    listen 80;
    server_name $DOMAIN;
    location /.well-known/acme-challenge/ { root /var/www/html; }
$PROXY
}
NGINX
  fi
  chmod 600 "$CONF"
  ln -sf "$CONF" /etc/nginx/sites-enabled/gift-shop-proxy
  nginx -t
  systemctl reload nginx
  reachable

  if [ ! -f "$CERT" ]; then
    command -v certbot >/dev/null || apt_install certbot
    mkdir -p /var/www/html
    if certbot certonly --webroot -w /var/www/html -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email >/dev/null 2>&1; then
      echo "HTTPS certificate issued; enabling it"
      exec bash "$0" "$DOMAIN" "$WORKER"
    else
      echo "No HTTPS certificate yet: point $DOMAIN's A record here (DNS only), then run this script again."
    fi
  fi
else
  echo "==> Caddy"
  command -v caddy >/dev/null || apt_install caddy
  cat >/etc/caddy/Caddyfile <<CADDY
$DOMAIN {
	reverse_proxy https://$WORKER {
		header_up Host $WORKER
		header_up X-Forwarded-Host {host}
		header_up X-Forwarded-Proto {scheme}
		header_up X-Proxy-Secret $SECRET
		transport http {
			tls_server_name $WORKER
		}
	}
}
CADDY
  chmod 640 /etc/caddy/Caddyfile
  chgrp caddy /etc/caddy/Caddyfile 2>/dev/null || true
  systemctl enable caddy >/dev/null
  systemctl restart caddy
  reachable
fi
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; fi

code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "https://$DOMAIN/" || true)"
[ "$code" = 200 ] && echo "https://$DOMAIN: ok" || echo "https://$DOMAIN: not ready (HTTP $code). Needs the DNS A record pointing here, ports 80/443 open, and PROXY_SECRET set on the Worker."

cat <<MSG

=========================== set this on the Worker (once) ===========================
  npx wrangler secret put PROXY_SECRET        and paste:
  $SECRET
======================================================================================
MSG
