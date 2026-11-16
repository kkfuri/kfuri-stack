---
name: kfuri-review
version: 2.0.0
description: "Local code review on demand: reviews the current diff (or whatever the user points at) with the focus the user asks for, and reports findings in the conversation. Read-only — never comments, commits, pushes, or touches GitHub."
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
triggers:
  - kfuri-review
  - review my changes
  - review this diff
  - code review this
---

## When to invoke this skill

Use when asked to review code locally: "review my changes", "review this diff
for X", "check this file for race conditions". Accepts an optional argument
naming what to review and/or what to focus on (a path, a branch, a concern
like "security" or "error handling"). Without an argument, reviews the
working-tree diff against the base branch.

# Kfuri Review — local, read-only code review

Reviews code on this machine and reports findings **in the conversation
only**. This skill is strictly read-only:

- **Never** posts a PR comment, review, or thread reply.
- **Never** resolves, edits, or reacts to GitHub threads.
- **Never** commits, pushes, stages, or edits files.

The deliverable is the report. If the user wants a finding fixed, they say so
afterward and the fix happens as normal work outside this skill.

## Step 1: Scope — review what the user said, how the user said

`$ARGUMENTS` drives everything:

1. **Target** — if the argument names a path, commit range, or branch, review
   that. Otherwise review the local diff: uncommitted changes plus commits on
   this branch not on the base branch (detect the base with
   `gh repo view --json defaultBranchRef` or `git remote show origin`,
   falling back to `main`).
2. **Focus** — if the argument names a concern ("security", "perf", "is the
   retry logic right"), weight the review toward it and say so in the report.
   No stated focus means a general correctness review: bugs first, then
   simplifications, then style only when it hides a bug.

If there is nothing to review (clean tree, no branch commits, named path
missing), say that in one line and stop.

## Step 2: Read before judging

Read the full files around the diff hunks, not just the hunks — enough to
know what callers expect and what invariants the changed code must keep.
Findings must come from what the code actually does, not from what the diff
looks like.

## Step 3: Report

Findings ordered most-severe first. For each:

- `file:line` — one-sentence defect statement.
- A concrete failure scenario (inputs/state → wrong outcome). If you can't
  name one, it's a suggestion, not a finding — label it as such.
- The fix in one or two sentences (described, not applied).

Close with a one-line verdict: ship it / fix the listed items first / needs a
human conversation about X. If the user gave a focus, state explicitly
whether that concern is clear.

No findings is a valid outcome — say "looked at <scope>, focused on <focus>,
found nothing" rather than inventing nits to seem thorough.
