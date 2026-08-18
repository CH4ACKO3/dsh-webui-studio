#!/bin/sh
set -eu

: "${DSH_HOME:?DSH_HOME is required}"
: "${STUDIO_PORT:?STUDIO_PORT is required}"

mkdir -p "$DSH_HOME" "${NPM_CONFIG_CACHE:-/var/cache/npm}" "${npm_config_store_dir:-/var/cache/pnpm}"
dsh plugin --profile web add link:/workspace --allow-build=dsh-harmony
exec dsh web --port "$STUDIO_PORT"
