//! Reference string <-> [`Mrfi`] struct: debug form (`~{v0;...}`) and the
//! compact envelope carried as base62 or Hangul.

use super::MrfiError;
use super::cbor::{self, Cbor, Key, MAGIC};
use super::text::{HashSignal, is_js_whitespace};

/// A 1-based `line:column` span with an exclusive end column. **Columns count
/// Unicode scalar values** (not UTF-16 units, not bytes).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SourceRange {
    /// 1-based first line.
    pub start_line: u64,
    /// 1-based first column, in scalar values.
    pub start_column: u64,
    /// 1-based last line.
    pub end_line: u64,
    /// 1-based end column (exclusive), in scalar values.
    pub end_column: u64,
}

impl SourceRange {
    /// `startLine:startColumn-endLine:endColumn`, the `r=` syntax.
    pub fn format(&self) -> String {
        format!(
            "{}:{}-{}:{}",
            self.start_line, self.start_column, self.end_line, self.end_column
        )
    }

    /// Parses the `r=` syntax; also validates the shape (see [`Self::is_valid_shape`]).
    pub fn parse(value: &str) -> Option<Self> {
        let (a, b) = value.split_once('-')?;
        let (sl, sc) = a.split_once(':')?;
        let (el, ec) = b.split_once(':')?;
        let range = Self {
            start_line: parse_digits(sl)?,
            start_column: parse_digits(sc)?,
            end_line: parse_digits(el)?,
            end_column: parse_digits(ec)?,
        };
        range.is_valid_shape().then_some(range)
    }

    /// One-based, ordered, and at least one column wide on a single line.
    pub fn is_valid_shape(&self) -> bool {
        if self.start_line < 1 || self.start_column < 1 || self.end_line < 1 || self.end_column < 1
        {
            return false;
        }
        if self.end_line < self.start_line {
            return false;
        }
        self.end_line != self.start_line || self.end_column > self.start_column
    }
}

/// Digits only (ASCII), saturating on overflow like a JS number would lose precision.
fn parse_digits(s: &str) -> Option<u64> {
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some(s.parse().unwrap_or(u64::MAX))
}

/// Offsets of the passage at generation time, `start..end` (end exclusive),
/// counted in **Unicode scalar values** of the LF-normalized document.
/// (The spec says UTF-8 bytes; the TS implementation, which this follows,
/// counts scalar values.)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OffsetRange {
    /// First offset.
    pub start: u64,
    /// Exclusive end offset.
    pub end: u64,
}

/// Fuzzy smh64 field (`hh`, `ph`, `doc`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FuzzyHash {
    /// The 64-bit simhash.
    pub hash: u64,
    /// Acceptance distance carried by the reference, if any.
    pub max_distance: Option<u64>,
}

/// `ctx`: hashes of the text windows before and after the passage.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Context {
    /// Base62 prefix of the window before the passage.
    pub prefix: Option<String>,
    /// Base62 prefix of the window after the passage.
    pub suffix: Option<String>,
}

/// Extent selector of a scope reference (`x`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Extent {
    /// The heading and its whole section.
    Sec,
    /// The section without its heading.
    Body,
    /// The section up to the first sub-heading.
    Lead,
}

impl Extent {
    /// `sec`, `body` or `lead`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Sec => "sec",
            Self::Body => "body",
            Self::Lead => "lead",
        }
    }

    /// Inverse of [`Self::as_str`].
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "sec" => Some(Self::Sec),
            "body" => Some(Self::Body),
            "lead" => Some(Self::Lead),
            _ => None,
        }
    }
}

/// The decoded locator: every evidence field of a reference.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Mrfi {
    /// `a`: stable anchor id.
    pub anchor: Option<String>,
    /// `ctx`.
    pub context: Option<Context>,
    /// `doc`: fuzzy hash of the whole document.
    pub document_hash: Option<FuzzyHash>,
    /// `fh`.
    pub exact_hash: Option<HashSignal>,
    /// `x`.
    pub extent: Option<Extent>,
    /// Unknown and `_` extension fields, in order of appearance.
    pub extra: Vec<(String, String)>,
    /// `hh`: fuzzy hash of the enclosing heading scope.
    pub heading_hash: Option<FuzzyHash>,
    /// `o`.
    pub offset_range: Option<OffsetRange>,
    /// `ph`.
    pub passage_hash: Option<FuzzyHash>,
    /// `q`.
    pub quote: Option<String>,
    /// `r`.
    pub range: Option<SourceRange>,
    /// `p`.
    pub structural_path: Option<String>,
}

/// Compact encodings of a reference.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    /// `~{v0;key=value;...}`.
    Debug,
    /// `~` + base62.
    Base62,
    /// `~` + Hangul (default for storage).
    Hangul,
}

/// Field keys of `v0`: any other non-`_` key makes a locator invalid at resolution.
const KNOWN_KEYS: [&str; 11] = ["r", "o", "p", "a", "fh", "hh", "ph", "ctx", "doc", "q", "x"];

/// Extra keys that are neither extension (`_`) nor known: the locator must be rejected.
pub fn must_understand_violations(mrfi: &Mrfi) -> Vec<String> {
    mrfi.extra
        .iter()
        .map(|(k, _)| k)
        .filter(|k| !k.starts_with('_') && !KNOWN_KEYS.contains(&k.as_str()))
        .cloned()
        .collect()
}

fn invalid(message: impl Into<String>) -> MrfiError {
    MrfiError::new(message)
}

/// Parses a `~...` reference in any encoding. `Ok(None)` means "not an MRFI
/// reference we understand" (the caller reports `unsupported`), an error means
/// a malformed one.
pub fn parse_reference(reference: &str) -> Result<Option<Mrfi>, MrfiError> {
    if let Some(parsed) = parse_debug(reference)? {
        return Ok(Some(parsed));
    }
    let Some(payload) = compact_payload(reference).filter(|p| !p.is_empty()) else {
        return Ok(None);
    };
    if !is_hangul_payload(payload) {
        let envelope = decode_envelope(&cbor::base62_decode(payload)?)?;
        return decode_compact(&envelope);
    }
    // The 11-bit window is a subset of the 13-bit one, so a legacy payload
    // looks like a current one; the envelope (magic, version, checksum)
    // discriminates. Current width first so that a corrupt current reference
    // reports its own error.
    let attempt = |bits| -> Result<Option<Mrfi>, MrfiError> {
        decode_compact(&decode_envelope(&cbor::hangul_decode(payload, bits)?)?)
    };
    match attempt(dz_encodings::hangul::BITS) {
        Ok(v) => Ok(v),
        Err(first) => attempt(dz_encodings::hangul::LEGACY_BITS).map_err(|_| first),
    }
}

/// The text after `~` (inside the braces for `~{...}`), `None` without the sigil.
pub fn compact_payload(reference: &str) -> Option<&str> {
    let rest = reference.strip_prefix('~')?;
    if rest.starts_with('{') && reference.ends_with('}') && reference.len() >= 3 {
        return Some(&reference[2..reference.len() - 1]);
    }
    Some(rest)
}

fn is_hangul_payload(payload: &str) -> bool {
    let base = 0xac00u32;
    payload.chars().next().is_some_and(|c| {
        (base..=base + (1 << dz_encodings::hangul::BITS) - 1).contains(&(c as u32))
    })
}

/// Encodes in the requested format.
pub fn format_mrfi(mrfi: &Mrfi, format: Format) -> Result<String, MrfiError> {
    if format == Format::Debug {
        return Ok(serialize_debug(mrfi));
    }
    let envelope = encode_envelope(&encode_compact(mrfi)?)?;
    Ok(match format {
        Format::Base62 => format!("~{}", cbor::base62_encode(&envelope)),
        _ => format!(
            "~{}",
            cbor::hangul_encode(&envelope, dz_encodings::hangul::BITS)
        ),
    })
}

// ---------------------------------------------------------------- debug form

fn decode_debug_value(value: &str) -> Result<String, MrfiError> {
    let malformed = || {
        invalid(format!(
            "malformed percent-encoding in MRFI debug value: {value}"
        ))
    };
    if !value.contains('%') {
        return Ok(value.to_owned());
    }
    let bytes = value.as_bytes();
    let hex = |i: usize| -> Option<u8> {
        let pair = bytes.get(i + 1..i + 3)?;
        u8::from_str_radix(std::str::from_utf8(pair).ok()?, 16).ok()
    };
    let mut out: Vec<u8> = vec![];
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'%' {
            out.push(bytes[i]);
            i += 1;
            continue;
        }
        let lead = hex(i).ok_or_else(malformed)?;
        let count = match lead {
            0x00..=0x7f => 1,
            0xc0..=0xdf => 2,
            0xe0..=0xef => 3,
            0xf0..=0xf7 => 4,
            _ => return Err(malformed()),
        };
        let mut chunk = vec![lead];
        i += 3;
        for _ in 1..count {
            if bytes.get(i) != Some(&b'%') {
                return Err(malformed());
            }
            chunk.push(hex(i).ok_or_else(malformed)?);
            i += 3;
        }
        if std::str::from_utf8(&chunk).is_err() {
            return Err(malformed());
        }
        out.extend(chunk);
    }
    String::from_utf8(out).map_err(|_| malformed())
}

fn encode_debug_value(value: &str) -> String {
    let mut out = String::new();
    for c in value.chars() {
        if c == '%' || c == ';' || c == '}' || is_js_whitespace(c) {
            let mut buf = [0u8; 4];
            for b in c.encode_utf8(&mut buf).bytes() {
                out.push_str(&format!("%{b:02X}"));
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn serialize_smh64(key: &str, f: &FuzzyHash) -> String {
    let threshold = f.max_distance.map_or(String::new(), |d| format!("/{d}"));
    format!("{key}=smh64:{:016x}{threshold}", f.hash)
}

/// The `~{v0;...}` form. Empty strings count as absent, as in the TS encoder.
pub fn serialize_debug(m: &Mrfi) -> String {
    let mut fields = vec!["v0".to_owned()];
    if let Some(r) = &m.range {
        fields.push(format!("r={}", r.format()));
    }
    if let Some(o) = &m.offset_range {
        fields.push(format!("o={}-{}", o.start, o.end));
    }
    if let Some(p) = m.structural_path.as_deref().filter(|s| !s.is_empty()) {
        fields.push(format!("p={}", encode_debug_value(p)));
    }
    if let Some(a) = m.anchor.as_deref().filter(|s| !s.is_empty()) {
        fields.push(format!("a={}", encode_debug_value(a)));
    }
    if let Some(h) = &m.exact_hash {
        fields.push(format!("fh={}:{}", h.algorithm, h.prefix));
    }
    if let Some(h) = &m.heading_hash {
        fields.push(serialize_smh64("hh", h));
    }
    if let Some(h) = &m.passage_hash {
        fields.push(serialize_smh64("ph", h));
    }
    if let Some(c) = &m.context {
        let mut parts = vec![];
        if let Some(p) = c.prefix.as_deref().filter(|s| !s.is_empty()) {
            parts.push(format!("pre:{p}"));
        }
        if let Some(s) = c.suffix.as_deref().filter(|s| !s.is_empty()) {
            parts.push(format!("suf:{s}"));
        }
        if !parts.is_empty() {
            fields.push(format!("ctx={}", parts.join(",")));
        }
    }
    if let Some(h) = &m.document_hash {
        fields.push(serialize_smh64("doc", h));
    }
    if let Some(q) = m.quote.as_deref().filter(|s| !s.is_empty()) {
        fields.push(format!("q={}", encode_debug_value(q)));
    }
    if let Some(x) = m.extent {
        fields.push(format!("x={}", x.as_str()));
    }
    for (k, v) in &m.extra {
        fields.push(format!("{k}={}", encode_debug_value(v)));
    }
    format!("~{{{}}}", fields.join(";"))
}

fn parse_smh64(value: &str) -> Option<FuzzyHash> {
    let rest = value
        .get(..6)
        .filter(|p| p.eq_ignore_ascii_case("smh64:"))
        .map(|_| &value[6..])?;
    let (hex, threshold) = match rest.split_once('/') {
        Some((h, t)) => (h, Some(t)),
        None => (rest, None),
    };
    if hex.len() != 16 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let max_distance = match threshold {
        None => None,
        Some(t) => Some(parse_digits(t)?),
    };
    Some(FuzzyHash {
        hash: u64::from_str_radix(hex, 16).ok()?,
        max_distance,
    })
}

fn parse_hash_signal(value: &str) -> Option<HashSignal> {
    let (algorithm, prefix) = value.split_once(':')?;
    (!algorithm.is_empty() && !prefix.is_empty()).then(|| HashSignal {
        algorithm: algorithm.to_owned(),
        prefix: prefix.to_owned(),
    })
}

fn parse_context(value: &str) -> Option<Context> {
    let (mut prefix, mut suffix) = (None, None);
    for part in value.split(',') {
        let Some((key, v)) = part.split_once(':') else {
            continue;
        };
        match key {
            "pre" => prefix = Some(v.to_owned()),
            "suf" => suffix = Some(v.to_owned()),
            _ => {}
        }
    }
    let truthy = |o: &Option<String>| o.as_deref().is_some_and(|s| !s.is_empty());
    (truthy(&prefix) || truthy(&suffix)).then_some(Context { prefix, suffix })
}

fn parse_offset_range(value: &str) -> Option<OffsetRange> {
    let (a, b) = value.split_once('-')?;
    let (start, end) = (parse_digits(a)?, parse_digits(b)?);
    (end > start).then_some(OffsetRange { start, end })
}

/// Parses the debug form. `Ok(None)` when `reference` is not `~{v0;...}`.
pub fn parse_debug(reference: &str) -> Result<Option<Mrfi>, MrfiError> {
    if !reference.starts_with("~{") || !reference.ends_with('}') || reference.len() < 3 {
        return Ok(None);
    }
    let payload = &reference[2..reference.len() - 1];
    let mut fields = payload.split(';');
    if fields.next() != Some("v0") {
        return Ok(None);
    }
    let mut m = Mrfi::default();
    let mut seen: Vec<&str> = vec![];
    for field in fields {
        let (key, raw) = field
            .split_once('=')
            .ok_or_else(|| invalid(format!("Malformed MRFI debug field: {field}")))?;
        if seen.contains(&key) {
            return Err(invalid(format!("duplicate MRFI field: {key}")));
        }
        seen.push(key);
        if key.starts_with('!') {
            return Err(invalid(format!("unsupported mandatory MRFI field: {key}")));
        }
        let value = decode_debug_value(raw)?;
        match key {
            "a" => m.anchor = Some(value),
            "ctx" => {
                m.context = Some(
                    parse_context(&value)
                        .ok_or_else(|| invalid(format!("Malformed MRFI context: {value}")))?,
                );
            }
            "doc" => m.document_hash = Some(parse_smh64(&value).ok_or_else(|| smh64_error(field))?),
            "fh" => {
                m.exact_hash = Some(
                    parse_hash_signal(&value)
                        .ok_or_else(|| invalid(format!("Malformed MRFI hash: {field}")))?,
                );
            }
            "hh" => m.heading_hash = Some(parse_smh64(&value).ok_or_else(|| smh64_error(field))?),
            "o" => {
                m.offset_range = Some(
                    parse_offset_range(&value)
                        .ok_or_else(|| invalid(format!("Malformed MRFI offset range: {value}")))?,
                );
            }
            "p" => m.structural_path = Some(value),
            "ph" => m.passage_hash = Some(parse_smh64(&value).ok_or_else(|| smh64_error(field))?),
            "q" => m.quote = Some(value),
            "r" => {
                m.range = Some(
                    SourceRange::parse(&value)
                        .ok_or_else(|| invalid(format!("Malformed MRFI range: {value}")))?,
                );
            }
            "x" => {
                m.extent =
                    Some(Extent::parse(&value).ok_or_else(|| {
                        invalid(format!("invalid MRFI extent selector: {value}"))
                    })?);
            }
            _ => m.extra.push((key.to_owned(), value)),
        }
    }
    Ok(Some(m))
}

fn smh64_error(field: &str) -> MrfiError {
    invalid(format!("Malformed MRFI smh64: {field}"))
}

// ------------------------------------------------------------- compact form

const FH_DEFAULT: &str = "xxh64";

fn algorithm_code(name: &str) -> Option<u64> {
    match name {
        "sha256" => Some(1),
        "xxh64" => Some(2),
        _ => None,
    }
}

fn text(s: &str) -> Cbor {
    Cbor::Text(s.to_owned())
}

fn compact_smh64(f: &FuzzyHash) -> Cbor {
    let mut items = vec![Cbor::Text(format!("{:016x}", f.hash))];
    if let Some(d) = f.max_distance {
        items.push(Cbor::Uint(d));
    }
    Cbor::Array(items)
}

/// CBOR payload of a reference (before the envelope).
pub fn encode_compact(m: &Mrfi) -> Result<Vec<u8>, MrfiError> {
    let num = |n: u64| Key::Num(n);
    let mut entries: Vec<(Key, Cbor)> = vec![(num(0), Cbor::Uint(0))];
    if let Some(a) = m.anchor.as_deref().filter(|s| !s.is_empty()) {
        entries.push((num(1), text(a)));
    }
    if let Some(r) = &m.range {
        entries.push((
            num(2),
            Cbor::Array(
                [r.start_line, r.start_column, r.end_line, r.end_column]
                    .map(Cbor::Uint)
                    .to_vec(),
            ),
        ));
    }
    if let Some(p) = m.structural_path.as_deref().filter(|s| !s.is_empty()) {
        entries.push((num(3), text(p)));
    }
    if let Some(h) = &m.exact_hash {
        let value = if h.algorithm == FH_DEFAULT {
            text(&h.prefix)
        } else {
            let tag = algorithm_code(&h.algorithm).map_or_else(|| text(&h.algorithm), Cbor::Uint);
            Cbor::Array(vec![tag, text(&h.prefix)])
        };
        entries.push((num(4), value));
    }
    if let Some(h) = &m.heading_hash {
        entries.push((num(5), compact_smh64(h)));
    }
    if let Some(c) = &m.context {
        entries.push((
            num(6),
            Cbor::Array(vec![
                text(c.prefix.as_deref().unwrap_or("")),
                text(c.suffix.as_deref().unwrap_or("")),
            ]),
        ));
    }
    if let Some(q) = m.quote.as_deref().filter(|s| !s.is_empty()) {
        entries.push((num(7), text(q)));
    }
    if let Some(h) = &m.document_hash {
        entries.push((num(8), compact_smh64(h)));
    }
    if let Some(o) = &m.offset_range {
        entries.push((
            num(9),
            Cbor::Array(vec![Cbor::Uint(o.start), Cbor::Uint(o.end)]),
        ));
    }
    if let Some(h) = &m.passage_hash {
        entries.push((num(10), compact_smh64(h)));
    }
    if let Some(x) = m.extent {
        let code = match x {
            Extent::Sec => 0,
            Extent::Body => 1,
            Extent::Lead => 2,
        };
        entries.push((num(11), Cbor::Uint(code)));
    }
    for (k, v) in &m.extra {
        entries.push((Key::Text(k.clone()), text(v)));
    }
    cbor::encode(&Cbor::Map(entries))
}

fn get(entries: &[(Key, Cbor)], key: u64) -> Option<&Cbor> {
    entries
        .iter()
        .find(|(k, _)| *k == Key::Num(key))
        .map(|(_, v)| v)
}

fn as_text(v: Option<&Cbor>) -> Option<String> {
    match v {
        Some(Cbor::Text(s)) => Some(s.clone()),
        _ => None,
    }
}

fn decode_compact_hash(v: Option<&Cbor>) -> Option<HashSignal> {
    match v? {
        Cbor::Text(prefix) => Some(HashSignal {
            algorithm: FH_DEFAULT.to_owned(),
            prefix: prefix.clone(),
        }),
        Cbor::Array(items) if items.len() == 2 => {
            let Cbor::Text(prefix) = &items[1] else {
                return None;
            };
            let algorithm = match &items[0] {
                Cbor::Uint(1) => "sha256".to_owned(),
                Cbor::Uint(2) => "xxh64".to_owned(),
                Cbor::Text(t) => t.clone(),
                _ => return None,
            };
            Some(HashSignal {
                algorithm,
                prefix: prefix.clone(),
            })
        }
        _ => None,
    }
}

fn decode_compact_fuzzy(v: Option<&Cbor>) -> Option<FuzzyHash> {
    let Cbor::Array(items) = v? else { return None };
    if items.is_empty() || items.len() > 2 {
        return None;
    }
    let Cbor::Text(hex) = &items[0] else {
        return None;
    };
    if hex.len() != 16 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let max_distance = match items.get(1) {
        None => None,
        Some(Cbor::Uint(d)) => Some(*d),
        Some(_) => return None,
    };
    Some(FuzzyHash {
        hash: u64::from_str_radix(hex, 16).ok()?,
        max_distance,
    })
}

/// JS `JSON.stringify` of a value the TS reader produced (extension values
/// that are not text are stored as their JSON, maps as `{kind, entries}`).
fn json_of(v: &Cbor) -> String {
    match v {
        Cbor::Uint(n) => n.to_string(),
        Cbor::Text(s) => json_string(s),
        Cbor::Array(items) => format!(
            "[{}]",
            items.iter().map(json_of).collect::<Vec<_>>().join(",")
        ),
        Cbor::Map(entries) => format!(
            "{{\"kind\":\"map\",\"entries\":[{}]}}",
            entries
                .iter()
                .map(|(k, v)| {
                    let key = match k {
                        Key::Num(n) => n.to_string(),
                        Key::Text(s) => json_string(s),
                    };
                    format!("[{key},{}]", json_of(v))
                })
                .collect::<Vec<_>>()
                .join(",")
        ),
    }
}

fn json_string(s: &str) -> String {
    let mut out = String::from('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Decodes a CBOR payload. `Ok(None)` for a payload that is not a v0 map.
pub fn decode_compact(payload: &[u8]) -> Result<Option<Mrfi>, MrfiError> {
    let Cbor::Map(entries) = cbor::decode(payload)? else {
        return Ok(None);
    };
    if get(&entries, 0) != Some(&Cbor::Uint(0)) {
        return Ok(None);
    }
    let mut m = Mrfi {
        anchor: as_text(get(&entries, 1)),
        structural_path: as_text(get(&entries, 3)),
        exact_hash: decode_compact_hash(get(&entries, 4)),
        heading_hash: decode_compact_fuzzy(get(&entries, 5)),
        quote: as_text(get(&entries, 7)),
        document_hash: decode_compact_fuzzy(get(&entries, 8)),
        passage_hash: decode_compact_fuzzy(get(&entries, 10)),
        ..Mrfi::default()
    };
    if let Some(Cbor::Array(items)) = get(&entries, 2)
        && let [Cbor::Uint(a), Cbor::Uint(b), Cbor::Uint(c), Cbor::Uint(d)] = items.as_slice()
    {
        let range = SourceRange {
            start_line: *a,
            start_column: *b,
            end_line: *c,
            end_column: *d,
        };
        if !range.is_valid_shape() {
            return Err(invalid("invalid compact MRFI range"));
        }
        m.range = Some(range);
    }
    if let Some(Cbor::Array(items)) = get(&entries, 6)
        && let [Cbor::Text(prefix), Cbor::Text(suffix)] = items.as_slice()
    {
        m.context = Some(Context {
            prefix: (!prefix.is_empty()).then(|| prefix.clone()),
            suffix: (!suffix.is_empty()).then(|| suffix.clone()),
        });
    }
    if let Some(Cbor::Array(items)) = get(&entries, 9)
        && let [Cbor::Uint(start), Cbor::Uint(end)] = items.as_slice()
    {
        if end <= start {
            return Err(invalid("invalid compact MRFI offset range"));
        }
        m.offset_range = Some(OffsetRange {
            start: *start,
            end: *end,
        });
    }
    if let Some(Cbor::Uint(code)) = get(&entries, 11) {
        m.extent = Some(match code {
            0 => Extent::Sec,
            1 => Extent::Body,
            2 => Extent::Lead,
            _ => {
                return Err(invalid(format!(
                    "invalid MRFI extent selector code: {code}"
                )));
            }
        });
    }
    for (key, value) in &entries {
        let Key::Text(k) = key else { continue };
        let v = match value {
            Cbor::Text(s) => s.clone(),
            other => json_of(other),
        };
        match m.extra.iter_mut().find(|(ek, _)| ek == k) {
            Some(slot) => slot.1 = v,
            None => m.extra.push((k.clone(), v)),
        }
    }
    Ok(Some(m))
}

/// `MRFI` + version 0 + varuint length + payload + 3-byte checksum.
pub fn encode_envelope(payload: &[u8]) -> Result<Vec<u8>, MrfiError> {
    let mut out = MAGIC.to_vec();
    out.push(0);
    out.extend(cbor::encode_var_uint(payload.len() as u64)?);
    out.extend_from_slice(payload);
    let check = cbor::checksum24(&out);
    out.extend_from_slice(&check);
    Ok(out)
}

/// Validates magic, version, length, zero padding and checksum; returns the payload.
pub fn decode_envelope(envelope: &[u8]) -> Result<Vec<u8>, MrfiError> {
    if envelope.len() < MAGIC.len() + 1 + 3 {
        return Err(invalid("Invalid compact MRFI envelope"));
    }
    if &envelope[..MAGIC.len()] != MAGIC {
        return Err(invalid("Invalid compact MRFI magic"));
    }
    if envelope[MAGIC.len()] != 0 {
        return Err(invalid("Unsupported compact MRFI version"));
    }
    let (length, start) = cbor::decode_var_uint(envelope, MAGIC.len() + 1)?;
    let end = usize::try_from(length)
        .ok()
        .and_then(|l| start.checked_add(l))
        .filter(|e| e.checked_add(3).is_some_and(|c| c <= envelope.len()))
        .ok_or_else(|| invalid("Invalid compact MRFI length"))?;
    let check_end = end + 3;
    if envelope[check_end..].iter().any(|&b| b != 0) {
        return Err(invalid("Invalid compact MRFI padding"));
    }
    if cbor::checksum24(&envelope[..end]) != envelope[end..check_end] {
        return Err(invalid("Invalid compact MRFI checksum"));
    }
    Ok(envelope[start..end].to_vec())
}
