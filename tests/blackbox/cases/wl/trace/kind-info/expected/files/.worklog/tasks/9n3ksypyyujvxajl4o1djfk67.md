---
id: 9n3ksypyyujvxajl4o1djfk67
uid: ee640a0e-29f7-4bb6-a76d-d7bff40a8582
name: Fix login bug
desc:
  - |-
    Users can't log in with **SSO**.
    Second paragraph with unicode: café ☕
status: started
created_at: '2020-01-10T09:00:00+01:00'
ready_at: null
started_at: '2020-01-20T10:00:00+01:00'
done_at: null
last_checkpoint: '2020-01-20T10:00:00+01:00'
has_uncheckpointed_entries: true
metadata:
  owner: alice
tags:
  - backend
---

# Entries

## 2020-01-10 09:05  [kind:: info]
[added:: 2020-01-20 10:00]
Reproduced the bug locally


## 2020-01-10 09:30  [kind:: hypothesis]
[added:: 2020-01-20 10:00]
Token expiry is off by one hour (timezone?)


## 2020-01-10 10:15  [kind:: finding]
[added:: 2020-01-20 10:00]
Cause: tokens issued in UTC but compared in local time


## 2020-01-10 11:00  [kind:: action]
[added:: 2020-01-20 10:00]
Patched comparison to use UTC
multi-line message with `code` and unicode: ✓ ñ


## 2020-01-10 12:00  [kind:: state]
[added:: 2020-01-20 10:00]
Tests green after fix


## 2020-02-01 09:00  [kind:: learning]
[added:: 2020-02-01 09:45]
Post-checkpoint: add regression test


## 2020-02-01 09:30
[added:: 2020-02-01 09:45]
Untyped trace default kind?


## <NOW>  [kind:: info]
a info trace


# Checkpoints

## 2020-01-20 10:00

### Changes
Root cause: UTC vs local time. Fix: compare in UTC.

### Learnings
Always store timestamps in UTC.

