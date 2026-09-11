#!/usr/bin/env bash
set -euo pipefail

tag="${RELEASE_TAG:?Select a package release tag, such as pi-libtui/v0.3.8}"
if [[ ! "$tag" =~ ^(pi-[a-z0-9-]+)/v([0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.-]+)?)$ ]]; then
  echo "invalid package release tag: $tag" >&2
  exit 1
fi
package="harnesses/pi/agent/packages/${BASH_REMATCH[1]}"
version="${BASH_REMATCH[2]}"
bun -e 'const [directory, version] = process.argv.slice(1); const manifest = await Bun.file(directory + "/package.json").json(); if (manifest.version !== version) throw new Error(`tag version ${version} does not match ${manifest.name}@${manifest.version}`);' "$package" "$version"
exec just pi-publish "$package"
