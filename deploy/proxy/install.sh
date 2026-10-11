#!/usr/bin/env bash
# Puts the site on a server in Iran as a reverse proxy to the Cloudflare Worker (Cloudflare itself is
# blocked there): visitors open https://<domain> on this server, which forwards to <worker>.workers.dev.
#   sudo bash install.sh kadochie.ir gift-shop.m-cyber-warrior.workers.dev [3030]
# Uses nginx when it is installed (HTTPS via certbot), otherwise Caddy.
# With a third argument (a port, e.g. 3030) the site is also served over plain HTTP on that port,
# on any address (http://SERVER_IP:3030): for a CDN that pulls from the server over HTTP, or for
# visitors who can't use HTTPS. A CDN's X-Forwarded-Proto: https is passed on as such.
# Prints PROXY_SECRET: set the same value on the Worker (npx wrangler secret put PROXY_SECRET)
# BEFORE pointing the domain here. Run again any time (e.g. after the DNS change, for HTTPS); the
# secret is kept.
set -euo pipefail

DOMAIN="${1:-}"
WORKER="${2:-}"
HTTP_PORT="${3:-}"
if [ -n "$HTTP_PORT" ] && ! [[ "$HTTP_PORT" =~ ^[0-9]+$ && "$HTTP_PORT" -ge 1024 && "$HTTP_PORT" -le 65535 && "$HTTP_PORT" != 443 ]]; then
  echo "the plain-http port must be a number between 1024 and 65535, e.g. 3030"; exit 1
fi
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
  # Resolve the Worker's host to IPv4 only: on servers without IPv6, nginx would otherwise try
  # Cloudflare's IPv6 addresses first and answer 502 when both attempts land on them.
  RESOLVER="$(awk '/^nameserver/ && $2 !~ /:/ {print $2; exit}' /etc/resolv.conf)"
  RESOLVER="${RESOLVER:-127.0.0.53}"
  PROXY="
    resolver $RESOLVER ipv6=off valid=300s;
    resolver_timeout 10s;
    set \$worker_host $WORKER;
    client_max_body_size 40m;
    client_body_timeout 300s;
    location / {
        proxy_pass https://\$worker_host;
        proxy_http_version 1.1;
        proxy_ssl_server_name on;
        proxy_ssl_name $WORKER;
        proxy_set_header Host $WORKER;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-Proto \$gs_proto;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Proxy-Secret $SECRET;
        proxy_redirect off;
        proxy_connect_timeout 30s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
        proxy_next_upstream error timeout;
        proxy_next_upstream_tries 2;
    }"
  # The plain-http port keeps the port in the address the Worker sees (links and redirects stay on it).
  PROXY_HTTP="${PROXY/X-Forwarded-Host \$host;/X-Forwarded-Host \$http_host;}"
  HTTP_SERVER=""
  if [ -n "$HTTP_PORT" ]; then
    HTTP_SERVER="
server {
    listen $HTTP_PORT default_server;
    server_name _;
$PROXY_HTTP
}"
  fi
  CONF=/etc/nginx/sites-available/gift-shop-proxy
  # Behind a CDN (e.g. ArvanCloud with the proxy on) the CDN may reach this server over plain HTTP:
  # pass on the protocol the visitor used (the CDN's X-Forwarded-Proto), not this hop's, or the site
  # would think it is on http:// and keep redirecting to https://.
  PROTO_MAP='map $http_x_forwarded_proto $gs_proto { default $scheme; https https; http http; }'
  if [ -f "$CERT" ]; then
    cat >"$CONF" <<NGINX
$PROTO_MAP
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
    # Certificate renewals still work when a CDN forwards the check over HTTPS.
    location /.well-known/acme-challenge/ { root /var/www/html; }
$PROXY
}
$HTTP_SERVER
NGINX
  else
    cat >"$CONF" <<NGINX
$PROTO_MAP
server {
    listen 80;
    server_name $DOMAIN;
    location /.well-known/acme-challenge/ { root /var/www/html; }
$PROXY
}
$HTTP_SERVER
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
			# HTTP/1.1 to Cloudflare: HTTP/2 streams were reset mid-upload ("PROTOCOL_ERROR"), failing photo uploads
			versions 1.1
			dial_timeout 30s
			response_header_timeout 300s
		}
	}
}
CADDY
  if [ -n "$HTTP_PORT" ]; then
    cat >>/etc/caddy/Caddyfile <<CADDY

http://:$HTTP_PORT {
	# The visitor's protocol: https when a CDN in front says so, http otherwise.
	map {http.request.header.X-Forwarded-Proto} {gs_proto} {
		https https
		default http
	}
	reverse_proxy https://$WORKER {
		header_up Host $WORKER
		header_up X-Forwarded-Host {hostport}
		header_up X-Forwarded-Proto {gs_proto}
		header_up X-Proxy-Secret $SECRET
		transport http {
			tls_server_name $WORKER
			versions 1.1
			dial_timeout 30s
			response_header_timeout 300s
		}
	}
}
CADDY
  fi
  chmod 640 /etc/caddy/Caddyfile
  chgrp caddy /etc/caddy/Caddyfile 2>/dev/null || true
  systemctl enable caddy >/dev/null
  systemctl restart caddy
  reachable
fi
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
  [ -n "$HTTP_PORT" ] && ufw allow "$HTTP_PORT/tcp" >/dev/null
fi
if [ -n "$HTTP_PORT" ]; then
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "http://127.0.0.1:$HTTP_PORT/" || true)"
  echo "plain http on port $HTTP_PORT: HTTP $code (open http://<this server's IP>:$HTTP_PORT; also open the port in your provider's firewall)"
fi

code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "https://$DOMAIN/" || true)"
[ "$code" = 200 ] && echo "https://$DOMAIN: ok" || echo "https://$DOMAIN: not ready (HTTP $code). Needs the DNS A record pointing here, ports 80/443 open, and PROXY_SECRET set on the Worker."

cat <<MSG

=========================== set this on the Worker (once) ===========================
  npx wrangler secret put PROXY_SECRET        and paste:
  $SECRET
======================================================================================
MSG
