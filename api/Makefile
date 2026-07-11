# Go parameters
GOBIN = go
GOFMT = gofmt
GOLINT = golangci-lint
GOTEST = go test
GOBUILD = go build
GOCLEAN = go clean

# Binary name
BINARY_NAME = 53aihub
BINARY_UNIX = $(BINARY_NAME)_unix

# Output directory
BIN_DIR = bin

# Build flags
BUILD_FLAGS = -v

.PHONY: all build clean test lint fmt static-build-saas static-build-local migrate-tool-static

all: clean fmt lint test build

sbuild:
	CGO_ENABLED=0 $(GOBUILD) $(BUILD_FLAGS) -o $(BIN_DIR)/$(BINARY_NAME) -v .
test:
	$(GOTEST) -v ./...

clean:
	$(GOCLEAN)
	rm -f $(BIN_DIR)/*

lint:
	$(GOLINT) run

fmt:
	$(GOFMT) -w .

# Cross compilation
build-linux:
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 $(GOBUILD) $(BUILD_FLAGS) -o $(BIN_DIR)/$(BINARY_UNIX) -v ./...

# Static build with no glibc dependency
swagger-init:
	swag init -g router/main.go --output docs/

static-build: swagger-init
	CGO_ENABLED=0 $(GOBUILD) -trimpath $(BUILD_FLAGS) -tags saas -o $(BIN_DIR)/$(BINARY_NAME) -a .

static-build-local: swagger-init
	CGO_ENABLED=0 $(GOBUILD) -trimpath $(BUILD_FLAGS) -o $(BIN_DIR)/$(BINARY_NAME) -a .

# Static build for migrate tool (no glibc dependency)
migrate-tool-static:
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 $(GOBUILD) -trimpath -ldflags '-s -w' -o ./migrate_tool ./cmd/migrate_tool
