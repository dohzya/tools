# Guidelines for AI Agents

## Project Setup

**First time setup:** Run `bash setup.sh` to install mise and Deno.

This will:

- Install [mise](https://mise.jdx.dev/) if not present
- Install Deno (latest version)
- Trust the repository's `mise.toml`

**Available commands:**

```bash
task fmt       # Format code
task test      # Run tests only
task check     # Check code (format + type + lint)
task validate  # Run all checks (fmt + check + lint + test)
```

## Pre-commit Checks

**CRITICAL:** Before saying you're done with any code changes, ALWAYS run:

```bash
task validate  # Runs fmt + check + lint + test
```

**Do not skip this step** - if any check fails, fix the issues before committing. These checks are enforced by CI.

## Testing CLI Changes

When modifying CLI code (`markdown-surgeon/cli.ts` or `worklog/cli.ts`), you should test your changes using the unit tests:

```bash
task test:md   # Test markdown-surgeon CLI
task test:wl   # Test worklog CLI
task test      # Run all tests (including compatibility tests)
```

The CLI tests call `main()` directly and use `captureOutput()` to verify output. For integration tests that spawn subprocesses, see `compat-tests/` directory.

### Writing Tests - Best Practices

**DO NOT create temporary files/directories manually** for testing (e.g., `/tmp/test-vault`). Instead:

1. **Write tests directly in `cli.test.ts`** using the existing `createTempFile()` helper:
   ```typescript
   const file = await createTempFile(`---\ntags: [foo]\n---\n# Test`);
   try {
     const output = await captureOutput(() =>
       main(["meta", "--aggregate", "tags", file])
     );
     assertEquals(output.trim(), "foo");
   } finally {
     await Deno.remove(file); // Automatic cleanup
   }
   ```

2. **For multiple files**, create them in the test:
   ```typescript
   const file1 = await createTempFile(`---\ntags: [foo]\n---\n# File 1`);
   const file2 = await createTempFile(`---\ntags: [bar]\n---\n# File 2`);
   try {
     // Test with both files
   } finally {
     await Deno.remove(file1);
     await Deno.remove(file2);
   }
   ```

3. **For glob patterns**, use `Deno.makeTempDir()`:
   ```typescript
   const tmpDir = await Deno.makeTempDir();
   try {
     await Deno.writeTextFile(`${tmpDir}/a.md`, `---\ntags: [foo]\n---\n# A`);
     await Deno.writeTextFile(`${tmpDir}/b.md`, `---\ntags: [bar]\n---\n# B`);
     const output = await captureOutput(() =>
       main(["meta", "--aggregate", "tags", `${tmpDir}/*.md`])
     );
     // Test output
   } finally {
     await Deno.remove(tmpDir, { recursive: true });
   }
   ```

**Why:** Tests are self-contained, automatically cleaned up, and run in isolation. Manual temp files can interfere with tests and leave clutter.

## TypeScript Best Practices

### Type Safety and Validation

**NEVER use unsafe type casts** like `as unknown as T` to bypass TypeScript errors. Instead, use proper runtime validation:

- **Use Zod 4 Mini** for runtime validation (NOT Zod 3, and only the mini package)
  ```typescript
  import { z } from "zod/mini";

  const schema = z.object({
    id: z.string(),
    status: z.enum(["active", "done"]),
    // ... other fields
  });

  const validated = schema.parse(data); // Throws on invalid data
  ```

- Import from `"zod/mini"` for smaller bundle size
- Define schemas for data structures that come from external sources (files, APIs, user input)
- Let validation failures throw - they indicate real bugs

**Why:** Unsafe casts hide bugs. Zod validation catches them at runtime and provides clear error messages.

## Creating Releases

When it's time to create a new release, refer to [RELEASE.md](RELEASE.md) for the complete release process, including:

- Automated scripts (`task bump`, `task build`, `task update-tap`)
- Manual step-by-step instructions
- Critical order of operations (JSR publish BEFORE building binaries!)
- Bundle releases (combining wl + md for mise backend)
- Common pitfalls and troubleshooting

**Important:** For bundle releases, always verify which tool versions will be included BEFORE pushing the tag:

```bash
# Note: gh release list is tab-separated
gh release list -R dohzya/tools | awk -F'\t' '$3 ~ /^wl-v/ {print $3; exit}'
gh release list -R dohzya/tools | awk -F'\t' '$3 ~ /^md-v/ {print $3; exit}'
```

## CHANGELOG.md

You can and should maintain `packages/tools/CHANGELOG.md` when making changes.

**Important rules:**

1. **NEVER modify existing entries** - the history is immutable
   - Don't change version numbers, dates, or descriptions of past releases
   - Only fix typos if absolutely necessary
2. **ONLY add new entries** at the top
   - Add a new `## [X.Y.Z]` section for the new version
   - Document what changed in this release
3. When bumping version, use the automation script:
   - Run `task bump TOOL=wl VERSION=X.Y.Z` (updates all files)
   - Or follow manual checklist in [RELEASE.md](RELEASE.md)
   - Add new CHANGELOG entry

## Worklog Usage

**IMPORTANT:** For any work session, you must systematically:

1. **Create a worktask** (worklog's unit of tracked work) if one doesn't exist:
   ```bash
   wl add --desc "Description of the work to be done"
   ```
   This returns a worktask ID (e.g., `260202n`)

2. **Trace each significant action** as you work:
   ```bash
   wl trace <worktask-id> "Description of the action taken"
   ```
   Trace reading files, making changes, running tests, etc.

3. **Mark the worktask as done** when work is complete:
   ```bash
   wl done <worktask-id> "Summary of changes" "What was learned"
   ```

This helps maintain a clear record of all work done and supports effective collaboration and progress tracking.

### .worklog/ Directory

The `.worklog/` directory is a local working directory and should never be committed to git.

It is already in `.gitignore`.
