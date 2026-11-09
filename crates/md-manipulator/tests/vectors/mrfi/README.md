# MRFI golden vectors

Expected outputs of the **TypeScript** MRFI implementation (`packages/tools/markdown-surgeon/domain/use-cases/mrfi-*.ts`, `generate-reference.ts`, `resolve-reference.ts`, run by Deno). The Deno code at the commit that introduced these files is the **frozen reference**: do not regenerate the files after the TS changes, and never edit them by hand. A Rust change that breaks a vector must be explained, not "fixed" by regeneration.

Consumed by `crates/md-manipulator/tests/mrfi_vectors.rs`. The same crate vectors will be reused by the VS Code extension (wasm) and the `critique` CLI to prove identical references and resolutions.

| File               | Layer                                 | Content                                                                                                                                                                                                           |
| ------------------ | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text.json`        | text normalization and hashes         | per input string: `normalizeForCompare`, `tokenizeForSmh64`, `xxh64`, `fh` prefix, `ctx` SHA-256 prefix, `smh64`; plus Hamming distances                                                                          |
| `cbor.json`        | CBOR subset, payload codecs, envelope | encode / decode (valid and malformed), varuint, base62 and Hangul (13 and 11 bits) payloads, envelope encode/decode and damaged envelopes                                                                         |
| `codec.json`       | reference strings                     | `DebugMrfi` structs to debug / base62 / hangul strings and back, compact CBOR hex, `parseMrfiReference` on valid, malformed and corrupt references, legacy 11-bit Hangul, percent-encoding of debug values        |
| `generate.json`    | generation                            | `GenerateReferenceUseCase` on the 80-file corpus (`tests/blackbox/fixtures/md-corpus`) and 11 custom documents: sections (3 profiles, 3 formats, quote, `x` extents) and ranges (valid and invalid)               |
| `resolve.json`     | resolution                            | `ResolveReferenceUseCase` on references generated above, resolved against mutated documents (identity, insertion, deletion, typo, case, tail, duplicate, rewrite, empty, CRLF), with and without witness; anchors |
| `divergences.json` | expected differences                  | index (in `generate.json` / `resolve.json`) to the reason why the Rust output deliberately differs; see below                                                                                                     |

## How they were generated

A Deno script kept outside the repository (it imports the TS use cases directly) wrote them with fixed inputs and a fixed PRNG seed (mulberry32, seed `20261103`):

- text inputs: ~50 hand-written edge cases (empty, whitespace kinds including NBSP, U+FEFF, U+0085, U+2028; NFC / NFD; `İ`, `ß`, final sigma, ligatures; emoji and ZWJ sequences; CJK; Hangul; RTL; separators) and 150 random strings over a mixed alphabet;
- codec structs: 250 random field subsets (known hash tags, unknown tags, extension fields with astral keys, quotes with `;`, `}`, `%`, whitespace);
- documents: the corpus and the custom documents of `generate.json` (the `text` key is present for the custom ones). Documents are LF-normalized before being given to the TS (the spec requires it; the TS CLI does not do it, see the report on the CRLF cases);
- mutations for `resolve.json` are listed in each vector (`mutation`).

Values are the TS results as JSON: bigints as 16 hex digits, errors as `{ "err": message }`, results as `{ "ok": ... }`. Resolution results are `ResolveResult` objects; `range` is the `line:col` string.

## Expected differences (`divergences.json`)

Vectors listed there **must still differ**: the test fails if one starts to match (the list must not rot) or if an unlisted one differs. Every entry is one of:

- a new section rule of `docs/specs/markdown-sections.md` changes which headings exist (fences, HTML blocks, setext, empty ATX, indentation, frontmatter), hence the structural path `p`, the section ranges, `hh`;
- the TS computes block ranges with UTF-16 columns used as scalar offsets, so an astral character (emoji) before the end of a block inflates it.
