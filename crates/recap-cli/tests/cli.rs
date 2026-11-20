//! End-to-end behaviours of `run` that the black-box suite cannot pin: they
//! need a fake terminal/home, or inspect a failure path with fake ports.

use recap_cli::domain::ports::{Environment, Ports, ShellResult, ShellRunner};
use recap_cli::{Io, run, system_ports};
use std::sync::Arc;

struct FakeEnv {
    cwd: String,
    home: Option<String>,
    tty: bool,
}

impl Environment for FakeEnv {
    fn get_env(&self, _: &str) -> Option<String> {
        None
    }
    fn is_terminal(&self) -> bool {
        self.tty
    }
    fn cwd(&self) -> String {
        self.cwd.clone()
    }
    fn home(&self) -> Option<String> {
        self.home.clone()
    }
}

/// Echoes the command and the `NO_COLOR` / `FORCE_COLOR` it was given.
struct EchoShell;

impl ShellRunner for EchoShell {
    fn run(&self, command: &str, env: &[(String, String)], _: Option<&str>) -> ShellResult {
        let color: Vec<&str> = env
            .iter()
            .filter(|(k, _)| k == "NO_COLOR" || k == "FORCE_COLOR")
            .map(|(k, _)| k.as_str())
            .collect();
        ShellResult {
            stdout: format!("{command}|{}\n", color.join(",")),
            stderr: String::new(),
            exit_code: 0,
        }
    }
}

struct Out {
    code: i32,
    stdout: String,
    stderr: String,
}

fn recap(dir: &std::path::Path, tty: bool, args: &[&str]) -> Out {
    let mut ports: Ports = system_ports();
    ports.env = Arc::new(FakeEnv {
        cwd: dir.to_string_lossy().into_owned(),
        home: Some(dir.join("home").to_string_lossy().into_owned()),
        tty,
    });
    ports.shell = Arc::new(EchoShell);
    let (mut out, mut err) = (vec![], vec![]);
    let code = run(
        std::iter::once("recap").chain(args.iter().copied()),
        &mut Io {
            stdout: &mut out,
            stderr: &mut err,
        },
        &ports,
    );
    Out {
        code,
        stdout: String::from_utf8(out).unwrap(),
        stderr: String::from_utf8(err).unwrap(),
    }
}

fn config(dir: &tempfile::TempDir, text: &str) {
    let path = dir.path().join(".config");
    std::fs::create_dir_all(&path).unwrap();
    std::fs::write(path.join("recap.yaml"), text).unwrap();
}

#[test]
fn colors_are_forwarded_to_commands_only_on_a_terminal() {
    let dir = tempfile::tempdir().unwrap();
    config(&dir, "sections:\n  - id: a\n    sh: tool\n    title: T\n");
    let plain = recap(dir.path(), false, &[]);
    assert_eq!(plain.stdout, "T\ntool|NO_COLOR\n");
    let tty = recap(dir.path(), true, &[]);
    assert_eq!(
        tty.stdout,
        "\x1b[1m\x1b[36mT\x1b[39m\x1b[22m\ntool|FORCE_COLOR\n"
    );
    let off = recap(dir.path(), true, &["--no-color"]);
    assert_eq!(off.stdout, plain.stdout);
}

#[test]
fn deprecated_alias_warns_on_stderr_but_succeeds() {
    let dir = tempfile::tempdir().unwrap();
    config(
        &dir,
        "sections:\n  - id: s\n    value: v\n  - id: old\n    alias: s\n    deprecated: true\n",
    );
    let r = recap(dir.path(), false, &["show", "old"]);
    assert_eq!((r.code, r.stdout.as_str()), (0, "v\n"));
    assert_eq!(
        r.stderr,
        "recap warning: section \"old\" is deprecated; use \"s\" instead\n"
    );
}

#[test]
fn several_unknown_sections_are_listed_together() {
    let dir = tempfile::tempdir().unwrap();
    let r = recap(dir.path(), false, &["show", "a", "b"]);
    assert_eq!(r.code, 1);
    assert_eq!(r.stderr, "recap error: sections \"a\", \"b\" not found\n");
}

#[test]
fn init_writes_once_then_refuses() {
    let dir = tempfile::tempdir().unwrap();
    let first = recap(dir.path(), false, &["init"]);
    assert_eq!(first.code, 0);
    assert!(first.stdout.starts_with("recap: created "));
    assert!(dir.path().join(".config/recap.yaml").exists());
    let again = recap(dir.path(), false, &["init"]);
    assert_eq!(again.code, 1);
    assert!(again.stderr.starts_with("recap: config already exists at "));
    let global = recap(dir.path(), false, &["init", "--global"]);
    assert_eq!(global.code, 0);
    assert!(dir.path().join("home/.config/recap.yaml").exists());
}

#[test]
fn config_files_lists_highest_layer_first() {
    let dir = tempfile::tempdir().unwrap();
    config(&dir, "sections: []\n");
    std::fs::write(dir.path().join(".config/recap.local.yaml"), "").unwrap();
    let r = recap(dir.path(), false, &["config", "files"]);
    let base = dir.path().to_string_lossy();
    assert_eq!(
        r.stdout,
        format!("{base}/.config/recap.local.yaml\n{base}/.config/recap.yaml\n")
    );
}
