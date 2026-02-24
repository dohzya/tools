# Worklog Examples and Patterns

Detailed examples showing effective worklog usage.

## Example 1: Feature Implementation

### Good Trace Sequence

```bash
# Start with goal
wl trace 260205a "Goal: Add pagination to user list"

# First attempt
wl trace 260205a "Tried offset-based pagination - simple but has issues with data changes"

# Hit problem
wl trace 260205a "Issue: Users can be skipped if new users added between pages (cause: offset shifts)"

# Pivot with reasoning
wl trace 260205a "Pivot to cursor-based pagination (piste: stable regardless of insertions)"

# Implementation
wl trace 260205a "Implemented cursor using user.createdAt + user.id composite"

# Validation
wl trace 260205a "Tests pass - pagination stable across insertions"
```

### Good Checkpoint

```bash
wl checkpoint 260205a \
  "Pagination implemented using cursor-based approach

- Initial offset-based approach had data consistency issues
- Cursor-based (createdAt + id) handles concurrent insertions
- All pagination tests passing" \
  "1. Offset pagination breaks with concurrent writes (users can be skipped)
2. Cursor-based pagination more robust - stable cursors regardless of insertions
3. Composite cursor (timestamp + id) handles duplicate timestamps"
```

### Good Done (After Commit)

```bash
git add . && git commit -m "feat: cursor-based pagination for user list"

wl done 260205a \
  "Cursor-based pagination implemented for user list

Actions:
- Researched pagination approaches (offset vs cursor)
- Initial offset implementation had consistency issues
- Redesigned using cursor (createdAt + id composite)
- Added pagination tests (insertions, edge cases)

Résultat:
- Stable pagination across concurrent writes
- Handles duplicate timestamps correctly
- 8/8 tests passing" \
  "1. Offset pagination unreliable with writes - users can be skipped/duplicated
2. Cursor-based more complex but guarantees consistency
3. Composite cursor needed for duplicate timestamp handling
4. Always test pagination with concurrent modifications" \
  --meta commit=$(git rev-parse HEAD)
```

## Example 2: Bug Investigation

### Good Trace Sequence (Batch Tracing with Timestamps)

```bash
# Recreating investigation from earlier
wl trace 260205b -t T09:30 "User reports: login fails with 'invalid token' error"

wl trace 260205b -t T09:45 "Checked logs - token validation throwing TypeError"

wl trace 260205b -t T10:00 "Root cause: jwt.verify() expects string, receiving Buffer (cause: req.headers['authorization'] not decoded)"

wl trace 260205b -t T10:15 "Fixed by adding .toString() before jwt.verify()"

wl trace 260205b -t T10:20 "Tests pass - login working"
```

### Good Done

```bash
git add . && git commit -m "fix: decode authorization header before jwt.verify"

wl done 260205b \
  "Fixed login token validation TypeError

Actions:
- Investigated 'invalid token' error in logs
- Found jwt.verify() receiving Buffer instead of string
- Root cause: authorization header not decoded
- Added .toString() conversion before verification

Résultat:
- Login working correctly
- TypeError resolved
- Added test for Buffer authorization header" \
  "1. jwt.verify() expects string - Buffer causes TypeError (not obvious from error)
2. Headers can arrive as Buffer in certain middleware configurations
3. Always verify input types before crypto operations
4. Test edge cases like Buffer/string variations" \
  --meta commit=$(git rev-parse HEAD)
```

## Example 3: Bad vs Good Comparisons

### ❌ BAD Traces

```bash
wl trace 260205c "Started working"
wl trace 260205c "Tried something"
wl trace 260205c "Didn't work"
wl trace 260205c "Tried something else"
wl trace 260205c "Fixed it"
```

**Problems:**

- No context about what was tried
- No causes for failures
- No pistes for pivots
- Can't reconstruct what happened

### ✅ GOOD Traces

```bash
wl trace 260205c "Goal: Fix memory leak in WebSocket handler"
wl trace 260205c "Tried closing sockets on disconnect - leak persists (cause: event listeners not removed)"
wl trace 260205c "Found leaked listeners in connection pool (piste: need explicit cleanup)"
wl trace 260205c "Added removeAllListeners() in disconnect handler"
wl trace 260205c "Memory leak resolved - heap stable after 1000 connections"
```

**Benefits:**

- Clear goal
- Specific attempts with causes for failures
- Clear pivots with pistes
- Can understand full journey from traces

### ❌ BAD Done

```bash
wl done 260205c "Task completed" "Everything works"
```

**Problems:**

- No consolidation of traces
- No indication of what was done
- No REX - just status update

### ✅ GOOD Done

```bash
wl done 260205c \
  "Fixed WebSocket memory leak

Actions:
- Investigated heap growth after connections
- Tried closing sockets - leak persisted
- Root cause: event listeners not removed on disconnect
- Added removeAllListeners() in disconnect handler
- Verified with 1000 connection stress test

Résultat:
- Memory leak resolved
- Heap stable across connection lifecycle
- Stress test passing (1000 connections)" \
  "1. Socket.close() doesn't remove event listeners automatically
2. Event listeners on long-lived objects cause leaks
3. Always pair addEventListener with removeListener/removeAllListeners
4. Use heap snapshots to verify leak fixes - don't trust feel" \
  --meta commit=$(git rev-parse HEAD)
```

**Benefits:**

- Consolidates full journey from traces
- Shows what failed and why
- REX has critical distance and reusable insights
- Future-you (or others) can learn from this

## Example 4: Multi-Step Task with TODOs

```bash
# Create task with TODOs
wl create "Implement email notification system" \
  --todo "Design email templates" \
  --todo "Setup SMTP configuration" \
  --todo "Implement sender service" \
  --todo "Add retry logic" \
  --todo "Write tests"

# Returns: 260205d

# Work on first TODO
wl todo set status=wip <todo-1-id>
wl trace 260205d "Designing email templates using Handlebars"
wl trace 260205d "Created welcome.hbs and reset-password.hbs"
wl todo set status=done <todo-1-id>

# Work on second TODO
wl todo set status=wip <todo-2-id>
wl trace 260205d "Setting up nodemailer with Gmail SMTP"
wl trace 260205d "Hit issue: Gmail blocks less secure apps (cause: 2FA required)"
wl trace 260205d "Switched to app-specific password - working"
wl todo set status=done <todo-2-id>

# Continue with remaining TODOs...

# Final done consolidates everything
wl done 260205d \
  "Email notification system implemented

Actions:
- Designed Handlebars templates (welcome, reset-password)
- Configured nodemailer with Gmail SMTP (app password)
- Implemented EmailService with template rendering
- Added exponential backoff retry (3 attempts)
- Wrote integration tests with mock SMTP

Résultat:
- Email sending working for welcome/reset flows
- Retry handles transient failures
- 12/12 tests passing" \
  "1. Gmail requires app-specific passwords with 2FA (not obvious)
2. Template system separates content from code nicely
3. Exponential backoff essential for email reliability
4. Mock SMTP server (smtp-server) great for testing" \
  --meta commit=$(git rev-parse HEAD)
```

## Tips for Better Worklogs

1. **Trace immediately** - Don't batch unless using timestamps
2. **Be specific** - "Tried X" → "Tried X - failed because Y"
3. **Include reasoning** - Why did you pivot? What's the piste?
4. **Checkpoint often** - Don't let traces pile up
5. **Review before done** - Use `wl logs` to see full picture
6. **REX needs distance** - Not "what we did" but "what we learned"
7. **Done after commit** - Link work to code via commit SHA
