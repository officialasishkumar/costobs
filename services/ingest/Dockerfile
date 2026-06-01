# Build context is the repo root (.). Dockerfile: services/ingest/Dockerfile.
# We build with GOWORK=off and cd into the module to avoid go.work pulling in
# sibling modules.

FROM golang:1.26-alpine AS build
ENV GOWORK=off CGO_ENABLED=0 GOOS=linux
WORKDIR /src

# Cache module downloads using just the ingest module's go.mod/go.sum.
COPY services/ingest/go.mod services/ingest/go.sum* ./services/ingest/
WORKDIR /src/services/ingest
RUN go mod download

# Copy the ingest source and build a static binary.
COPY services/ingest/ ./
RUN go build -trimpath -ldflags="-s -w" -o /out/ingest ./cmd/ingest

FROM gcr.io/distroless/static:nonroot
COPY --from=build /out/ingest /ingest
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/ingest"]
CMD ["serve"]
