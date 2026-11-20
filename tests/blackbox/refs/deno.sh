# Source me: points CMD_* at the Deno reference (the checkout's TypeScript code).
_d="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deno"
# mise shims depend on HOME, which the runner overrides: resolve the real binary now.
BB_DENO="$( (mise which deno 2>/dev/null) || command -v deno)"; export BB_DENO
export CMD_MD="$_d/md" CMD_WL="$_d/wl" CMD_RECAP="$_d/recap" CMD_DZ_REVIEW="$_d/dz-review"
