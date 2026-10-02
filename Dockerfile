# syntax=docker/dockerfile:1
# Контекст сборки — корень manul-forest/:
#   docker build -t manul-game -f Dockerfile .
FROM golang:1.26-bookworm AS builder

WORKDIR /src/server
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/manul .

FROM scratch

COPY --from=builder /out/manul /manul
COPY index.html style.css main.js preview.html /www/
COPY assets /www/assets
COPY admin /www/admin

ENV PORT=8080 \
    DATA_DIR=/data \
    WEBROOT=/www

VOLUME /data
EXPOSE 8080
USER 65532:65532

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
    CMD ["/manul", "-healthcheck"]

ENTRYPOINT ["/manul"]
