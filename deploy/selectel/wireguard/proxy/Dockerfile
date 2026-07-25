FROM alpine:3.21

RUN apk add --no-cache 3proxy

COPY 3proxy.cfg /etc/3proxy/3proxy.cfg

USER nobody
CMD ["3proxy", "/etc/3proxy/3proxy.cfg"]
