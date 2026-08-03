FROM golang:1.26-alpine AS build

ARG WIREPROXY_VERSION=v1.1.3
RUN go install github.com/windtf/wireproxy/cmd/wireproxy@${WIREPROXY_VERSION}

FROM alpine:3.21
COPY --from=build /go/bin/wireproxy /usr/local/bin/wireproxy
COPY entrypoint.sh /entrypoint.sh
RUN chmod 0555 /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
