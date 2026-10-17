#!/usr/bin/env bash
# scripts/e2e/install-maestro.sh — the Maestro CLI without Homebrew or curl | bash: the pinned GitHub
# release zip, checked against its SHA-256 (the release's checksums_sha256.txt), unzipped into
# <repo>/tools/maestro (git-ignored). Idempotent: an install of the pinned version exits at once.
# The download is cached outside the repo (MAESTRO_CACHE_DIR), so worktrees and CI caches share it.
# Changing the pin: the e2e-maestro skill's maestro-setup reference, in one Gate-Change commit.
set -euo pipefail

MAESTRO_VERSION="2.10.0"
MAESTRO_SHA256="29b675e10cc12080e445e9bfb2e2b4e4dfb9c0f2e30d5884120d258b5e1cd991"
URL="https://github.com/mobile-dev-inc/Maestro/releases/download/cli-${MAESTRO_VERSION}/maestro.zip"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEST="${REPO_ROOT}/tools/maestro"
if [[ "$(uname)" == "Darwin" ]]; then
  DEFAULT_CACHE="${HOME}/Library/Caches/maestro-cli"
else
  DEFAULT_CACHE="${XDG_CACHE_HOME:-${HOME}/.cache}/maestro-cli"
fi
CACHE_DIR="${MAESTRO_CACHE_DIR:-${DEFAULT_CACHE}}"
ZIP="${CACHE_DIR}/maestro-${MAESTRO_VERSION}.zip"

if [[ -x "${DEST}/bin/maestro" && "$(cat "${DEST}/.version" 2>/dev/null)" == "${MAESTRO_VERSION}" ]]; then
  echo "maestro ${MAESTRO_VERSION} already installed in ${DEST}"
  exit 0
fi

mkdir -p "${CACHE_DIR}"
if [[ ! -f "${ZIP}" ]]; then
  curl -fsSL --retry 3 -o "${ZIP}.part" "${URL}"
  mv "${ZIP}.part" "${ZIP}"
fi
if ! echo "${MAESTRO_SHA256}  ${ZIP}" | shasum -a 256 -c - >/dev/null; then
  echo "SHA-256 mismatch for ${ZIP}; deleting it. Never change the pin to match a download: re-verify the release." >&2
  rm -f "${ZIP}"
  exit 1
fi

rm -rf "${DEST}"
mkdir -p "$(dirname "${DEST}")"
unzip -q "${ZIP}" -d "$(dirname "${DEST}")"
echo "${MAESTRO_VERSION}" > "${DEST}/.version"
# No analytics, analysis prompt or update check, even for --version; Java 17 as the runner picks it.
export MAESTRO_CLI_NO_ANALYTICS=true MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true MAESTRO_DISABLE_UPDATE_CHECK=true
if [[ -z "${JAVA_HOME:-}" ]]; then
  JAVA_HOME="$(/usr/libexec/java_home -v 17 2>/dev/null || echo "/Applications/Android Studio.app/Contents/jbr/Contents/Home")"
  export JAVA_HOME
fi
"${DEST}/bin/maestro" --version
