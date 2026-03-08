FROM golang:1.24-alpine AS builder
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download 2>/dev/null || true
COPY . .
RUN CGO_ENABLED=0 go build -o /container-manager ./cmd/container-manager

FROM alpine:3.21
RUN apk add --no-cache ca-certificates
COPY --from=builder /container-manager /usr/local/bin/container-manager
ENTRYPOINT ["container-manager"]
