//! End-to-end checks of `worklog_cli::run` on a temporary directory, with the
//! real ports. The black-box suite covers the output contract in depth.

use worklog_cli::{Io, run, system_ports};

fn wl(dir: &std::path::Path, args: &[&str]) -> (i32, String, String) {
    let (mut out, mut err) = (Vec::new(), Vec::new());
    let mut argv = vec!["worklog", "-C", dir.to_str().unwrap()];
    argv.extend_from_slice(args);
    let code = run(
        argv,
        &mut Io {
            stdout: &mut out,
            stderr: &mut err,
        },
        &system_ports(),
    );
    (
        code,
        String::from_utf8_lossy(&out).into_owned(),
        String::from_utf8_lossy(&err).into_owned(),
    )
}

#[test]
fn create_trace_checkpoint_done_roundtrip() {
    let dir = tempfile::tempdir().unwrap();
    let d = dir.path();
    assert_eq!(wl(d, &["init"]).1, "initialized\n");
    let (code, out, _) = wl(d, &["create", "Ship it: now", "--started", "--json"]);
    assert_eq!(code, 0);
    let id = out
        .trim()
        .strip_prefix("{\"id\":\"")
        .unwrap()
        .strip_suffix("\"}")
        .unwrap()
        .to_string();
    assert_eq!(
        wl(d, &["trace", &id, "-k", "finding", "found it"]).1,
        "ok\n"
    );
    let (code, _, err) = wl(d, &["done", &id]);
    assert_eq!(code, 1);
    assert!(err.starts_with("error: no_uncheckpointed_entries"), "{err}");
    assert_eq!(
        wl(d, &["done", &id, "changes", "learnings"]).1,
        "task completed\n"
    );
    let (_, listed, _) = wl(d, &["list", "--all", "--no-header"]);
    assert!(listed.contains("done  \"Ship it: now\""), "{listed}");
    let (_, traces, _) = wl(d, &["traces", &id, "--kind", "finding", "--json"]);
    assert!(traces.contains("\"kind\":\"finding\""), "{traces}");
}

#[test]
fn errors_use_the_contract_exit_codes() {
    let dir = tempfile::tempdir().unwrap();
    let d = dir.path();
    let (code, _, err) = wl(d, &["list"]);
    assert_eq!(
        (code, err.lines().next()),
        (1, Some("error: not_initialized"))
    );
    let (code, _, err) = wl(d, &["list", "--json"]);
    assert_eq!(code, 1);
    assert!(err.starts_with("{\"error\":\"not_initialized\""), "{err}");
    assert_eq!(wl(d, &["bogus"]).0, 2);
    assert_eq!(wl(d, &["--purge-ttl", "0", "list"]).0, 1);
}

#[test]
fn task_files_keep_their_bytes_when_only_a_trace_is_added() {
    let dir = tempfile::tempdir().unwrap();
    let d = dir.path();
    wl(d, &["init"]);
    let (_, id, _) = wl(d, &["create", "Task", "-t", "2020-01-01T10:00"]);
    let id = id.trim().to_string();
    wl(d, &["trace", &id, "-t", "2020-01-02T09:00", "first"]);
    let tasks = d.join(".worklog/tasks");
    let file = std::fs::read_dir(&tasks)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let text = std::fs::read_to_string(file).unwrap();
    assert!(
        text.contains("\n# Entries\n\n## 2020-01-02 09:00\n[added:: "),
        "{text}"
    );
    assert!(
        text.contains("has_uncheckpointed_entries: true\n"),
        "{text}"
    );
    assert!(text.ends_with("first\n\n\n# Checkpoints\n"), "{text:?}");
}
