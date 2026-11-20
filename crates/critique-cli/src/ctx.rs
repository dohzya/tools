//! Invocation context shared by the commands, and the state files.

use crate::args::{CliError, Result, err};
use crate::config::{self, Settings};
use crate::host::Host;
use crate::paths;
use critique_core::agent::SessionSnapshot;
use critique_core::refmap::{self, ReferenceMap};
use critique_core::review::ReviewItem;
use std::io::Write;

/// Everything a command needs: host, settings and output streams.
pub struct Ctx<'a> {
    /// System access.
    pub host: &'a dyn Host,
    /// Global options.
    pub settings: Settings,
    /// Standard output.
    pub out: &'a mut dyn Write,
    /// Standard error.
    pub errw: &'a mut dyn Write,
}

impl Ctx<'_> {
    /// Writes to stdout.
    pub fn print(&mut self, text: &str) {
        let _ = self.out.write_all(text.as_bytes());
    }

    /// Program name for messages.
    pub fn program(&self) -> &'static str {
        config::program(self.host)
    }

    /// `cwd`-relative `/` path of `file`.
    pub fn rel(&self, file: &str) -> String {
        paths::relative_to(&self.host.cwd(), file)
    }

    /// Session snapshot path.
    pub fn session_path(&self) -> String {
        config::file_in(
            &config::state_dir(self.host, &self.settings),
            config::SESSION_FILE,
        )
    }

    /// Whether a session is active.
    pub fn has_session(&self) -> bool {
        self.host.exists(&self.session_path())
    }

    /// Reads the session snapshot.
    pub fn read_session(&self) -> Result<SessionSnapshot> {
        let path = self.session_path();
        if !self.host.exists(&path) {
            return err(format!(
                "No agent session snapshot found at {path}. Run {} session start first.",
                self.program()
            ));
        }
        let text = self.host.read_to_string(&path)?;
        serde_json::from_str(&text)
            .map_err(|e| CliError(format!("Invalid agent session snapshot {path}: {e}")))
    }

    /// Reads a text file.
    pub fn read_file(&self, file: &str) -> Result<String> {
        self.host
            .read_to_string(file)
            .map_err(|e| CliError(format!("{file}: {e}")))
    }

    fn read_map(&self) -> Result<ReferenceMap> {
        let path = config::file_in(
            &config::state_dir(self.host, &self.settings),
            config::MAP_FILE,
        );
        if !self.host.exists(&path) {
            return Ok(ReferenceMap::default());
        }
        let text = self.host.read_to_string(&path)?;
        ReferenceMap::parse(&text)
            .map_err(|e| CliError(format!("Invalid reference map {path}: {e}")))
    }

    fn write_map(&self, map: &ReferenceMap) -> Result<()> {
        let dir = config::state_dir(self.host, &self.settings);
        self.host.create_dir_all(&paths::slashes(&dir))?;
        self.host
            .write(&config::file_in(&dir, config::MAP_FILE), &map.to_json())?;
        Ok(())
    }

    /// Persistent ids of `items` of `file` (`file` already normalized), updating the map file.
    pub fn assign_ids(&self, file: &str, text: &str, items: &[ReviewItem]) -> Result<Vec<String>> {
        if items.is_empty() {
            return Ok(Vec::new());
        }
        let anns: Vec<_> = items.iter().map(|i| i.ann.clone()).collect();
        let assigned = refmap::assign_persistent_ids(file, text, &anns, &self.read_map()?);
        if let Some(map) = &assigned.write {
            self.write_map(map)?;
        }
        Ok(assigned.ids)
    }

    /// Ids that the display ids of `ids` are shortened over: every id of the
    /// project ([`refmap::project_ids`]), as the VS Code panel does, so both
    /// show the same short id. Read-only; call it after [`Self::assign_ids`].
    pub fn project_ids(&self, ids: &[String]) -> Result<Vec<String>> {
        Ok(refmap::project_ids(&self.read_map()?, ids))
    }
}
