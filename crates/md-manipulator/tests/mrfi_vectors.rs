//! Conformance of `mrfi` with the golden vectors generated from the TS
//! implementation (see `tests/vectors/mrfi/README.md`).

use md_manipulator::mrfi::*;
use serde_json::{Value, json};
use std::path::PathBuf;

fn load(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/vectors/mrfi")
        .join(format!("{name}.json"));
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path:?}: {e}"));
    serde_json::from_str(&text).expect("valid JSON")
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
        .collect()
}

fn s(v: &Value) -> &str {
    v.as_str().expect("string")
}

// ---- JSON <-> Mrfi (same shape as the generator's mrfiToJson) ----

fn fuzzy_to_json(f: &FuzzyHash) -> Value {
    let mut o = json!({ "hash": format!("{:016x}", f.hash) });
    if let Some(d) = f.max_distance {
        o["maxDistance"] = json!(d);
    }
    o
}

fn mrfi_to_json(m: &Mrfi) -> Value {
    let mut o = serde_json::Map::new();
    if let Some(a) = &m.anchor {
        o.insert("anchor".into(), json!(a));
    }
    if let Some(c) = &m.context {
        let mut ctx = serde_json::Map::new();
        if let Some(p) = &c.prefix {
            ctx.insert("prefix".into(), json!(p));
        }
        if let Some(p) = &c.suffix {
            ctx.insert("suffix".into(), json!(p));
        }
        o.insert("context".into(), Value::Object(ctx));
    }
    if let Some(h) = &m.document_hash {
        o.insert("documentHash".into(), fuzzy_to_json(h));
    }
    if let Some(h) = &m.exact_hash {
        o.insert(
            "exactHash".into(),
            json!({"algorithm": h.algorithm, "prefix": h.prefix}),
        );
    }
    if let Some(x) = m.extent {
        o.insert("extentSelector".into(), json!(x.as_str()));
    }
    if !m.extra.is_empty() {
        o.insert("extra".into(), json!(m.extra));
    }
    if let Some(h) = &m.heading_hash {
        o.insert("headingHash".into(), fuzzy_to_json(h));
    }
    if let Some(r) = &m.offset_range {
        o.insert(
            "offsetRange".into(),
            json!({"start": r.start, "end": r.end}),
        );
    }
    if let Some(h) = &m.passage_hash {
        o.insert("passageHash".into(), fuzzy_to_json(h));
    }
    if let Some(q) = &m.quote {
        o.insert("quote".into(), json!(q));
    }
    if let Some(r) = &m.range {
        o.insert(
            "range".into(),
            json!({"startLine": r.start_line, "startColumn": r.start_column,
                   "endLine": r.end_line, "endColumn": r.end_column}),
        );
    }
    if let Some(p) = &m.structural_path {
        o.insert("structuralPath".into(), json!(p));
    }
    Value::Object(o)
}

fn fuzzy_from_json(v: &Value) -> FuzzyHash {
    FuzzyHash {
        hash: u64::from_str_radix(s(&v["hash"]), 16).unwrap(),
        max_distance: v.get("maxDistance").map(|d| d.as_u64().unwrap()),
    }
}

fn mrfi_from_json(j: &Value) -> Mrfi {
    let mut m = Mrfi::default();
    for (k, v) in j.as_object().unwrap() {
        match k.as_str() {
            "anchor" => m.anchor = Some(s(v).to_owned()),
            "context" => {
                m.context = Some(Context {
                    prefix: v.get("prefix").map(|p| s(p).to_owned()),
                    suffix: v.get("suffix").map(|p| s(p).to_owned()),
                })
            }
            "documentHash" => m.document_hash = Some(fuzzy_from_json(v)),
            "exactHash" => {
                m.exact_hash = Some(HashSignal {
                    algorithm: s(&v["algorithm"]).to_owned(),
                    prefix: s(&v["prefix"]).to_owned(),
                })
            }
            "extentSelector" => m.extent = Extent::parse(s(v)),
            "extra" => {
                m.extra = v
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|p| (s(&p[0]).to_owned(), s(&p[1]).to_owned()))
                    .collect()
            }
            "headingHash" => m.heading_hash = Some(fuzzy_from_json(v)),
            "offsetRange" => {
                m.offset_range = Some(OffsetRange {
                    start: v["start"].as_u64().unwrap(),
                    end: v["end"].as_u64().unwrap(),
                })
            }
            "passageHash" => m.passage_hash = Some(fuzzy_from_json(v)),
            "quote" => m.quote = Some(s(v).to_owned()),
            "range" => {
                m.range = Some(SourceRange {
                    start_line: v["startLine"].as_u64().unwrap(),
                    start_column: v["startColumn"].as_u64().unwrap(),
                    end_line: v["endLine"].as_u64().unwrap(),
                    end_column: v["endColumn"].as_u64().unwrap(),
                })
            }
            "structuralPath" => m.structural_path = Some(s(v).to_owned()),
            other => panic!("unknown field {other}"),
        }
    }
    m
}

fn cbor_from_json(v: &Value) -> Cbor {
    match v {
        Value::Number(n) => Cbor::Uint(n.as_u64().unwrap()),
        Value::String(t) => Cbor::Text(t.clone()),
        Value::Array(a) => Cbor::Array(a.iter().map(cbor_from_json).collect()),
        Value::Object(o) => Cbor::Map(
            o["map"]
                .as_array()
                .unwrap()
                .iter()
                .map(|p| {
                    let key = match &p[0] {
                        Value::Number(n) => Key::Num(n.as_u64().unwrap()),
                        k => Key::Text(s(k).to_owned()),
                    };
                    (key, cbor_from_json(&p[1]))
                })
                .collect(),
        ),
        _ => panic!("unsupported"),
    }
}

fn cbor_to_json(v: &Cbor) -> Value {
    match v {
        Cbor::Uint(n) => json!(n),
        Cbor::Text(t) => json!(t),
        Cbor::Array(a) => Value::Array(a.iter().map(cbor_to_json).collect()),
        Cbor::Map(m) => json!({"map": m.iter().map(|(k, v)| {
            let key = match k { Key::Num(n) => json!(n), Key::Text(t) => json!(t) };
            json!([key, cbor_to_json(v)])
        }).collect::<Vec<_>>()}),
    }
}

/// `{ok: x}` or `{err: message}` as the generator writes them.
fn outcome<T>(r: Result<T, MrfiError>, f: impl Fn(T) -> Value) -> Value {
    match r {
        Ok(v) => json!({"ok": f(v)}),
        Err(e) => json!({"err": e.message()}),
    }
}

#[test]
fn text_vectors() {
    let v = load("text");
    for c in v["strings"].as_array().unwrap() {
        let input = s(&c["input"]);
        assert_eq!(
            normalize_for_compare(input),
            s(&c["normalized"]),
            "normalize {input:?}"
        );
        assert_eq!(json!(tokenize(input)), c["tokens"], "tokens {input:?}");
        assert_eq!(
            format!("{:016x}", xxh64(input)),
            s(&c["xxh64"]),
            "xxh64 {input:?}"
        );
        assert_eq!(xxh64_prefix(input, 8), s(&c["fh"]), "fh {input:?}");
        assert_eq!(sha256_prefix(input, 8), s(&c["sha256"]), "sha256 {input:?}");
        assert_eq!(
            format!("{:016x}", smh64(input)),
            s(&c["smh64"]),
            "smh64 {input:?}"
        );
    }
    for p in v["hamming"].as_array().unwrap() {
        let l = u64::from_str_radix(s(&p["left"]), 16).unwrap();
        let r = u64::from_str_radix(s(&p["right"]), 16).unwrap();
        assert_eq!(json!(hamming(l, r)), p["distance"]);
    }
}

#[test]
fn cbor_vectors() {
    let v = load("cbor");
    for c in v["encode"].as_array().unwrap() {
        let bytes = wire::encode(&cbor_from_json(&c["value"])).unwrap();
        assert_eq!(hex(&bytes), s(&c["hex"]), "encode {}", c["value"]);
    }
    for c in v["decode"].as_array().unwrap() {
        let got = outcome(wire::decode(&unhex(s(&c["hex"]))), |x| cbor_to_json(&x));
        let want = match c.get("err") {
            Some(e) => json!({"err": e}),
            None => json!({"ok": c["ok"]}),
        };
        assert_eq!(got, want, "decode {}", c["hex"]);
    }
    for c in v["varuint"].as_array().unwrap() {
        let n = c["value"].as_f64().unwrap() as u64;
        assert_eq!(hex(&wire::encode_var_uint(n).unwrap()), s(&c["hex"]));
    }
    for c in v["varuintDecode"].as_array().unwrap() {
        let got = wire::decode_var_uint(&unhex(s(&c["hex"])), 0);
        match c.get("err") {
            Some(e) => assert_eq!(got.unwrap_err().message(), s(e), "{}", c["hex"]),
            None => {
                let (value, next) = got.unwrap();
                assert_eq!(json!(value), c["value"], "{}", c["hex"]);
                assert_eq!(json!(next), c["next"]);
            }
        }
    }
    for c in v["base62"].as_array().unwrap() {
        let bytes = unhex(s(&c["hex"]));
        assert_eq!(wire::base62_encode(&bytes), s(&c["text"]), "{}", c["hex"]);
        if bytes.first().is_some_and(|&b| b != 0) {
            assert_eq!(wire::base62_decode(s(&c["text"])).unwrap(), bytes);
        }
    }
    for c in v["base62Decode"].as_array().unwrap() {
        let got = wire::base62_decode(s(&c["text"]));
        match c.get("err") {
            Some(e) => assert_eq!(got.unwrap_err().message(), s(e), "{}", c["text"]),
            None => assert_eq!(hex(&got.unwrap()), s(&c["hex"]), "{}", c["text"]),
        }
    }
    for c in v["hangul"].as_array().unwrap() {
        let bytes = unhex(s(&c["hex"]));
        assert_eq!(wire::hangul_encode(&bytes, 13), s(&c["bits13"]));
        assert_eq!(wire::hangul_encode(&bytes, 11), s(&c["bits11"]));
        assert_eq!(
            hex(&wire::hangul_decode(s(&c["bits13"]), 13).unwrap()),
            s(&c["dec13"])
        );
        assert_eq!(
            hex(&wire::hangul_decode(s(&c["bits11"]), 11).unwrap()),
            s(&c["dec11"])
        );
    }
    for c in v["envelopes"].as_array().unwrap() {
        let payload = unhex(s(&c["payload"]));
        let env = encode_envelope(&payload).unwrap();
        assert_eq!(hex(&env), s(&c["envelope"]));
        assert_eq!(hex(&wire::checksum24(&payload)), s(&c["checksum"]));
        let back = outcome(decode_envelope(&env), |b| json!(hex(&b)));
        assert_eq!(back, c["back"]);
    }
    for c in v["damaged"].as_array().unwrap() {
        let got = outcome(decode_envelope(&unhex(s(&c["envelope"]))), |b| {
            json!(hex(&b))
        });
        assert_eq!(got, c["result"], "{}", c["label"]);
    }
}

fn parse_outcome(r: Result<Option<Mrfi>, MrfiError>) -> Value {
    outcome(r, |m| m.as_ref().map_or(Value::Null, mrfi_to_json))
}

#[test]
fn codec_vectors() {
    let v = load("codec");
    for c in v["formats"].as_array().unwrap() {
        let m = mrfi_from_json(&c["mrfi"]);
        assert_eq!(format_mrfi(&m, Format::Debug).unwrap(), s(&c["debug"]));
        assert_eq!(
            format_mrfi(&m, Format::Base62).unwrap(),
            s(&c["base62"]),
            "{}",
            c["debug"]
        );
        assert_eq!(
            format_mrfi(&m, Format::Hangul).unwrap(),
            s(&c["hangul"]),
            "{}",
            c["debug"]
        );
        assert_eq!(hex(&encode_compact(&m).unwrap()), s(&c["compactHex"]));
        assert_eq!(
            parse_outcome(parse_reference(s(&c["debug"]))),
            c["parsedDebug"],
            "{}",
            c["debug"]
        );
        assert_eq!(
            parse_outcome(parse_reference(s(&c["base62"]))),
            c["parsedBase62"],
            "{}",
            c["debug"]
        );
        assert_eq!(
            parse_outcome(parse_reference(s(&c["hangul"]))),
            c["parsedHangul"],
            "{}",
            c["debug"]
        );
        assert_eq!(json!(must_understand_violations(&m)), c["violations"]);
    }
    for c in v["parse"]
        .as_array()
        .unwrap()
        .iter()
        .chain(v["legacy"].as_array().unwrap())
    {
        let reference = s(&c["ref"]);
        assert_eq!(
            parse_outcome(parse_reference(reference)),
            c["result"],
            "parse {reference:?}"
        );
        if let Some(p) = c.get("payload") {
            assert_eq!(
                compact_payload(reference).map_or(Value::Null, |p| json!(p)),
                *p
            );
        }
    }
}

// ------------------------------------------------------------ doc-level vectors

fn corpus_text(name: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/blackbox/fixtures/md-corpus")
        .join(name);
    std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{name}: {e}"))
}

fn vector_text(c: &Value) -> String {
    match c["text"].as_str() {
        Some(t) => t.to_owned(),
        None => corpus_text(s(&c["doc"])),
    }
}

fn num(x: f64) -> Value {
    if x.fract() == 0.0 && x.abs() < 1e15 {
        json!(x as i64)
    } else {
        json!(x)
    }
}

fn result_to_json(r: &ResolveResult) -> Value {
    let mut o = json!({
        "ref": r.reference,
        "status": r.status.as_str(),
        "confidence": num(r.confidence),
        "diagnostics": r.diagnostics,
    });
    if let Some(range) = &r.range {
        o["range"] = json!(range.format());
    }
    if let Some(a) = &r.anchor {
        o["anchor"] = json!(a);
    }
    if let Some(p) = &r.passage {
        o["passage"] = json!(p);
    }
    if let Some(c) = &r.candidates {
        o["candidates"] = Value::Array(
            c.iter()
                .map(|c| json!({"range": c.range.format(), "score": num(c.score), "reasons": c.reasons}))
                .collect(),
        );
    }
    if let Some(s) = &r.strong_signals {
        let mut m = serde_json::Map::new();
        for (name, on) in [
            ("exactHash", s.exact_hash),
            ("uniqueAnchor", s.unique_anchor),
            ("bothContext", s.both_context),
            ("witnessAgreement", s.witness_agreement),
        ] {
            if on {
                m.insert(name.into(), json!(true));
            }
        }
        o["strongSignals"] = Value::Object(m);
    }
    o
}

fn generate_outcome(c: &Value) -> Value {
    let doc = MrfiDoc::new(&vector_text(c));
    let format = match s(&c["format"]) {
        "debug" => Format::Debug,
        "base62" => Format::Base62,
        _ => Format::Hangul,
    };
    let profile = match s(&c["profile"]) {
        "min" => Profile::Min,
        "default" => Profile::Default,
        _ => Profile::Full,
    };
    let options = GenerateOptions {
        format,
        profile,
        quote: c["quote"].as_bool().unwrap_or(false),
        quote_max: c["quoteMax"].as_u64().unwrap_or(80) as usize,
        extent: c.get("extentSelector").and_then(|x| Extent::parse(s(x))),
    };
    let target = match c.get("sectionLine") {
        // The TS and Rust outlines differ for some documents: address the
        // heading by its line, not by its index.
        Some(line) => {
            let line = line.as_u64().unwrap() as usize;
            match doc.sections().iter().position(|s| s.line == line) {
                Some(i) => Target::Section(i),
                None => return json!({"err": format!("no heading on line {line}")}),
            }
        }
        None => {
            let r = &c["range"];
            Target::Range(SourceRange {
                start_line: r["startLine"].as_u64().unwrap(),
                start_column: r["startColumn"].as_u64().unwrap(),
                end_line: r["endLine"].as_u64().unwrap(),
                end_column: r["endColumn"].as_u64().unwrap(),
            })
        }
    };
    outcome(generate(&doc, target, &options), |r| json!(r))
}

fn generate_key(c: &Value) -> String {
    let target = match c.get("sectionLine") {
        Some(l) => format!("sec@L{l}"),
        None => {
            let r = &c["range"];
            format!(
                "r={}:{}-{}:{}",
                r["startLine"], r["startColumn"], r["endLine"], r["endColumn"]
            )
        }
    };
    format!(
        "{}|{target}|{}|{}|q={}|x={}",
        c["doc"].as_str().unwrap(),
        s(&c["format"]),
        s(&c["profile"]),
        c["quote"].as_bool().unwrap_or(false),
        c.get("extentSelector").map_or("-", |x| s(x)),
    )
}

fn resolve_outcome(c: &Value) -> Value {
    let doc = MrfiDoc::new(s(&c["text"]));
    let options = ResolveOptions {
        witness: c["witness"].as_str(),
        extent: None,
    };
    json!({"ok": result_to_json(&resolve(&doc, s(&c["ref"]), &options))})
}

fn resolve_key(c: &Value) -> String {
    format!(
        "{}|{}|w={}|{}",
        c["doc"].as_str().unwrap(),
        s(&c["mutation"]),
        c["witness"].as_str().unwrap_or("-"),
        s(&c["ref"])
    )
}

fn known_divergences() -> Value {
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/vectors/mrfi/divergences.json");
    std::fs::read_to_string(path)
        .map(|t| serde_json::from_str(&t).unwrap())
        .unwrap_or_else(|_| json!({"generate": {}, "resolve": {}}))
}

/// Fields that differ between two references (any encoding), by their debug key.
fn differing_fields(want: &str, got: &str) -> Vec<&'static str> {
    let (Ok(Some(a)), Ok(Some(b))) = (parse_reference(want), parse_reference(got)) else {
        return vec!["unparsable"];
    };
    let mut out = vec![];
    macro_rules! cmp {
        ($field:ident, $key:expr) => {
            if a.$field != b.$field {
                out.push($key);
            }
        };
    }
    cmp!(range, "r");
    cmp!(offset_range, "o");
    cmp!(structural_path, "p");
    cmp!(anchor, "a");
    cmp!(exact_hash, "fh");
    cmp!(heading_hash, "hh");
    cmp!(passage_hash, "ph");
    cmp!(context, "ctx");
    cmp!(document_hash, "doc");
    cmp!(quote, "q");
    cmp!(extent, "x");
    out
}

/// Runs every vector of `kind`; vectors listed in `divergences.json` must
/// still differ (so the list cannot rot), all others must match. A listed
/// generation vector for a range may only differ in `p`, `hh` and `a`: the
/// evidence of the passage itself (`r o fh ph ctx doc q`) is section-free.
/// With `MRFI_VECTORS_REPORT=<file>` the observed divergences are written instead.
fn check_doc_vectors(kind: &str, key: fn(&Value) -> String, run: fn(&Value) -> Value) {
    let vectors = load(kind);
    let known = known_divergences();
    let known = known[kind].as_object().cloned().unwrap_or_default();
    let mut observed = serde_json::Map::new();
    let (mut unexpected, mut fixed, mut overreach) = (vec![], vec![], vec![]);
    for c in vectors.as_array().unwrap() {
        let got = run(c);
        let ok = got == c["result"];
        let key = key(c);
        if !ok {
            observed.insert(
                key.clone(),
                json!({"doc": c["doc"], "want": c["result"], "got": got}),
            );
            if kind == "generate"
                && c.get("range").is_some()
                && known.contains_key(&key)
                && let (Some(w), Some(g)) = (c["result"]["ok"].as_str(), got["ok"].as_str())
                && differing_fields(w, g)
                    .iter()
                    .any(|f| !["p", "hh", "a"].contains(f))
            {
                overreach.push(key.clone());
            }
        }
        match (ok, known.contains_key(&key)) {
            (false, false) => unexpected.push(key),
            (true, true) => fixed.push(key),
            _ => {}
        }
    }
    if let Ok(path) = std::env::var("MRFI_VECTORS_REPORT") {
        std::fs::write(
            format!("{path}.{kind}.json"),
            serde_json::to_string_pretty(&Value::Object(observed)).unwrap(),
        )
        .unwrap();
        return;
    }
    assert!(
        unexpected.is_empty() && fixed.is_empty() && overreach.is_empty(),
        "{kind}: unexpected divergences {:?}; listed ones that now match {:?}; \
         range vectors differing beyond p/hh/a {:?}",
        &unexpected[..unexpected.len().min(10)],
        &fixed[..fixed.len().min(10)],
        &overreach[..overreach.len().min(10)],
    );
}

#[test]
fn generate_vectors() {
    check_doc_vectors("generate", generate_key, generate_outcome);
}

#[test]
fn resolve_vectors() {
    check_doc_vectors("resolve", resolve_key, resolve_outcome);
}
