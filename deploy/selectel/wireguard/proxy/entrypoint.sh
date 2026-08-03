#!/bin/sh
set -eu

source_config="/config/wg_confs/wg0.conf"
test -s "$source_config"

# `PostUp` / `PostDown` are kernel wg-quick commands. The WireGuard client
# here is userspace-only, so it intentionally consumes the actual peer config
# while omitting those unsupported directives.
config_path="/tmp/wireproxy.conf"
sed '/^[[:space:]]*Post\(Up\|Down\)[[:space:]]*=/d' "$source_config" > "$config_path"

cat >> "$config_path" <<'EOF'

[Socks5]
BindAddress = 0.0.0.0:1080

[http]
BindAddress = 0.0.0.0:8888
EOF

exec /usr/local/bin/wireproxy -c "$config_path" -i 0.0.0.0:9090
