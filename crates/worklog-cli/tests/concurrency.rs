//! Concurrent writers of one worklog must not lose each other's updates.

use std::path::Path;
use std::process::{Command, Stdio};

fn wl(dir: &Path, args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_worklog"))
        .arg("-C")
        .arg(dir)
        .args(args)
        .env_remove("WORKLOG_TASK_ID")
        .stdin(Stdio::null())
        .output()
        .unwrap()
}

#[test]
fn parallel_traces_and_todos_are_all_kept() {
    const WRITERS: usize = 8;
    const PER_WRITER: usize = 5;
    let dir = tempfile::tempdir().unwrap();
    let d = dir.path();
    assert!(wl(d, &["init"]).status.success());
    let out = wl(d, &["create", "Shared task", "--json"]);
    let text = String::from_utf8_lossy(&out.stdout).into_owned();
    let id = text
        .trim()
        .strip_prefix("{\"id\":\"")
        .and_then(|t| t.strip_suffix("\"}"))
        .unwrap()
        .to_string();

    let handles: Vec<_> = (0..WRITERS)
        .map(|w| {
            let (d, id) = (d.to_path_buf(), id.clone());
            std::thread::spawn(move || {
                for n in 0..PER_WRITER {
                    let msg = format!("trace-{w}-{n}");
                    let o = wl(&d, &["trace", &id, &msg]);
                    assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));
                    let todo = format!("todo-{w}-{n}");
                    let o = wl(&d, &["todo", "add", &id, &todo]);
                    assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));
                }
            })
        })
        .collect();
    for h in handles {
        h.join().unwrap();
    }

    let traces = String::from_utf8_lossy(&wl(d, &["traces", &id]).stdout).into_owned();
    let todos = String::from_utf8_lossy(&wl(d, &["todo", "list", &id]).stdout).into_owned();
    for w in 0..WRITERS {
        for n in 0..PER_WRITER {
            assert!(
                traces.contains(&format!("trace-{w}-{n}")),
                "lost trace-{w}-{n}"
            );
            assert!(
                todos.contains(&format!("todo-{w}-{n}")),
                "lost todo-{w}-{n}"
            );
        }
    }
}

#[test]
fn a_command_launched_by_run_can_use_the_worklog() {
    let dir = tempfile::tempdir().unwrap();
    let d = dir.path();
    assert!(wl(d, &["init"]).status.success());
    let out = wl(d, &["create", "Launcher", "--json"]);
    let text = String::from_utf8_lossy(&out.stdout).into_owned();
    let id = text
        .trim()
        .strip_prefix("{\"id\":\"")
        .and_then(|t| t.strip_suffix("\"}"))
        .unwrap()
        .to_string();
    // The child would wait 10 s for the lock if `run` kept it while spawning.
    let started = std::time::Instant::now();
    let o = wl(
        d,
        &[
            "run",
            &id,
            env!("CARGO_BIN_EXE_worklog"),
            "-C",
            d.to_str().unwrap(),
            "trace",
            "from-child",
        ],
    );
    assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));
    assert!(started.elapsed().as_secs() < 5);
    let traces = String::from_utf8_lossy(&wl(d, &["traces", &id]).stdout).into_owned();
    assert!(traces.contains("from-child"), "{traces}");
}

// ---- worklogs reached through scopes or paths --------------------------------

/// Whole-test deadline: a lock cycle would show up as the 10 s lock timeout.
const FAST: std::time::Duration = std::time::Duration::from_secs(8);

fn ok(d: &Path, args: &[&str]) -> String {
    let o = wl(d, args);
    assert!(
        o.status.success(),
        "{args:?}: {}",
        String::from_utf8_lossy(&o.stderr)
    );
    String::from_utf8_lossy(&o.stdout).into_owned()
}

fn new_id(d: &Path, args: &[&str]) -> String {
    let text = ok(d, args);
    text.trim()
        .strip_prefix("{\"id\":\"")
        .and_then(|t| t.strip_suffix("\"}"))
        .unwrap()
        .to_string()
}

/// A git repository with two child scopes, `s1` and `s2`.
fn two_scopes() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let d = dir.path();
    assert!(
        Command::new("git")
            .arg("init")
            .arg("-q")
            .arg(d)
            .status()
            .unwrap()
            .success()
    );
    ok(d, &["init"]);
    for s in ["s1", "s2"] {
        std::fs::create_dir(d.join(s)).unwrap();
        ok(d, &["scopes", "add", s, s]);
    }
    dir
}

fn run_all(jobs: Vec<Box<dyn FnOnce() + Send>>) {
    let started = std::time::Instant::now();
    let handles: Vec<_> = jobs.into_iter().map(std::thread::spawn).collect();
    for h in handles {
        h.join().unwrap();
    }
    assert!(started.elapsed() < FAST, "took {:?}", started.elapsed());
}

#[test]
fn parallel_writers_of_a_scope_worklog_lose_nothing() {
    let dir = two_scopes();
    let d = dir.path().to_path_buf();
    let jobs: Vec<Box<dyn FnOnce() + Send>> = (0..8)
        .map(|n| {
            let d = d.clone();
            Box::new(move || {
                // `--scope` moves the command from the root worklog to s1.
                ok(&d, &["create", "--scope", "s1", &format!("task-{n}")]);
            }) as Box<dyn FnOnce() + Send>
        })
        .collect();
    run_all(jobs);
    let listed = ok(&d, &["list", "--scope", "s1", "--no-header"]);
    for n in 0..8 {
        assert!(listed.contains(&format!("task-{n}")), "lost task-{n}");
    }
}

#[test]
fn parallel_scopes_add_keep_every_child_in_the_root_config() {
    let dir = two_scopes();
    let d = dir.path().to_path_buf();
    let jobs: Vec<Box<dyn FnOnce() + Send>> = (0..6)
        .map(|n| {
            let d = d.clone();
            Box::new(move || {
                let name = format!("extra{n}");
                std::fs::create_dir(d.join(&name)).unwrap();
                ok(&d, &["scopes", "add", &name, &name]);
            }) as Box<dyn FnOnce() + Send>
        })
        .collect();
    run_all(jobs);
    let cfg = std::fs::read_to_string(d.join(".worklog/scope.json")).unwrap();
    for n in 0..6 {
        assert!(cfg.contains(&format!("extra{n}")), "lost extra{n}: {cfg}");
    }
}

#[test]
fn assign_in_opposite_directions_does_not_deadlock_nor_lose_tasks() {
    let dir = two_scopes();
    let d = dir.path().to_path_buf();
    let in_s1: Vec<String> = (0..16)
        .map(|n| new_id(&d, &["create", "--scope", "s1", &format!("a{n}"), "--json"]))
        .collect();
    let in_s2: Vec<String> = (0..16)
        .map(|n| new_id(&d, &["create", "--scope", "s2", &format!("b{n}"), "--json"]))
        .collect();
    let mut jobs: Vec<Box<dyn FnOnce() + Send>> = Vec::new();
    for id in in_s1.clone() {
        let d = d.clone();
        jobs.push(Box::new(move || {
            ok(&d, &["scopes", "assign", "s2", &id]);
        }));
    }
    for id in in_s2.clone() {
        let d = d.clone();
        jobs.push(Box::new(move || {
            ok(&d, &["scopes", "assign", "s1", &id]);
        }));
    }
    run_all(jobs);
    let s1 = ok(&d, &["list", "--scope", "s1", "--no-header"]);
    let s2 = ok(&d, &["list", "--scope", "s2", "--no-header"]);
    for n in 0..16 {
        assert!(s2.contains(&format!("a{n}")), "a{n} not in s2: {s2}");
        assert!(s1.contains(&format!("b{n}")), "b{n} not in s1: {s1}");
    }
}

#[test]
fn assigning_to_the_scope_that_already_holds_the_task_takes_one_lock() {
    let dir = two_scopes();
    let d = dir.path();
    let id = new_id(d, &["create", "--scope", "s1", "here", "--json"]);
    let started = std::time::Instant::now();
    ok(d, &["scopes", "assign", "s1", &id]);
    assert!(started.elapsed() < FAST);
}

#[test]
fn import_in_opposite_directions_does_not_deadlock_nor_lose_tasks() {
    let dir = tempfile::tempdir().unwrap();
    let d = dir.path().to_path_buf();
    for w in ["a", "b"] {
        std::fs::create_dir(d.join(w)).unwrap();
        ok(&d.join(w), &["init"]);
    }
    for n in 0..4 {
        ok(&d.join("a"), &["create", &format!("from-a-{n}")]);
        ok(&d.join("b"), &["create", &format!("from-b-{n}")]);
    }
    let mut jobs: Vec<Box<dyn FnOnce() + Send>> = Vec::new();
    for _ in 0..3 {
        for (to, from) in [("a", "b"), ("b", "a")] {
            let d = d.clone();
            jobs.push(Box::new(move || {
                ok(
                    &d.join(to),
                    &[
                        "import",
                        "-p",
                        d.join(from).join(".worklog").to_str().unwrap(),
                    ],
                );
            }));
        }
    }
    run_all(jobs);
    for w in ["a", "b"] {
        let listed = ok(&d.join(w), &["list", "--no-header"]);
        for n in 0..4 {
            assert!(listed.contains(&format!("from-a-{n}")), "{w}: {listed}");
            assert!(listed.contains(&format!("from-b-{n}")), "{w}: {listed}");
        }
    }
}

/// Every command that writes outside the current worklog: debug builds panic
/// when one writes into a worklog it did not lock (`Ctx::assert_locked`).
#[test]
fn every_remote_writer_stays_inside_its_locks() {
    let dir = two_scopes();
    let d = dir.path();
    let t1 = new_id(d, &["create", "--scope", "s1", "tagged", "--json"]);
    ok(d, &["tags", &format!("s1:{t1}"), "--add", "grp"]);
    ok(d, &["scopes", "assign", "--tag", "grp", "s2"]);
    ok(d, &["scopes", "rename", "s2", "s2b"]);
    ok(d, &["scopes", "list", "--refresh"]);
    let t2 = new_id(d, &["create", "--scope", "s1", "again", "--json"]);
    ok(d, &["tags", &format!("s1:{t2}"), "--add", "grp"]);
    ok(d, &["scopes", "export", "grp", "exported"]);
    ok(d, &["scopes", "delete", "s1", "--move-to", "s2b"]);
    ok(d, &["scopes", "sync-worktrees", "--dry-run"]);
    std::fs::create_dir(d.join("kid")).unwrap();
    ok(&d.join("kid"), &["init"]);
    ok(&d.join("kid"), &["scopes", "add-parent", ".."]);
}
