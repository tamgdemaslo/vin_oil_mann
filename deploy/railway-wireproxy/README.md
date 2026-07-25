# Railway WireGuard proxy

`wireproxy` is a userspace WireGuard client. Railway does not need kernel
WireGuard capabilities or `/dev/net/tun`: the service exposes only private
SOCKS5 (`1080`) and HTTP CONNECT (`8888`) listeners, and routes their traffic
through the WireGuard peer.

The production service receives the complete provider config through the sealed
`WIREPROXY_CONFIG` Railway variable. Never commit that file or value.

Application variables:

```dotenv
OPENAI_PROXY_URL=http://wireguard-proxy.railway.internal:8888
TELEGRAM_HTTP_PROXY_URL=http://wireguard-proxy.railway.internal:8888
TELEGRAM_PROXY_HOST=wireguard-proxy.railway.internal
TELEGRAM_PROXY_PORT=1080
TELEGRAM_PROXY_SOCKS_TYPE=5
```

The proxy has no public domain. Requests to all other integrations bypass it.
