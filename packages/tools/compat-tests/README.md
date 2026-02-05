# Compatibility Tests

## Purpose

These tests ensure the stability of the public API. They act as a safeguard
against unintended **breaking changes**.

## Difference from Unit Tests

| Test Type               | Purpose                                | When to Modify                               |
| ----------------------- | -------------------------------------- | -------------------------------------------- |
| **Unit Tests**          | Validate internal behavior, enable TDD | During internal refactoring, logic evolution |
| **Compatibility Tests** | Guarantee public API stability         | **NEVER** without a major/minor version bump |

## Golden Rule

**If you need to modify a compatibility test, you must bump the version:**

- **Major version** (1.x.x → 2.0.0): breaking change
- **Minor version** (0.x.y → 0.y.0): breaking change in pre-1.0

This includes:

- Having to fix a test that doesn't compile anymore (types changed in the
  library)
- Having to fix a test that fails (behavior changed)
- Having to update expected values (output format changed)

**If all tests pass without modifications** → No breaking change → Patch OK
(x.y.z → x.y.z+1)

## Test Structure

All test files use `.test.ts` extension to be automatically discovered by
`deno test`.

### 1. `typescript-api.test.ts`

Verifies TypeScript API stability:

- Function exports (signatures, parameters, return types)
- Type exports (interfaces, types, enums)
- Custom error classes

**Coverage:**

- `@dohzya/tools/markdown-surgeon`: ~20 exports
- `@dohzya/tools/worklog`: ~15 types + CLI function

### 2. `cli-md.test.ts`

Verifies `md` CLI (markdown-surgeon) stability:

- 10 commands with all their options
- JSON output format
- Error codes

### 3. `cli-wl.test.ts`

Verifies `wl` CLI (worklog) stability:

- 8 commands with all their options
- JSON output format
- Error codes

## Execution

```bash
task test
```

That's it. All compatibility tests are automatically included.

## Principles

1. **Exhaustive**: Every documented API element must be tested
2. **Stable**: These tests should only evolve to add new features
3. **Clear**: Each test must clearly identify which API part it protects
4. **Isolated**: CLI tests use temporary files

## When to Modify These Tests?

**✅ Allowed:**

- Add tests for new features
- Fix bugs in the tests themselves (wrong assertion logic, not wrong expected
  values)

**❌ Requires version bump:**

- Having to fix a test that doesn't compile anymore
- Having to fix a test that fails
- Having to change expected values
- Removing a test
- Weakening assertions

## Examples of Breaking Changes Detected

- ✅ Having to fix compilation errors (type exports changed)
- ✅ Renamed an exported function
- ✅ Changed a function signature (param order, types)
- ✅ Removed a CLI command parameter
- ✅ Changed JSON output format
- ✅ Modified an error code
- ✅ Changed default behavior of an option

## Workflow

1. Develop your feature/fix
2. Run `task test`
3. If compatibility tests need modifications → Ensure you're OK with bumping the
   version
4. Update tests + bump version accordingly
