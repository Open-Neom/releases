#!/usr/bin/env bash
# Centralized Open Neom preflight secret check for client source & web builds.
# Fails without ever printing secret contents when client assets contain keys.

set -euo pipefail

MODE="${1:-all}"
PROJECT_DIR="${2:-$PWD}"
FAILURES=0

fail_path() {
  printf 'ERROR: client credential risk: %s\n' "$1" >&2
  FAILURES=$((FAILURES + 1))
}

scan_patterns() {
  local scan_root="$1"
  [[ -d "$scan_root" ]] || return 0

  local matches=""
  if command -v rg >/dev/null 2>&1; then
    matches="$(rg -l --hidden \
      -g '!**/.git/**' \
      -g '!**/node_modules/**' \
      -g '!**/.dart_tool/**' \
      -e 'service[_-]account\.json' \
      -e '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----' \
      -e '"type"[[:space:]]*:[[:space:]]*"service_account"' \
      -e '"private_key"[[:space:]]*:' \
      "$scan_root" 2>/dev/null || true)"
  else
    matches="$(find "$scan_root" -type f -print0 \
      | xargs -0 grep -IlE -- \
        'service[_-]account\.json|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|"type"[[:space:]]*:[[:space:]]*"service_account"|"private_key"[[:space:]]*:' \
        2>/dev/null || true)"
  fi

  if [[ -n "$matches" ]]; then
    while IFS= read -r m; do
      [[ -n "$m" ]] && fail_path "$m"
    done <<< "$matches"
  fi
}

check_source() {
  local forbidden="$PROJECT_DIR/assets/service_account.json"
  if [[ -f "$forbidden" ]]; then
    fail_path "$forbidden exists"
  fi
  if git -C "$PROJECT_DIR" ls-files --error-unmatch assets/service_account.json >/dev/null 2>&1; then
    fail_path "assets/service_account.json is tracked by Git"
  fi
  scan_patterns "$PROJECT_DIR/assets"
}

check_build() {
  local build_dir="$PROJECT_DIR/build/web"
  scan_patterns "$build_dir"
  for f in \
    "$build_dir/assets/assets/service_account.json" \
    "$build_dir/assets/service_account.json"; do
    [[ -f "$f" ]] && fail_path "$f exists"
  done
}

case "$MODE" in
  source) check_source ;;
  build)  check_build ;;
  all)    check_source; check_build ;;
  *)      printf 'Usage: %s [source|build|all] [project_dir]\n' "$0" >&2; exit 2 ;;
esac

if (( FAILURES > 0 )); then
  printf 'FAILED: %d client credential risk(s) found. No secret contents were printed.\n' "$FAILURES" >&2
  exit 1
fi

printf 'OK: no client credential patterns found (%s).\n' "$MODE"
