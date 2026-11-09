#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
command -v gh >/dev/null || { echo 'Install GitHub CLI first: https://cli.github.com' >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo 'Run gh auth login, sign in as ordixian, then run this script again.' >&2; exit 1; }
account="$(gh api user --jq .login)"
if [[ "${account,,}" != ordixian ]]; then
  echo "Expected GitHub account ordixian; currently signed in as $account." >&2
  exit 1
fi
if gh repo view ordixian/pipe >/dev/null 2>&1; then
  echo 'ordixian/pipe already exists. Stopping to preserve its contents.' >&2
  exit 1
fi
# Work in a clean directory, excluding all local databases, uploads and credentials.
staging_dir="$(mktemp -d)"
trap 'rm -rf "$staging_dir"' EXIT
for source in src server public .github package.json package-lock.json index.html vite.config.ts tsconfig.json tailwind.config.js postcss.config.js Dockerfile .dockerignore .gitignore README.md setup-pipe-command.sh publish-github.sh; do
  cp -R "$source" "$staging_dir/"
done
git -C "$staging_dir" init -b main
git -C "$staging_dir" add .
git -C "$staging_dir" -c user.name=Ordixian -c user.email=ordixian@users.noreply.github.com commit -m 'Release Pipe with Ordixian UI credit and GitHub setup'
gh repo create ordixian/pipe --public --description 'Local text and file sync between devices. Made by Ordixian.' --source "$staging_dir" --remote origin --push
printf '\nPublished: https://github.com/ordixian/pipe\n'
