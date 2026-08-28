#!/bin/sh
set -eu

APP_ROOT="${APP_ROOT:-$(pwd)}"
WIREPROXY_PID=""
APP_PID=""

stop_children() {
  if [ -n "$APP_PID" ]; then
    kill -TERM "$APP_PID" 2>/dev/null || true
  fi
  if [ -n "$WIREPROXY_PID" ]; then
    kill -TERM "$WIREPROXY_PID" 2>/dev/null || true
  fi
}

trap stop_children INT TERM

start_wireproxy() {
  if [ -z "${WIREPROXY_CONFIG:-}" ]; then
    return
  fi

  wireproxy_required="${WIREPROXY_REQUIRED:-true}"
  case "$wireproxy_required" in
    true|false) ;;
    *)
      echo "WIREPROXY_REQUIRED must be true or false" >&2
      exit 1
      ;;
  esac

  # Timeweb stores the original WireGuard profile as a multiline secret. Only
  # standard WireGuard sections are accepted so a supplied profile cannot open
  # an additional public listener inside the application container.
  if ! printf '%s\n' "$WIREPROXY_CONFIG" | awk '
    /^[[:space:]]*\[/ {
      section = tolower($0)
      gsub(/[[:space:]]/, "", section)
      if (section != "[interface]" && section != "[peer]") exit 1
    }
  '; then
    echo "WIREPROXY_CONFIG may contain only [Interface] and [Peer] sections" >&2
    exit 1
  fi

  local_proxy_url="http://127.0.0.1:8888"
  if [ -n "${OPENAI_PROXY_URL:-}" ] && [ "$OPENAI_PROXY_URL" != "$local_proxy_url" ]; then
    echo "OPENAI_PROXY_URL must be $local_proxy_url when WIREPROXY_CONFIG is set" >&2
    exit 1
  fi

  config_path="/tmp/timeweb-wireproxy.conf"
  umask 077
  {
    printf '%s\n\n' "$WIREPROXY_CONFIG"
    printf '%s\n' '[http]' 'BindAddress = 127.0.0.1:8888'
  } > "$config_path"

  # The application needs only the loopback proxy URL. Do not pass the private
  # WireGuard key onward to Node or any subprocess started by the application.
  unset WIREPROXY_CONFIG
  export OPENAI_PROXY_URL="$local_proxy_url"

  if ! /usr/local/bin/wireproxy -c "$config_path" -n >/dev/null; then
    echo "WireGuard proxy configuration is invalid" >&2
    exit 1
  fi

  /usr/local/bin/wireproxy -c "$config_path" -s &
  WIREPROXY_PID=$!

  # A 401 without an API key proves that HTTPS reached OpenAI through the
  # tunnel. A regional 403 or an unavailable tunnel fails the container closed.
  attempt=1
  while [ "$attempt" -le 6 ]; do
    if ! kill -0 "$WIREPROXY_PID" 2>/dev/null; then
      WIREPROXY_PID=""
      if [ "$wireproxy_required" = "true" ]; then
        echo "WireGuard proxy stopped during startup" >&2
        exit 1
      fi
      echo "WireGuard proxy stopped during startup; application will start with OpenAI unavailable" >&2
      return
    fi

    openai_status="$(curl --silent --show-error --output /dev/null \
      --write-out '%{http_code}' \
      --proxy "$local_proxy_url" \
      --connect-timeout 4 \
      --max-time 8 \
      https://api.openai.com/v1/models || true)"

    if [ "$openai_status" = "401" ]; then
      echo "OpenAI WireGuard proxy is ready"
      return
    fi
    if [ "$openai_status" = "403" ]; then
      if [ "$wireproxy_required" = "true" ]; then
        echo "OpenAI rejected the WireGuard exit region (HTTP 403)" >&2
        exit 1
      fi
      echo "OpenAI rejected the WireGuard exit region (HTTP 403); application will start with OpenAI unavailable" >&2
      return
    fi

    attempt=$((attempt + 1))
    sleep 1
  done

  if [ "$wireproxy_required" = "true" ]; then
    echo "OpenAI WireGuard proxy did not become ready" >&2
    exit 1
  fi
  echo "OpenAI WireGuard proxy did not become ready; application will start with OpenAI unavailable" >&2
}

# App Platform builds the repository directly, rather than through the former
# image-publishing workflow. The newest migration bundled with that build is
# used for readiness checks unless an operator explicitly overrides it.
if { [ -z "${APP_EXPECTED_MIGRATION:-}" ] || [ "${APP_EXPECTED_MIGRATION}" = "unknown" ]; } \
  && [ -d "$APP_ROOT/prisma/migrations" ]; then
  APP_EXPECTED_MIGRATION="$(find "$APP_ROOT/prisma/migrations" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | sort | tail -n 1)"
  export APP_EXPECTED_MIGRATION
fi

# Docker copies the standalone output into /app, while Timeweb's Node builder
# keeps it under .next/standalone. Support both layouts and force a reachable
# listen address even when the platform injects its container hostname.
export HOSTNAME=0.0.0.0

if [ -f "$APP_ROOT/server.js" ]; then
  SERVER_ROOT="$APP_ROOT"
else
  STANDALONE_ROOT="$APP_ROOT/.next/standalone"
  if [ ! -f "$STANDALONE_ROOT/server.js" ]; then
    echo "Standalone server not found: $STANDALONE_ROOT/server.js" >&2
    exit 1
  fi

  if [ ! -d "$STANDALONE_ROOT/.next/static" ]; then
    echo "Standalone static assets not found: $STANDALONE_ROOT/.next/static" >&2
    exit 1
  fi

  SERVER_ROOT="$STANDALONE_ROOT"
fi

start_wireproxy
cd "$SERVER_ROOT"

if [ -z "$WIREPROXY_PID" ]; then
  exec node server.js
fi

node server.js &
APP_PID=$!
app_status=0
wait "$APP_PID" || app_status=$?
APP_PID=""

kill -TERM "$WIREPROXY_PID" 2>/dev/null || true
wait "$WIREPROXY_PID" 2>/dev/null || true
WIREPROXY_PID=""
exit "$app_status"
