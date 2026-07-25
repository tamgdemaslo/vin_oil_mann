# WireGuard egress for Selectel

This directory is mounted into the userspace `wireguard-proxy` service only
when the VPN compose override is enabled. The main application keeps its usual
network. The proxy opens two private ports through the WireGuard peer:

- `wireguard-proxy:1080` — SOCKS5 for the Telegram user session (GramJS);
- `wireguard-proxy:8888` — HTTP CONNECT for every application OpenAI SDK client.

The proxy has no host port, so it is unavailable from the Internet. It uses
`wireproxy`, a userspace WireGuard implementation: no host interface, TUN
device, or Docker network capability is required. All other integrations
(MoySklad, TRONK, AQSI, ROSSKO, T-Bank and so on) keep their direct outgoing
connection.

## One-time server setup

1. Obtain a **client** WireGuard configuration from the VPN provider. The peer
   must permit a full tunnel (`0.0.0.0/0`). Keep its `Endpoint` as an IP, not a
   hostname.
2. On the Selectel server, create the private configuration and restrict it:

   ```bash
   cd /opt/vin-oil-mann
   mkdir -p deploy/selectel/wireguard/wg_confs
   cp deploy/selectel/wireguard/wg0.conf.template deploy/selectel/wireguard/wg_confs/wg0.conf
   chmod 600 deploy/selectel/wireguard/wg_confs/wg0.conf
   ```

   Replace the placeholders in `wg0.conf`. Do not commit or send the private
   key. The template's `PostUp` / `PostDown` rules are required: they prevent
   the application from falling back to the server's public IP if the tunnel
   goes down.

## Start and verify

Run the production stack with both compose files:

```bash
docker compose --env-file .env.production \
  -f docker-compose.selectel.yml \
  -f docker-compose.selectel.wireguard.yml up -d --build --remove-orphans

docker compose --env-file .env.production \
  -f docker-compose.selectel.yml \
  -f docker-compose.selectel.wireguard.yml exec wireguard wg show
```

`wg show` must display a recent `latest handshake` and transfer counters. Check
the public egress address from the OpenAI proxy without printing secrets:

```bash
docker compose --env-file .env.production \
  -f docker-compose.selectel.yml \
  -f docker-compose.selectel.wireguard.yml exec wireguard-proxy \
  wget -qO- -e use_proxy=yes -e http_proxy=http://127.0.0.1:8888 https://api.ipify.org
```

The returned IP should be the VPN exit address, not the Selectel server IP. The
same check from `app` without the proxy should show the Selectel address.

The GitHub Actions deployment detects `wg0.conf` and automatically switches to
the WireGuard overlay. Until that private file exists, it continues to deploy
the base stack without VPN.

## Rollback

Stop the VPN overlay by deploying the base file alone. The WireGuard config is
left on the server and remains excluded from source synchronisation.
