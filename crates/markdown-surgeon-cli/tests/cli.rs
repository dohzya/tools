//! Behaviours of `run` that the black-box suite cannot pin: the clock (magic
//! expressions), stdin content and the MRFI commands end to end.

use markdown_surgeon_cli::{Env, Zoned, run};
use std::fs;

struct Out {
    code: i32,
    stdout: String,
    stderr: String,
}

fn md(dir: &std::path::Path, args: &[&str], stdin: &str) -> Out {
    let (mut out, mut err) = (vec![], vec![]);
    let mut input = stdin.as_bytes();
    let mut env = Env {
        stdin: &mut input,
        stdout: &mut out,
        stderr: &mut err,
        now: "2026-11-03T09:05:07+01:00[Europe/Paris]"
            .parse::<Zoned>()
            .unwrap(),
    };
    // Paths are relative to the temp dir without touching the process cwd.
    let args: Vec<String> = std::iter::once("md".to_owned())
        .chain(args.iter().map(|a| {
            if a.ends_with(".md") {
                dir.join(a).to_string_lossy().into_owned()
            } else {
                (*a).to_owned()
            }
        }))
        .collect();
    let code = run(args, &mut env);
    Out {
        code,
        stdout: String::from_utf8(out).unwrap(),
        stderr: String::from_utf8(err).unwrap(),
    }
}

fn file(dir: &tempfile::TempDir, name: &str, text: &str) {
    fs::write(dir.path().join(name), text).unwrap();
}

fn read(dir: &tempfile::TempDir, name: &str) -> String {
    fs::read_to_string(dir.path().join(name)).unwrap()
}

#[test]
fn write_expands_magic_expressions_with_the_injected_clock() {
    let dir = tempfile::tempdir().unwrap();
    file(&dir, "a.md", "---\nowner: Ada\n---\n# T\n\nold\n");
    let r = md(
        dir.path(),
        &["write", "a.md", "# T", "{date} {meta:owner}"],
        "",
    );
    assert_eq!(r.code, 0, "{}", r.stderr);
    assert!(read(&dir, "a.md").ends_with("# T\n\n2026-11-03 Ada\n"));
}

#[test]
fn append_reads_stdin_when_the_content_is_omitted() {
    let dir = tempfile::tempdir().unwrap();
    file(&dir, "a.md", "# T\n");
    let r = md(dir.path(), &["append", "a.md"], "at {time}\n");
    assert_eq!(r.code, 0, "{}", r.stderr);
    assert_eq!(read(&dir, "a.md"), "# T\n\nat 09:05:07\n");
}

#[test]
fn meta_set_expands_magic_and_parses_the_result_as_yaml() {
    let dir = tempfile::tempdir().unwrap();
    file(&dir, "a.md", "# T\n");
    let r = md(
        dir.path(),
        &["meta", "a.md", "--set", "when", "{dt:short}"],
        "",
    );
    assert_eq!(r.code, 0, "{}", r.stderr);
    assert_eq!(r.stdout, "set when\n");
    assert_eq!(
        read(&dir, "a.md"),
        "---\nwhen: \"2026-11-03 09:05\"\n---\n\n# T\n"
    );
}

#[test]
fn create_uses_the_clock_and_refuses_to_overwrite() {
    let dir = tempfile::tempdir().unwrap();
    let r = md(
        dir.path(),
        &["create", "n.md", "--title", "{date}", "--meta", "at={dt}"],
        "",
    );
    assert_eq!(r.code, 0, "{}", r.stderr);
    assert_eq!(
        read(&dir, "n.md"),
        "---\nat: '2026-11-03T09:05:07+01:00'\n---\n\n# 2026-11-03\n"
    );
    let again = md(dir.path(), &["create", "n.md"], "");
    assert_eq!(
        (again.code, again.stderr.lines().next()),
        (1, Some("error: io_error"))
    );
}

/// A document with a scope to edit: one section holding a paragraph, a
/// sub-section, and a sibling that must stay untouched.
const SCOPES: &str = "# A\n\nlead\n\n## Sub\n\nsub body\n\n# B\n\ntail\n";

fn reference(dir: &tempfile::TempDir, args: &[&str]) -> String {
    let r = md(dir.path(), args, "");
    assert_eq!(r.code, 0, "{args:?}: {}", r.stderr);
    r.stdout.trim().to_owned()
}

#[test]
fn outline_mrfi_adds_a_reference_to_every_row() {
    let dir = tempfile::tempdir().unwrap();
    file(&dir, "a.md", SCOPES);
    let plain = md(dir.path(), &["outline", "a.md"], "").stdout;
    let rows = md(
        dir.path(),
        &["outline", "a.md", "--mrfi", "--format", "debug"],
        "",
    )
    .stdout;
    assert_eq!(plain.lines().count(), rows.lines().count());
    for (p, r) in plain.lines().zip(rows.lines()) {
        // `# A ^id L1` becomes `# A ^id ~{v0;...} L1`.
        let (head, line) = p.rsplit_once(" L").unwrap();
        assert!(r.starts_with(&format!("{head} ~{{v0;r=")), "{r}");
        assert!(r.ends_with(&format!("}} L{line}")), "{r}");
    }
    let last = md(
        dir.path(),
        &["outline", "a.md", "--mrfi", "--last", "--json"],
        "",
    );
    assert!(last.stdout.starts_with(r#"{"id":""#));
    assert!(last.stdout.contains(r#","mrfi":"~"#));
}

#[test]
fn ref_converts_between_encodings_without_a_file() {
    let dir = tempfile::tempdir().unwrap();
    file(&dir, "a.md", SCOPES);
    let debug = reference(&dir, &["ref", "a.md", "3:1-3:5", "--format", "debug"]);
    let hangul = reference(&dir, &["ref", &debug]);
    assert!(hangul.starts_with('~') && !hangul.starts_with("~{"));
    assert_eq!(
        reference(&dir, &["ref", &hangul, "--format", "debug"]),
        debug
    );
    let bad = md(dir.path(), &["ref", "~notvalid!!"], "");
    assert_eq!(
        (bad.code, bad.stderr.lines().next()),
        (1, Some("error: invalid_id"))
    );
}

#[test]
fn a_plain_reference_edits_exactly_its_lines() {
    let dir = tempfile::tempdir().unwrap();
    file(&dir, "a.md", SCOPES);
    let target = reference(&dir, &["ref", "a.md", "3:1-3:5", "--format", "debug"]);
    let r = md(dir.path(), &["write", "a.md", &target, "changed"], "");
    assert_eq!(r.code, 0, "{}", r.stderr);
    assert_eq!(
        read(&dir, "a.md"),
        "# A\n\nchanged\n\n## Sub\n\nsub body\n\n# B\n\ntail\n"
    );
}

#[test]
fn a_scope_reference_removes_its_whole_extent() {
    let dir = tempfile::tempdir().unwrap();
    file(&dir, "a.md", SCOPES);
    let outline = md(dir.path(), &["outline", "a.md", "--json"], "").stdout;
    let id = outline.split("\"id\":\"").nth(1).unwrap()[..8].to_owned();
    let scope = reference(&dir, &["ref", "a.md", "1:1-1:4", "--format", "debug"]);
    // `sec` follows the document's current structure: the sub-section goes too.
    let r = md(dir.path(), &["remove", "a.md", &scope, "-x", "sec"], "");
    assert_eq!(r.code, 0, "{}", r.stderr);
    assert_eq!(read(&dir, "a.md"), "# B\n\ntail\n", "{id}");
}

/// The extent of `body` starts at the first line after the heading, which may
/// be the heading of a sub-section: the edit must still act on the identity
/// heading (the TS re-derived the section from the extent and hit `## Sub`).
#[test]
fn a_body_extent_acts_on_the_identity_heading_not_on_its_first_subsection() {
    let dir = tempfile::tempdir().unwrap();
    file(&dir, "a.md", "# A\n## Sub\n\nx\n\n# B\n\ny\n");
    let heading = reference(&dir, &["ref", "a.md", "1:1-1:4", "--format", "debug"]);
    let r = md(dir.path(), &["empty", "a.md", &heading, "-x", "body"], "");
    assert_eq!(r.code, 0, "{}", r.stderr);
    assert_eq!(read(&dir, "a.md"), "# A\n# B\n\ny\n");
}

#[test]
fn destructive_commands_refuse_a_stale_reference() {
    let dir = tempfile::tempdir().unwrap();
    file(&dir, "a.md", SCOPES);
    let target = reference(&dir, &["ref", "a.md", "3:1-3:5", "--format", "debug"]);
    file(
        &dir,
        "a.md",
        "# A\n\nsomething else entirely\n\n# B\n\ntail\n",
    );
    let r = md(dir.path(), &["remove", "a.md", &target], "");
    assert_eq!(
        (r.code, r.stderr.lines().next()),
        (1, Some("error: parse_error"))
    );
    assert!(r.stderr.contains("Safety gate rejected"), "{}", r.stderr);
    assert_eq!(
        read(&dir, "a.md"),
        "# A\n\nsomething else entirely\n\n# B\n\ntail\n"
    );
}

#[test]
fn extent_flags_need_an_mrfi_selector() {
    let dir = tempfile::tempdir().unwrap();
    file(&dir, "a.md", SCOPES);
    let r = md(dir.path(), &["remove", "a.md", "# A", "--force"], "");
    assert_eq!(
        (r.code, r.stderr.lines().next()),
        (1, Some("error: parse_error"))
    );
}

#[test]
fn usage_errors_exit_with_2_and_help_with_0() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(md(dir.path(), &["read"], "").code, 2);
    assert_eq!(md(dir.path(), &["bogus"], "").code, 2);
    let help = md(dir.path(), &["--help"], "");
    assert_eq!(help.code, 0);
    assert!(help.stdout.contains("concat"));
}

#[test]
fn completions_are_generated_for_the_md_name() {
    let dir = tempfile::tempdir().unwrap();
    let r = md(dir.path(), &["completions", "bash"], "");
    assert_eq!(r.code, 0);
    assert!(
        r.stdout.contains("_md()"),
        "{}",
        &r.stdout[..80.min(r.stdout.len())]
    );
}
