#!/usr/bin/env bash
# scripts/build/collect-artifacts.sh: copies what a local release build produced into dist/.
# It only reads the generated native folders.
set -euo pipefail
mkdir -p dist
cp android/app/build/outputs/bundle/release/app-release.aab dist/
plutil -extract CFBundleIdentifier raw ios/Tasks/Info.plist > dist/bundle-id.txt
