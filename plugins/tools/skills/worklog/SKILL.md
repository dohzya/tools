---
name: worklog
description: Track work progress during development sessions. Activates when .worklog/ exists OR user says "track this", ">track", "let's track", "worktask", "work on worktask". Maintains a chronological worklog with on-demand consolidation via checkpoints.
---

# Worklog

Track work progress with traces and checkpoints. **Always work within a worktask.**

## Core Concepts

**Task lifecycle:** `created` → `ready` → `started` → `done` / `cancelled`

- **created**: Task defined, not ready to work on yet
- **ready**: Task ready to be picked up
- **started**: Actively working on the task
- **done**: Task completed with final checkpoint
- **cancelled**: Task abandoned

**Two types of entries:**

1. **Traces** (append-only): Log what you're doing with causes & pistes
   - Include **causes** for failures (why it failed)
   - Include **pistes** for pivots (what to try next)
   - Use real timestamps when batch-tracing (`-t T14:30`)

2. **Checkpoints** (consolidation): Rewrite traces into narrative
   - **NOT a conclusion** - synthesize the traces themselves
   - Review `wl logs <id>` before creating checkpoint

**Key principle:** `done` = final checkpoint with:

- **Changes**: Consolidate ALL traces (what happened, including failed attempts)
- **Learnings**: REX with critical distance (reusable insights, not just "what we did")

## Essential Workflow

### 1. Always Start with a Worktask

```bash
# Check if tracking active
wl list

# Create worktask (default: created state)
wl create "Implement feature X" "Detailed description here"

# Create and start immediately
wl create --started "Fix login bug"

# Optional: Add TODOs for multi-step tasks
wl create "Feature X" --todo "Analyze code" --todo "Implement" --todo "Test"

# Transition task through states
wl ready <id>                    # Mark ready to work on
wl start <id>                    # Start working
```

**Critical:** Never work without an active worktask. Create one first.

### 2. Trace Everything with Context

```bash
# ✅ GOOD traces (include causes & pistes)
wl trace <id> "Goal: support multi-currency"
wl trace <id> "Tried direct field - broke 12 tests (cause: validator expects single total)"
wl trace <id> "Pivot to CurrencyBucket pattern (piste: isolate currency logic)"
wl trace <id> "Tests pass - CurrencyBucket works"

# ❌ BAD traces (missing context)
wl trace <id> "Tried X"
wl trace <id> "Didn't work"
wl trace <id> "Fixed it"
```

**Note:** `wl trace` warns if task is not started. Start with `wl start <id>` first.

**Batch tracing?** Use real timestamps:

```bash
wl trace <id> -t T14:30 "Started investigation"
wl trace <id> -t T15:15 "Found root cause"
wl trace <id> -t T15:45 "Applied fix"
```

### 3. Consolidate with Checkpoints

When `wl trace` says "checkpoint recommended":

```bash
# 1. Review traces
wl logs <id>

# 2. Synthesize (don't just concatenate)
wl checkpoint <id> \
  "- Implemented CurrencyBucket pattern
- Initial direct field approach failed (broke tests)
- Pivot to CurrencyBucket → all tests pass" \
  "- Direct field broke validators (wrong abstraction)
- Bucket pattern isolates concerns better"
```

### 4. Complete Task (After Commit!)

**CRITICAL: Always review before closing!**

**Order matters:**

1. Commit your changes first
2. **Review traces & check TODOs** with `wl show`
3. Then mark worktask done

```bash
# 1. Commit
git add .
git commit -m "feat: multi-currency support"

# 2. Review ALL traces + check TODOs
wl show <id>
# ⚠️ Check output for:
#   - Pending TODOs that need completion
#   - All significant traces to consolidate
#   - Pattern of what failed/worked

# 3. Final consolidation + REX
wl done <id> \
  "Multi-currency validation via CurrencyBucket (12 tests pass)

Actions:
- Implemented CurrencyBucket pattern
- Added error handling
- Initial direct field approach failed (broke 12 tests)
- Pivot to CurrencyBucket → tests pass

Résultat:
- 12/12 tests passing
- Single-currency unchanged" \
  "1. Direct field broke validators - wrong abstraction layer
2. Bucket pattern isolates concerns - reusable pattern
3. Centralized validation prevents fragmentation
4. Validate aggregate before buckets - catches edge cases" \
  --meta commit=$(git rev-parse HEAD)

# If no new traces since last checkpoint, no args needed:
wl done <id>
```

**REX quality check:**

- ❌ "Tests pass" (result, not learning)
- ❌ "Used CurrencyBucket" (action, not insight)
- ✅ "Bucket pattern isolates concerns better than direct fields"

## Common Mistakes to Avoid

1. **Working without worktask** → Always create worktask first
2. **Vague traces** → Include causes (why failed) & pistes (what next)
3. **Missing timestamps** → Use `-t` when batch-tracing
4. **Checkpoint = conclusion** → NO! Consolidate traces into narrative
5. **Done before commit** → Commit first, then done
6. **Done without reviewing** → ALWAYS do `wl show <id>` first to review traces + check TODOs
7. **REX = summary** → NO! REX = critical distance, reusable insights
8. **Tracing without starting** → `wl start <id>` before tracing

## Quick Reference

```bash
wl create "name" ["description"]  # Create worktask (default: created)
wl create --started "name"        # Create and start immediately
wl ready <id>                     # Mark task ready
wl start <id>                     # Start working on task
wl update <id> --name "new"       # Update task name or description
wl trace <id> "msg"               # Log with context (causes/pistes)
wl trace <id> -t T14:30 "msg"     # With timestamp
wl show <id>                      # Review traces + TODOs (before checkpoint/done!)
wl checkpoint <id> "changes" "rx" # Consolidate traces
wl done <id> ["changes" "rx"]     # After commit + wl show! (args optional if no new traces)
wl cancel <id> [reason]           # Abandon task (marks as cancelled)
wl list                           # See active worktasks (created/ready/started)
wl list --started                 # Filter by status
wl list --done                    # Show done tasks

# TODO management
wl create "Task" --todo "Step 1" --todo "Step 2"
wl todo list                      # All TODOs
wl todo set status=done <id>      # Mark done
```

## Additional Resources

- **[reference.md](reference.md)** - Complete command reference, options, timestamps
- **[todo-guide.md](todo-guide.md)** - TODO management in depth
- **[examples.md](examples.md)** - Detailed examples and patterns
- **[internals.md](internals.md)** - File format and structure (for debugging)

## Language

Adapt to user's language for traces/checkpoints/REX.
