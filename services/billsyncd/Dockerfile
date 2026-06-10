# Build context is the repo root (.). Dockerfile: services/billsyncd/Dockerfile.
# We build with GOWORK=off and cd into the module to avoid go.work pulling in
# sibling modules.

FROM golang:1.26-alpine AS build
ENV GOWORK=off CGO_ENABLED=0 GOOS=linux
WORKDIR /src

# Cache module downloads using just the billsyncd module's go.mod/go.sum.
COPY services/billsyncd/go.mod services/billsyncd/go.sum* ./services/billsyncd/
WORKDIR /src/services/billsyncd
RUN go mod download

# Copy the billsyncd source and build a static binary.
COPY services/billsyncd/ ./
RUN go build -trimpath -ldflags="-s -w" -o /out/billsyncd ./cmd/billsyncd

FROM gcr.io/distroless/static:nonroot
COPY --from=build /out/billsyncd /billsyncd
EXPOSE 8082
USER nonroot:nonroot
ENTRYPOINT ["/billsyncd"]
