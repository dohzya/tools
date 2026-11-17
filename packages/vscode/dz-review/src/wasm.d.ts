// Built by `task vscode:dz-review:wasm`; esbuild inlines `.wasm` imports as
// bytes (`--loader:.wasm=binary`).
declare module "*.wasm" {
  const bytes: Uint8Array;
  export default bytes;
}

// wasm-bindgen glue of crates/critique-wasm, generated without its own
// declarations: they require DOM types and shadow the bytes import above.
declare module "*/critique_wasm.js" {
  export function initSync(options: { module: Uint8Array }): unknown;
  export function reviewItems(
    file: string,
    text: string,
    mapJson: string | null,
    summarySource: string,
    summaryWidth: number,
  ): string;
  export function stateDir(base: string | null, configured: string[]): string;
}
