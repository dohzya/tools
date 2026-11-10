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
