//! Execution context of a command: ports, streams, the directory the
//! commands act on, and the repository operations they share (index, task
//! files, purge).

use crate::path::{join, resolve};
use crate::ports::Ports;
use std::io::Write;
use worklog_core::error::{Code, WtError, WtResult, err};
use worklog_core::index::Index;
use worklog_core::taskfile::{self, TaskFile};
use worklog_core::time;
use worklog_core::yaml::Value;

/// Why a command stopped.
#[derive(Debug)]
pub enum Fail {
    /// A domain error: printed as `error: <code>` and exit status 1.
    Wt(WtError),
    /// Bad command line, exit status 2.
    Usage(String),
    /// Exit with this status, nothing more to print.
    Exit(i32),
}

impl From<WtError> for Fail {
    fn from(e: WtError) -> Self {
        Fail::Wt(e)
    }
}

/// Result of a command.
pub type Res<T> = Result<T, Fail>;

/// Builds a domain failure.
pub fn fail<T>(code: Code, message: impl Into<String>) -> Res<T> {
    Err(Fail::Wt(WtError::new(code, message)))
}

/// Default depth of the scan for child worklogs.
pub const DEFAULT_DEPTH_LIMIT: usize = 5;

/// Default retention of done tasks, in days.
pub const DEFAULT_PURGE_TTL_DAYS: i64 = 30;

/// State shared by the handlers of one invocation.
pub struct Ctx<'a> {
    /// Ports.
    pub ports: &'a Ports,
    /// Standard output.
    pub out: &'a mut dyn Write,
    /// Standard error.
    pub err: &'a mut dyn Write,
    /// Directory the commands act on (`chdir` of the TS tool is a field).
    pub cwd: String,
    /// Name of the worklog directory, `.worklog` unless `--worklog-dir`.
    pub wl_dir: String,
    /// `WORKLOG_TASK_ID`.
    pub env_task_id: Option<String>,
    /// `--purge-ttl`.
    pub purge_ttl_cli: Option<i64>,
    /// `WORKLOG_DEPTH_LIMIT`.
    pub depth_limit: usize,
}

impl Ctx<'_> {
    /// Prints a line on stdout.
    pub fn println(&mut self, s: &str) {
        let _ = writeln!(self.out, "{s}");
    }

    /// Prints a line on stderr.
    pub fn eprintln(&mut self, s: &str) {
        let _ = writeln!(self.err, "{s}");
    }

    /// Path of the worklog directory.
    pub fn wl_path(&self) -> String {
        join(&self.cwd, &self.wl_dir)
    }

    /// `index.json` of the current worklog.
    pub fn index_file(&self) -> String {
        join(&self.wl_path(), "index.json")
    }

    /// Directory of the task files.
    pub fn tasks_dir(&self) -> String {
        join(&self.wl_path(), "tasks")
    }

    /// File of a task.
    pub fn task_path(&self, id: &str) -> String {
        join(&self.tasks_dir(), &format!("{id}.md"))
    }

    /// Local ISO timestamp.
    pub fn now_iso(&self) -> String {
        time::local_iso(self.ports.clock.as_ref())
    }

    /// Local `YYYY-MM-DD HH:mm`.
    pub fn now_short(&self) -> String {
        time::local_short(self.ports.clock.as_ref())
    }

    /// `WORKLOG_TASK_ID` is set (and not empty).
    pub fn has_env_task_id(&self) -> bool {
        self.env_task_id.is_some()
    }

    // ---- files ---------------------------------------------------------

    /// Text of a file, with LF line endings.
    pub fn read_text(&self, path: &str) -> WtResult<String> {
        match self.ports.fs.read_to_string(path) {
            Ok(Some(t)) => Ok(to_lf(&t)),
            Ok(None) => err(Code::IoError, format!("File not found: {path}")),
            Err(_) => err(Code::IoError, format!("Failed to read file: {path}")),
        }
    }

    /// Text of a user-supplied file, relative to the working directory, as is.
    pub fn read_text_raw(&self, path: &str) -> WtResult<String> {
        match self.ports.fs.read_to_string(&resolve(&self.cwd, path)) {
            Ok(Some(t)) => Ok(t),
            Ok(None) => err(Code::IoError, format!("File not found: {path}")),
            Err(_) => err(Code::IoError, format!("Failed to read file: {path}")),
        }
    }

    /// Writes a file; when it already exists with CRLF or CR line endings
    /// they are kept.
    pub fn write_text(&self, path: &str, content: &str) -> WtResult<()> {
        let eol = match self.ports.fs.read_to_string(path) {
            Ok(Some(old)) => detect_eol(&old),
            _ => "\n",
        };
        let text = if eol == "\n" {
            content.to_string()
        } else {
            content.replace('\n', eol)
        };
        self.write_raw(path, &text)
    }

    /// Writes a file as is.
    pub fn write_raw(&self, path: &str, content: &str) -> WtResult<()> {
        self.ports
            .fs
            .write(path, content)
            .or_else(|_| err(Code::IoError, format!("Failed to write file: {path}")))
    }

    // ---- index ---------------------------------------------------------

    /// Loads the index, migrating a v1 worklog first.
    pub fn load_index(&mut self) -> WtResult<Index> {
        let path = self.index_file();
        let Some(text) = self.read_index_text(&path)? else {
            return err(
                Code::NotInitialized,
                "Worklog not initialized. Run 'wl init' first.",
            );
        };
        let index = parse_index(&text, &path, true)?;
        if index.version() < 2 {
            self.migrate_to_v2(&path)?;
            let text = self.read_text(&path)?;
            return parse_index(&text, &path, true);
        }
        Ok(index)
    }

    fn read_index_text(&self, path: &str) -> WtResult<Option<String>> {
        match self.ports.fs.read_to_string(path) {
            Ok(t) => Ok(t),
            Err(_) => err(Code::IoError, format!("Failed to read file: {path}")),
        }
    }

    /// Reads an index of another worklog, without migration or normalization.
    pub fn load_index_from(&self, worklog_path: &str) -> WtResult<Index> {
        let path = join(worklog_path, "index.json");
        match self.ports.fs.read_to_string(&path) {
            Ok(Some(t)) => parse_index(&t, &path, false),
            Ok(None) => err(
                Code::NotInitialized,
                format!("No worklog at: {worklog_path}"),
            ),
            Err(_) => err(Code::IoError, format!("Failed to read file: {path}")),
        }
    }

    /// Saves the index of the current worklog.
    pub fn save_index(&self, index: &Index) -> WtResult<()> {
        self.write_raw(&self.index_file(), &index.to_text())
    }

    /// Saves the index of another worklog.
    pub fn save_index_to(&self, worklog_path: &str, index: &Index) -> WtResult<()> {
        self.write_raw(&join(worklog_path, "index.json"), &index.to_text())
    }

    /// v1 to v2: tasks got a `name` (the first line of the description) and
    /// `ready_at` / `started_at`. Only entries that lack a `name` are
    /// rewritten: an index that merely misses its `version` (as `scopes add`
    /// used to write it) is stamped without touching the tasks.
    fn migrate_to_v2(&mut self, path: &str) -> WtResult<()> {
        let text = self.read_text(path)?;
        let mut index = parse_index(&text, path, false)?;
        if index.version() == 2 {
            return Ok(());
        }
        let ids = index.ids();
        let mut migrated = 0;
        for id in &ids {
            if index.raw(id).is_some_and(|e| e.get("name").is_some()) {
                continue;
            }
            let task_path = self.task_path(id);
            if !self.ports.fs.exists(&task_path) {
                continue;
            }
            if migrated == 0 {
                self.eprintln("Migrating worklog to v2...");
            }
            migrated += 1;
            let content = self.read_text(&task_path)?;
            let parsed = taskfile::parse_task_file(&content)?;
            let mut updates: Vec<(&str, Option<Value>)> = Vec::new();
            let mut status_active = false;
            if parsed
                .fm
                .iter()
                .any(|(k, v)| k == "status" && v.as_str() == Some("active"))
            {
                updates.push(("status", Some(Value::str("created"))));
                status_active = true;
            }
            let created = parsed
                .fm
                .iter()
                .find(|(k, _)| k == "created")
                .map(|(_, v)| v.clone())
                .filter(|v| *v != Value::Null && *v != Value::Str(String::new()));
            let created_at = match &created {
                Some(v) => Some(v.clone()),
                None => parsed
                    .fm
                    .iter()
                    .find(|(k, _)| k == "created_at")
                    .map(|(_, v)| v.clone()),
            };
            if let Some(v) = &created {
                updates.push(("created_at", Some(v.clone())));
            }
            updates.push(("ready_at", Some(Value::Null)));
            updates.push(("started_at", Some(Value::Null)));
            let desc = parsed.desc();
            let name = desc
                .join("\n\n---\n\n")
                .split('\n')
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
            updates.push(("name", Some(Value::str(name.clone()))));
            updates.push((
                "desc",
                Some(Value::Seq(
                    desc.iter().map(|d| Value::str(d.clone())).collect(),
                )),
            ));
            let new_content = taskfile::update_frontmatter(&content, &updates);
            self.write_text(&task_path, &new_content)?;
            let created_text = created_at
                .as_ref()
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let mut ups: Vec<(&str, Option<worklog_core::json::J>)> = vec![
                ("name", Some(worklog_core::json::J::str(name))),
                (
                    "status_updated_at",
                    Some(worklog_core::json::J::str(created_text.clone())),
                ),
            ];
            if status_active {
                ups.push(("status", Some(worklog_core::json::J::str("created"))));
            }
            let has_created = index
                .raw(id)
                .and_then(|e| e.get("created"))
                .and_then(worklog_core::json::J::as_str)
                .is_some_and(|c| !c.is_empty());
            if !has_created && !created_text.is_empty() {
                ups.push(("created", Some(worklog_core::json::J::str(created_text))));
            }
            index.update(id, ups);
        }
        index.set_version(2);
        self.write_raw(path, &index.to_text())?;
        if migrated > 0 {
            self.eprintln(&format!("Migration complete. {migrated} tasks updated."));
        }
        Ok(())
    }

    // ---- tasks ---------------------------------------------------------

    /// Raw text of a task file.
    pub fn load_task_content(&self, id: &str) -> WtResult<String> {
        let path = self.task_path(id);
        if !self.ports.fs.exists(&path) {
            return err(Code::TaskNotFound, format!("Task not found: {id}"));
        }
        self.read_text(&path)
    }

    /// Writes a task file.
    pub fn save_task_content(&self, id: &str, content: &str) -> WtResult<()> {
        self.write_text(&self.task_path(id), content)
    }

    /// Parsed task, `None` when its file is missing.
    pub fn find_task(&self, id: &str) -> WtResult<Option<TaskFile>> {
        let path = self.task_path(id);
        if !self.ports.fs.exists(&path) {
            return Ok(None);
        }
        taskfile::parse_task_file(&self.read_text(&path)?).map(Some)
    }

    /// Parsed task; `task_not_found` when missing.
    pub fn require_task(&self, id: &str) -> WtResult<TaskFile> {
        match self.find_task(id)? {
            Some(t) => Ok(t),
            None => err(Code::TaskNotFound, format!("Task not found: {id}")),
        }
    }

    // ---- purge ---------------------------------------------------------

    /// Retention in days: `--purge-ttl`, then `WORKLOG_PURGE_TTL_DAYS`, then
    /// the local and global `config.json`, then 30.
    fn purge_ttl_days(&self) -> WtResult<i64> {
        if let Some(n) = self.purge_ttl_cli {
            return Ok(n);
        }
        if let Some(v) = self
            .ports
            .env
            .var("WORKLOG_PURGE_TTL_DAYS")
            .filter(|v| !v.is_empty())
        {
            return parse_purge_ttl(&v, "WORKLOG_PURGE_TTL_DAYS");
        }
        if let Some(n) = self.read_ttl_config(&join(&self.wl_path(), "config.json"))? {
            return Ok(n);
        }
        let base = self
            .ports
            .env
            .var("XDG_CONFIG_HOME")
            .filter(|v| !v.is_empty())
            .or_else(|| {
                self.ports
                    .env
                    .var("HOME")
                    .filter(|v| !v.is_empty())
                    .or_else(|| self.ports.env.var("USERPROFILE").filter(|v| !v.is_empty()))
                    .map(|h| join(&h, ".config"))
            });
        if let Some(base) = base
            && let Some(n) = self.read_ttl_config(&join(&join(&base, "wl"), "config.json"))?
        {
            return Ok(n);
        }
        Ok(DEFAULT_PURGE_TTL_DAYS)
    }

    fn read_ttl_config(&self, path: &str) -> WtResult<Option<i64>> {
        let Ok(Some(text)) = self.ports.fs.read_to_string(path) else {
            return Ok(None);
        };
        let Ok(json) = worklog_core::json::J::parse(&text) else {
            return err(Code::InvalidArgs, format!("{path}: invalid JSON"));
        };
        match json.get("purgeTtlDays") {
            None => Ok(None),
            Some(worklog_core::json::J::Num(n)) => parse_purge_ttl_value(
                n.as_f64().unwrap_or(f64::NAN),
                &format!("{path} purgeTtlDays"),
            )
            .map(Some),
            Some(worklog_core::json::J::Str(s)) => {
                parse_purge_ttl(s, &format!("{path} purgeTtlDays")).map(Some)
            }
            Some(other) => err(
                Code::InvalidArgs,
                format!(
                    "{path} purgeTtlDays: purge TTL must be a positive integer (days), got {}",
                    other.to_compact()
                ),
            ),
        }
    }

    /// Deletes done tasks older than the retention, unless they hold
    /// uncheckpointed entries. Run by almost every command.
    pub fn purge(&mut self) -> WtResult<()> {
        if !self.ports.fs.exists(&self.index_file()) {
            return Ok(());
        }
        let mut index = self.load_index()?;
        let ttl = self.purge_ttl_days()?;
        let cutoff = self.ports.clock.now_ms() - ttl * 24 * 60 * 60 * 1000;
        let mut modified = false;
        for (id, entry) in index.entries() {
            let Some(done_at) = entry.done_at.as_ref() else {
                continue;
            };
            if entry.status != Some(worklog_core::types::TaskStatus::Done) {
                continue;
            }
            let Some(at) = time::parse_instant(done_at, self.ports.clock.as_ref()) else {
                continue;
            };
            if at >= cutoff {
                continue;
            }
            let task = match self
                .load_task_content(&id)
                .and_then(|c| taskfile::parse_task_file(&c))
            {
                Ok(t) => t,
                Err(_) => continue,
            };
            if task.has_uncheckpointed_entries() {
                let last = task.entries.last().map_or("unknown", |e| e.ts.as_str());
                let msg = format!(
                    "⚠ Task {id} not purged: has uncheckpointed entries (last entry: {last})"
                );
                self.eprintln(&msg);
                continue;
            }
            self.ports.fs.remove(&self.task_path(&id));
            index.remove(&id);
            modified = true;
        }
        if modified {
            self.save_index(&index)?;
        }
        Ok(())
    }

    /// Creates the worklog when its directory does not exist.
    pub fn auto_init(&mut self) -> WtResult<()> {
        let wl = self.wl_path();
        let index_exists = self.ports.fs.exists(&self.index_file());
        if !self.ports.fs.exists(&wl) {
            self.ports
                .fs
                .create_dir_all(&self.tasks_dir())
                .or_else(|_| err(Code::IoError, format!("Failed to write file: {wl}")))?;
            // The TS tool wrote `{ "tasks": {} }` and let the first read stamp the
            // version after it; kept so that new worklogs look the same.
            self.write_raw(
                &self.index_file(),
                &Index {
                    root: worklog_core::json::J::Obj(vec![
                        ("tasks".into(), worklog_core::json::J::obj()),
                        ("version".into(), worklog_core::json::J::int(2)),
                    ]),
                }
                .to_text(),
            )?;
        } else if !index_exists {
            return err(
                Code::NotInitialized,
                "Worklog directory exists but is not properly initialized. Please run 'wl init' or remove .worklog directory.",
            );
        }
        Ok(())
    }
}

fn parse_index(text: &str, path: &str, normalize: bool) -> WtResult<Index> {
    Index::parse(text, normalize).or_else(|_| {
        err(
            Code::IoError,
            format!("Failed to read file: {path} (invalid JSON)"),
        )
    })
}

/// Converts CRLF and lone CR to LF.
pub fn to_lf(s: &str) -> String {
    if !s.contains('\r') {
        return s.to_string();
    }
    s.replace("\r\n", "\n").replace('\r', "\n")
}

fn detect_eol(s: &str) -> &'static str {
    if s.contains("\r\n") {
        "\r\n"
    } else if s.contains('\r') && !s.contains('\n') {
        "\r"
    } else {
        "\n"
    }
}

/// Validates a retention given as text.
pub fn parse_purge_ttl(value: &str, source: &str) -> WtResult<i64> {
    let n = if value.trim().is_empty() {
        f64::NAN
    } else {
        value.trim().parse::<f64>().unwrap_or(f64::NAN)
    };
    parse_purge_ttl_value(n, source).map_err(|mut e| {
        e.message = format!(
            "{source}: purge TTL must be a positive integer (days), got {}",
            serde_json::to_string(value).unwrap_or_default()
        );
        e
    })
}

fn parse_purge_ttl_value(n: f64, source: &str) -> WtResult<i64> {
    if n.is_finite() && n.fract() == 0.0 && (1.0..1e15).contains(&n) {
        return Ok(n as i64);
    }
    err(
        Code::InvalidArgs,
        format!("{source}: purge TTL must be a positive integer (days), got {n}"),
    )
}
