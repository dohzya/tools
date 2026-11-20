use sha2::{Digest, Sha256};

/// Section id. The TS service is named "Blake3" for historical reasons; the
/// algorithm is SHA-256 over `level:title.lowercase().trim():occurrence`.
pub fn section_id(level: usize, title: &str, occurrence: usize) -> String {
    let input = format!("{level}:{}:{occurrence}", title.to_lowercase().trim());
    let digest = Sha256::digest(input.as_bytes());
    digest[..4].iter().map(|b| format!("{b:02x}")).collect()
}

/// Whether `s` looks like a section id (8 hex characters, any case).
pub fn is_valid_id(s: &str) -> bool {
    s.len() == 8 && s.bytes().all(|b| b.is_ascii_hexdigit())
}
