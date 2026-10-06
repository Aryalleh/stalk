#!/usr/bin/env bash
# Puts the site on a server in Iran as a reverse proxy to the Cloudflare Worker (Cloudflare itself is
# blocked there): visitors open https://<domain> on this server, which forwards to <worker>.workers.dev.
#   sudo bash install.sh kadochie.ir gift-shop.m-cyber-warrior.workers.dev
# Prints PROXY_SECRET: set the same value on the Worker (npx wrangler secret put PROXY_SECRET)
# BEFORE pointing the domain here. Run again to show it; the secret is kept.
set -euo pipefail

DOMAIN="${1:-}"
WORKER="${2:-}"
if [ -z "$DOMAIN" ] || [ -z "$WORKER" ]; then echo "usage: sudo bash $0 <domain> <worker host, e.g. gift-shop.NAME.workers.dev>"; exit 1; fi
if [ "$(id -u)" != 0 ]; then echo "run as root (sudo)"; exit 1; fi
WORKER="${WORKER#https://}"; WORKER="${WORKER%%/*}"

echo "==> Caddy"
command -v caddy >/dev/null || { apt-get update -qq && apt-get install -y -qq caddy >/dev/null; }

if [ ! -f /etc/caddy/proxy-secret ]; then
  umask 077
  openssl rand -hex 32 >/etc/caddy/proxy-secret
fi
SECRET="$(cat /etc/caddy/proxy-secret)"

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
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; fi

echo "==> checking"
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://$WORKER/" || true)"
[ "$code" != 000 ] && echo "this server reaches https://$WORKER (HTTP $code)" || echo "this server can NOT reach https://$WORKER — the proxy cannot work from here"
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "https://$DOMAIN/" || true)"
[ "$code" = 200 ] && echo "https://$DOMAIN: ok" || echo "https://$DOMAIN: not ready (HTTP $code) — DNS A record to this server, ports 80/443 open, PROXY_SECRET set on the Worker; logs: journalctl -u caddy -n 50"

cat <<MSG

=========================== set this on the Worker (once) ===========================
  npx wrangler secret put PROXY_SECRET        and paste:
  $SECRET
======================================================================================
MSG
