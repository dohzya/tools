# Source me: points CMD_* at the cargo-built Rust binaries (debug profile by
# default, `BB_RUST_PROFILE=release` for the release one). Build first:
#   cargo build --locked -p markdown-surgeon-cli
_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
_target="${CARGO_TARGET_DIR:-$_root/target}/${BB_RUST_PROFILE:-debug}"
[ -x "$_target/markdown-surgeon" ] && export CMD_MD="$_target/markdown-surgeon"
[ -x "$_target/recap" ] && export CMD_RECAP="$_target/recap"
# The legacy suite expects the old tool name and `.dz-review/` state dir: the
# wrapper exports CRITIQUE_COMPAT_DZ_REVIEW=1 unless a case sets it (see
# docs/specs/critique.md).
[ -x "$_target/critique" ] && export CMD_DZ_REVIEW="$_root/tests/blackbox/refs/rust/dz-review"
[ -x "$_target/worklog" ] && export CMD_WL="$_target/worklog"
