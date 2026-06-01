# Build context is the repo root (.). Dockerfile: services/alertd/Dockerfile.
# We build with GOWORK=off and cd into the module to avoid go.work pulling in
# sibling modules.

FROM golang:1.26-alpine AS build
ENV GOWORK=off CGO_ENABLED=0 GOOS=linux
WORKDIR /src

# Cache module downloads using just the alertd module's go.mod/go.sum.
COPY services/alertd/go.mod services/alertd/go.sum* ./services/alertd/
WORKDIR /src/services/alertd
RUN go mod download

# Copy the alertd source and build a static binary.
COPY services/alertd/ ./
RUN go build -trimpath -ldflags="-s -w" -o /out/alertd ./cmd/alertd

FROM gcr.io/distroless/static:nonroot
COPY --from=build /out/alertd /alertd
EXPOSE 8081
USER nonroot:nonroot
ENTRYPOINT ["/alertd"]
