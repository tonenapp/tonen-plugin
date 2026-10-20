#!/usr/bin/env bash
# Copies the plugin a Tonen serves (tonen.app by default) into this
# repository: the marketplace it lists, its zip checked against the sha256
# there, then unpacked over everything here but .git, .github and scripts.
# Tonen is the source (tonenapp/tonen, claude-plugin/): nothing else here is
# edited by hand. While that Tonen serves no plugin, it changes nothing.
set -euo pipefail

origin="${1:-https://tonen.app}"
repo="${GITHUB_REPOSITORY:-tonenapp/tonen-plugin}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

status="$(curl -sS -o "$work/marketplace.json" -w '%{http_code}' "$origin/claude/marketplace.json")"
if [ "$status" = 404 ]; then
  echo "$origin serves no plugin yet: nothing to copy."
  exit 0
fi
if [ "$status" != 200 ]; then
  echo "$origin/claude/marketplace.json answered $status" >&2
  exit 1
fi

entry='.plugins[] | select(.name == "tonen")'
url="$(jq -er "$entry | .source.url" "$work/marketplace.json")"
sha="$(jq -er "$entry | .source.sha256" "$work/marketplace.json")"
curl -fsS -o "$work/tonen.zip" "$url"
echo "$sha  $work/tonen.zip" | shasum -a 256 -c --quiet -

unzip -q "$work/tonen.zip" -d "$work/plugin"
if [ "$(jq -r .name "$work/plugin/.claude-plugin/plugin.json")" != tonen ]; then
  echo "$url isn't Tonen's plugin" >&2
  exit 1
fi

# This repository is the marketplace too, listing the plugin at its root.
jq --arg repo "https://github.com/$repo" \
  "{name, description, owner, plugins: [$entry | del(.source) + {source: \"./\", repository: \$repo}]}" \
  "$work/marketplace.json" > "$work/plugin/.claude-plugin/marketplace.json"

find . -mindepth 1 -maxdepth 1 ! -name .git ! -name .github ! -name scripts -exec rm -rf {} +
cp -R "$work/plugin/." .
echo "Copied Tonen's plugin $(jq -r .version .claude-plugin/plugin.json) from $origin."
