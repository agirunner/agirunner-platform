FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY main.go ./
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/runtime-compat ./main.go

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
RUN addgroup -g 10001 runtime && adduser -D -u 10001 -G runtime runtime
USER runtime
WORKDIR /app
COPY --from=build /out/runtime-compat /app/runtime-compat
EXPOSE 8081
ENTRYPOINT ["/app/runtime-compat"]
