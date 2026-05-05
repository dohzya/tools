import { assertEquals } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";
import { MarkdownSurgeonAdapter } from "./surgeon-adapter.ts";
import { Blake3HashService } from "../../../markdown-surgeon/adapters/services/blake3-hash.ts";
import { YamlParserService } from "../../../markdown-surgeon/adapters/services/yaml-parser.ts";
import type { TaskMeta } from "../../domain/entities/task.ts";
import { ExplicitCast } from "../../../explicit-cast.ts";

function createAdapter(): MarkdownSurgeonAdapter {
  const hashService = new Blake3HashService();
  const yamlService = new YamlParserService();
  return new MarkdownSurgeonAdapter(hashService, yamlService);
}

Deno.test("serializeTask - roundtrips complex description with newlines, colons, quotes, backslashes", () => {
  const adapter = createAdapter();

  const complexDesc =
    'line1: has colon\nline2 has "quotes"\nline3 has \\backslash';

  const meta: TaskMeta = {
    id: "test_id_12345678901234567",
    uid: "00000000-0000-0000-0000-000000000001",
    name: 'Task with "special" chars',
    desc: complexDesc,
    status: "created",
    created_at: "2025-01-15T10:00:00+01:00",
    ready_at: null,
    started_at: null,
    done_at: null,
    last_checkpoint: null,
    has_uncheckpointed_entries: false,
  };

  const serialized = adapter.serializeTask(meta, [], [], []);

  // Extract YAML between --- delimiters and parse it back
  const yamlMatch = serialized.match(/^---\n([\s\S]*?)\n---/);
  assertEquals(yamlMatch !== null, true, "Should have frontmatter delimiters");

  const parsed = ExplicitCast.from<unknown>(parseYaml(yamlMatch![1]))
    .dangerousCast<Record<string, unknown>>();

  // Roundtrip: parsed values must match original inputs exactly
  assertEquals(parsed.name, 'Task with "special" chars');
  assertEquals(parsed.desc, complexDesc);
  assertEquals(parsed.status, "created");
  assertEquals(parsed.id, "test_id_12345678901234567");
  assertEquals(parsed.ready_at, null);
  assertEquals(parsed.started_at, null);
  assertEquals(parsed.done_at, null);
  assertEquals(parsed.last_checkpoint, null);
  assertEquals(parsed.has_uncheckpointed_entries, false);
});
