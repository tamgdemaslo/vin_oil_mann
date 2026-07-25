#!/bin/sh
set -eu

: "${WIREPROXY_CONFIG:?WIREPROXY_CONFIG is required}"

config_path="/tmp/wireproxy.conf"
printf '%s\n' "$WIREPROXY_CONFIG" > "$config_path"

cat >> "$config_path" <<EOF

[Socks5]
BindAddress = [::]:1080

[http]
BindAddress = [::]:8888
EOF

exec /usr/local/bin/wireproxy -c "$config_path" -i "[::]:9090"
