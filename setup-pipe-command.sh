#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bin_dir="$HOME/.local/bin"
mkdir -p "$bin_dir"

# Write the project path as a shell-escaped literal so spaces in folder names work.
printf -v quoted_dir '%q' "$project_dir"
cat > "$bin_dir/pipe" <<EOF
#!/usr/bin/env bash
set -euo pipefail
cd $quoted_dir
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo 'Pipe needs Node.js 20 or newer and npm installed.' >&2
  exit 1
fi
if [[ ! -x node_modules/.bin/vite || ! -x node_modules/.bin/tsx ]]; then
  echo 'Installing Pipe dependencies (first run only)...'
  if [[ -f package-lock.json ]]; then npm ci; else npm install; fi
fi
exec npm start
EOF
chmod +x "$bin_dir/pipe"

case ":$PATH:" in
  *":$bin_dir:"*) ;;
  *)
    case "${SHELL##*/}" in
      zsh) profile="$HOME/.zshrc" ;;
      *) profile="$HOME/.bashrc" ;;
    esac
    touch "$profile"
    if ! grep -Fq 'export PATH="$HOME/.local/bin:$PATH"' "$profile"; then
      printf '\n# Pipe launcher\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$profile"
    fi
    echo "Added ~/.local/bin to $profile. Open a new terminal before typing pipe."
    ;;
esac

echo "Pipe command installed. Type 'pipe' to start, and press Ctrl+C to stop."
