//! Review syntax scanner, stable item ids, reference map, timestamps and
//! agent states. Performs no I/O (clock, files and git are injected by the
//! host) so that it builds for wasm32.
//!
//! All offsets are UTF-8 byte offsets into the text given by the caller; the
//! wasm facade converts them to UTF-16 for JavaScript hosts. Ids hash UTF-16
//! code units (see [`ids`]) so they match the historical TypeScript values.

pub mod actions;
pub mod agent;
pub mod ids;
pub mod refmap;
pub mod refs;
pub mod review;
pub mod scan;
pub mod sha1;
pub mod state;
pub mod timestamp;
