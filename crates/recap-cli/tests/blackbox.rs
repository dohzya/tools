//! Runs the `recap` cases of the language-agnostic black-box suite
//! (`tests/blackbox`) against the binary built by cargo: every case must pass.

use std::path::Path;
use std::process::Command;

fn available(tool: &str) -> bool {
    Command::new(tool).arg("--version").output().is_ok()
}

#[test]
fn recap_black_box_suite() {
    if !available("bash") || !available("jq") || !available("git") {
        eprintln!("SKIPPED: bash, jq and git are needed by tests/blackbox/run.sh");
        return;
    }
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/blackbox");
    let out = Command::new("bash")
        .arg(root.join("run.sh"))
        .args(["--tool", "recap"])
        .env("CMD_RECAP", env!("CARGO_BIN_EXE_recap"))
        .output()
        .expect("run.sh starts");
    let stdout = String::from_utf8_lossy(&out.stdout);
    let failures: Vec<&str> = stdout
        .lines()
        .filter_map(|l| l.strip_prefix("FAIL  "))
        .collect();
    let passed = stdout.lines().filter(|l| l.starts_with("PASS")).count();
    assert!(failures.is_empty(), "failing cases: {failures:#?}");
    // Guards against a runner that silently runs nothing.
    assert!(passed >= 51, "only {passed} cases passed:\n{stdout}");
}
