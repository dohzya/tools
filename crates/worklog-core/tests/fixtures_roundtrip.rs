//! Task files of the black-box fixtures were written by the TS tool. Reading
//! and re-dumping their frontmatter must not change a byte.

use std::path::{Path, PathBuf};
use worklog_core::taskfile::{parse_task_file, update_frontmatter};

fn task_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            task_files(&p, out);
        } else if p.extension().is_some_and(|x| x == "md")
            && p.parent().is_some_and(|d| d.ends_with("tasks"))
        {
            out.push(p);
        }
    }
}

#[test]
fn fixtures_survive_a_frontmatter_rewrite() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/blackbox/fixtures");
    let mut files = Vec::new();
    task_files(&root, &mut files);
    assert!(files.len() > 10, "fixtures not found under {root:?}");
    for f in files {
        let text = std::fs::read_to_string(&f).unwrap().replace("\r\n", "\n");
        parse_task_file(&text).unwrap_or_else(|e| panic!("{f:?}: {e}"));
        assert_eq!(update_frontmatter(&text, &[]), text, "{f:?}");
    }
}
