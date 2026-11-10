//! Worklog model: task files, index, text formatting and agent prompts.
//! Performs no I/O and builds for wasm32.

pub mod agent;
pub mod error;
pub mod format;
pub mod index;
pub mod json;
pub mod ordered;
pub mod output;
pub mod taskfile;
pub mod time;
pub mod types;
pub mod yaml;
