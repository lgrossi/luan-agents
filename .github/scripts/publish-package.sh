#!/usr/bin/env bash
set -euo pipefail

tag="${RELEASE_TAG:?Select a package release tag, such as @luan.sh/pi-libtui@0.3.8}"
if [[ ! "$tag" =~ ^(@luan\.sh/(pi-[a-z0-9-]+))@([0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.-]+)?)$ ]]; then
  echo "invalid package release tag: $tag" >&2
  exit 1
fi
name="${BASH_REMATCH[1]}"
package="harnesses/pi/agent/packages/${BASH_REMATCH[2]}"
version="${BASH_REMATCH[3]}"
bun -e 'const [directory, name, version] = process.argv.slice(1); const manifest = await Bun.file(directory + "/package.json").json(); if (manifest.name !== name || manifest.version !== version) throw new Error(`tag ${name}@${version} does not match ${manifest.name}@${manifest.version}`);' "$package" "$name" "$version"
case "${RELEASE_ACTION:-publish}" in
  pack) exec just pi-pack "$package" ;;
  publish) exec just pi-publish "$package" ;;
  *) echo "invalid release action" >&2; exit 1 ;;
esac
