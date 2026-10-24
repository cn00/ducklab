#!/bin/bash
set -euo pipefail

# Clear previous builds
# rm -rf ./dist
mkdir -p ./dist

# Targets to build against
targets=(
    "win32-x64" # DuckDB appears to not have ia32 nor arm64 builds for Windows
    "linux-x64"
    "linux-arm64"
    "darwin-x64"
    "darwin-arm64"
)

cp -rf ./node_modules/zeromq/build ./
package_name=$(node -p "require('./package.json').name")
package_version=$(node -p "require('./package.json').version")

for p in "${targets[@]}"; do
    platform=$(echo $p | cut -d "-" -f 1)
    arch=$(echo $p | cut -d "-" -f 2)
 
    # # Package extension
    vsix_path="dist/${package_name}-${p}-${package_version}.vsix"
    npx vsce package --no-dependencies --target "$p" --out "$vsix_path" --baseContentUrl https://raw.githubusercontent.com/ducklake-hq/ducklab/refs/heads/main/vs-extension/ --baseImagesUrl https://raw.githubusercontent.com/ducklake-hq/ducklab/refs/heads/main/vs-extension/

    rm -rf dist/extracted/
    unzip "$vsix_path" -d dist/extracted/
    mkdir -p dist/extracted/extension/node_modules/@duckdb/node-bindings-$platform-$arch
    cp -rL node_modules/@duckdb/node-bindings-$platform-$arch dist/extracted/extension/node_modules/@duckdb/
    case "$platform" in
        darwin)
            rm -rf dist/extracted/extension/build/linux dist/extracted/extension/build/win32
            ;;
        linux)
            rm -rf dist/extracted/extension/build/darwin dist/extracted/extension/build/win32
            ;;
        win32)
            rm -rf dist/extracted/extension/build/darwin dist/extracted/extension/build/linux
            ;;
        *)
            echo "Unsupported platform: $platform" >&2
            exit 1
            ;;
    esac
    rm -- "$vsix_path"
    cd dist/extracted/
    zip -r "../../$vsix_path" ./
    cd ../../
    unzip -p "$vsix_path" "extension/node_modules/@duckdb/node-bindings-$p/duckdb.node" > /dev/null

done
