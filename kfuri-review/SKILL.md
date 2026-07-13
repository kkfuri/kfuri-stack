---
name: kfuri-review
version: 1.0.0
description: "Triages the review conversation on a PR: classifies every unresolved review thread (AI/bot and human) as actionable / nit / ambiguous, applies the clear single-file fixes, resolves nits silently..."
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Grep
  - Glob
  - AskUserQuestion
triggers:
  - kfuri-review
  - triage the review comments
  - deal with the bot comments
  - address the review feedback
---

## When to invoke this skill

It never posts thread replies — responses to humans
always come from the PR author. Use when asked to "triage the review
comments", "deal with the bot comments", or "address the review feedback".
Accepts an optional PR number or URL as argument.

# Kfuri Review — triage the review conversation on a PR

Triages the review threads on a PR. Classifies every unresolved review thread
(bot and human), applies the fixes that are clear and localised, resolves nits
silently, runs ambiguous AI/bot threads through the kfuri-pair autonomy ladder
before deferring, and always defers threads with human participation to a
human. Does **not** restack the branch or watch CI — this skill only handles
the review conversation.

**This skill never posts a comment to GitHub.** It never replies to a thread —
not to a human's (responses to humans always come from the PR author), not to
a bot's, not to its own. Bot threads it acts on are resolved silently; the
reasoning lives in the run report and narration instead of in-thread.

GitHub is the source of truth, so the skill is safely restartable.

## Narration — keep the user in the loop

Before **every** step below, emit a short one-line narration so the user can
see what's happening without watching raw tool output. Keep it terse — one
sentence, present tense.

Format: `[triage] <step> — <what and why>`

Examples:

```
[triage] step 1 — resolving PR from gh pr view
[triage] step 2 — found 7 unresolved threads: 5 bot, 2 human
[triage] step 3 — applying fix for thread #42 (rename foo to bar in src/foo.ts)
[triage] step 3 — 2 nits resolved, 1 ambiguous promoted via kfuri-pair, 2 human deferred
```

Narrate mid-step when a sub-action could take more than a few seconds (a fix
being pushed). A silent 30+ second gap is the failure mode — err on the side
of more lines, not fewer.

## Workflow

### Step 1: Resolve PR

If `$ARGUMENTS` looks like a PR number or URL, use it. Otherwise resolve
everything in **one** call — derive owner/repo from the `url` field
(`https://github.com/OWNER/REPO/pull/N`) instead of a second `gh repo view`:

```bash
gh pr view --json number,url,headRefName,baseRefName,headRefOid,state \
  --jq '{number, url, base: .baseRefName, head_sha: .headRefOid, state}'
```

Record: PR number, owner/repo (parsed from `url`), base branch, HEAD SHA, PR
state. If the PR state is `MERGED` or `CLOSED`, there is nothing to triage —
print that and stop. If no PR is detected, print a short note asking the user
to pass a PR number or URL, then stop.

If the branch has substantive new commits that were never reviewed, suggest
running `/review` first (it reviews and fixes the diff itself) — this skill
triages the *conversation*, not the code.

### Step 2: Fetch and classify review threads

Fetch all review threads on the PR. Filter to unresolved, non-outdated threads
and trim each body to 1500 chars at the jq layer — bot reviews can be tens of
KB each, and fetching the full payload is the single biggest context cost of
this skill. Bot comments put their tag, severity, and finding summary in the
first few hundred chars, so the 1500-char head is enough to classify; refetch
the full body only for the one thread you're about to action (see *Refetch
full body before acting* below).

```bash
gh api graphql -f query='
  query($owner:String!, $repo:String!, $num:Int!) {
    repository(owner:$owner, name:$repo) {
      pullRequest(number:$num) {
        reviewThreads(first:100) {
          nodes {
            id
            isResolved
            isOutdated
            comments(first:20) {
              nodes {
                databaseId
                author { login __typename }
                body
                path
                line
              }
            }
          }
        }
      }
    }
  }' -F owner=<owner> -F repo=<repo> -F num=<pr_number> \
  | jq '[
      .data.repository.pullRequest.reviewThreads.nodes[]
      | select(.isResolved == false and .isOutdated == false)
      | {
          id,
          path: .comments.nodes[0].path,
          line: .comments.nodes[0].line,
          author_login: .comments.nodes[0].author.login,
          author_type: .comments.nodes[0].author.__typename,
          first_comment_id: .comments.nodes[0].databaseId,
          body_head: (.comments.nodes[0].body[:1500]),
          body_truncated: ((.comments.nodes[0].body | length) > 1500),
          reply_count: ((.comments.nodes | length) - 1),
          participants: ([.comments.nodes[]
            | {login: .author.login, type: .author.__typename,
               automated: (.body[:200] | contains("🤖 Automated comment by"))}]
            | unique)
        }
    ]'
```

#### Human participation makes the whole thread human

Classify every comment in a thread, not just its first. A comment is
**automated** if either:

- its author is a bot account — `type == "Bot"`, login ends with `[bot]`, or
  login matches a known review-bot (greptile, coderabbit, cursor, sonarcloud,
  codescene, sourcery, ellipsis, Claude review apps, Dependabot), **or**
- its body carries the `🤖 Automated comment by` header (the `automated` flag
  in the jq above). This is the load-bearing check for our own comments:
  kfuri-stack's `/review` posts through the PR author's own account (typed
  `User`), so the header — not the account — is what marks them as
  bot-authored.

If **any** comment is neither — a real person authored the thread or replied
in it — the thread is **human**: defer it (no fix, no resolve, no reply),
whatever the first comment's author was. A human replying in a bot thread has
joined the conversation, and responses to humans always come from the PR
author. If you can't confidently classify a comment, treat it as human and
**defer rather than ignore** — a surfaced thread is recoverable, a dropped one
is not.

#### Greptile suppressions

For threads authored by Greptile, apply the suppressions check from
`.claude/skills/review/greptile-triage.md` (per-project history of known false
positives) before classifying. Suppressed threads are skipped silently — they
were already triaged in a prior run.

#### Skip stale bot reviews

Before classifying a bot review as actionable, check whether it is against the
current HEAD:

- Inline review thread comments — already filtered by `isOutdated == false` in
  the GraphQL query.
- Top-level PR comments (e.g. review summaries) — scan the body for a commit
  SHA reference ("reviewing commit `<sha>`", a `/commit/<sha>` link). If a
  referenced SHA is present and != HEAD SHA, skip the comment as stale. The
  bot will re-evaluate the new HEAD shortly.

When in doubt (no SHA reference but the review predates the latest commit by
more than one push), prefer skipping to acting — a stale fix is worse than a
small wait.

### Step 3: Handle each bot thread

Classify each all-bot thread's body:

- **Actionable & clear** — concrete single-file fix, severity HIGH or
  CRITICAL (convergent findings from multiple reviewers count as higher
  confidence), scope tight and unambiguous.
- **NIT / non-actionable** — style-only, speculative, duplicate, or already
  addressed.
- **Ambiguous** — architectural judgement, broad scope, or requires design
  decisions.

Handle each class:

- **Actionable:** apply the edit with `Edit`/`Write`, commit with a message
  like `fix: address review comment <short description>`, push, then resolve
  the thread — no reply; the commit SHA and a one-line description go in the
  narration and report. If `body_truncated == true` for this thread, refetch
  the full body first (see below) so the fix isn't based on a clipped
  suggestion.
- **NIT:** resolve the thread — no reply; record the one-line reason
  ("intentional — <reason>" / "out of scope — follow-up" / "disagree —
  <reason>") in the report's per-thread lines.
- **Ambiguous:** before deferring, run it through the kfuri-pair gate (see
  *Judgement rules* below). If the gate promotes it to just-do-it or
  recommend-and-ask, act on it and resolve the thread (count it as
  `promoted`, not `deferred`). Only a genuine stop-and-ask defers the thread,
  unresolved, included in the end-of-run report.

To resolve a thread (never reply — resolving is the only mutation this skill
performs on a thread):

```bash
gh api graphql -f query='
  mutation($thread_id:ID!) {
    resolveReviewThread(input:{threadId:$thread_id}) {
      thread { id }
    }
  }' -F thread_id=<id>
```

#### Refetch full body before acting

If you've classified a truncated thread as **Actionable**, refetch its full
body before generating the fix. This is the only path that should pull a full
body into context — and only for one thread at a time:

```bash
gh api graphql -f query='
  query($id:ID!) {
    node(id:$id) {
      ... on PullRequestReviewThread {
        comments(first:1) { nodes { body } }
      }
    }
  }' -F id=<thread_id>
```

### Step 4: Handle human threads

**Never auto-fix, auto-resolve, or reply** — a human wants a response or a
decision from the author, not a silent edit and not a bot reply. Defer the
thread and surface it in the report as human-participated.

You may offer a trivial, obviously-correct fix via `AskUserQuestion` — but
even an approved fix gets no reply and no resolve: push the fix, leave the
thread open, and report "fixed in <sha>, thread left open for your reply".

**Nothing is silently skipped** — each thread you fetched ends in exactly one
bucket: resolved, actioned, promoted, or deferred.

### Step 5: Report

Print a one-line summary —

```
[triage] done — sha=<short_sha> resolved=<n> actioned=<n> promoted=<n> deferred=<n>
```

`promoted` is the count of ambiguous threads the kfuri-pair gate resolved
(just-do-it or recommend-and-ask) instead of deferring. Break `deferred` down
by author, e.g. `deferred=5 (3 ambiguous bot, 2 human)`. The counts must
**reconcile**: every unresolved non-outdated thread you fetched ends as
resolved, actioned, promoted, or deferred — never seen-but-unhandled. List
each deferred thread's author, `file:line`, and a one-line reason under the
summary, and each resolved thread's `file:line` with the reason or commit SHA
— since resolves carry no reply, the report is the only audit trail. Then hand
back (the skill does not sleep or self-loop; wrap in `/loop` for cadence).

## Judgement rules for auto-actioning a comment

A thread is **actionable** only if **all** of these hold:

- Severity is HIGH or CRITICAL (or it's a convergent finding across reviewers —
  those carry higher confidence).
- The fix is described concretely enough that a reader knows exactly what to
  change (a specific rename, a missing null check, a typo, a forgotten await,
  an obvious off-by-one).
- The change is localised — a single file, or at most a small set of tightly
  related edits.
- Applying it does not require new design decisions, new dependencies, or
  altering the PR's scope.

Otherwise the thread is either a NIT (auto-resolve, reason in the report) or
**ambiguous**.

### The kfuri-pair gate — before deferring an ambiguous bot thread

An ambiguous thread is not automatically a deferral. Read
`.claude/skills/kfuri-pair/SKILL.md` (or invoke `Skill("kfuri-pair")`) and
apply its autonomy ladder to the thread's suggested change:

- **Just do it** — the outcome is unambiguously better and there's essentially
  one sensible way to get there (a trivial, reversible improvement). Apply the
  fix, commit, push, resolve the thread (no reply — commit SHA and description
  in the report). Count it as `promoted`, not `deferred`.
- **Do it, but recommend and ask** — more than one reasonable solution exists.
  Make the call, apply it, commit, push, resolve the thread — and the report
  entry must state the one-line reasoning and the alternative considered (e.g.
  "did X because Y — alternative was Z, shout if you'd rather Z"). Count it as
  `promoted`. Surface these prominently in the report/narration so the human
  can redirect cheaply if they'd rather the alternative.
- **Stop and ask** — it would violate one of the four rules of simple design,
  or it's genuinely unclear which outcome is better. This is the only outcome
  that still defers the thread, unresolved.

This gate applies to ambiguous **bot** threads only. It never applies to the
human-participated bucket — those are always deferred, never auto-fixed,
regardless of how trivial the change looks; that rule protects the human
review conversation, which is a different concern from judging a fix's
difficulty.

**Invariant: an all-bot thread that has been addressed always ends resolved —
silently; this skill never posts a thread reply.** The only threads left open
are genuine stop-and-ask (kfuri-pair-confirmed) and anything with human
participation. When in doubt about whether a fix is safe to apply at all,
that doubt itself is the stop-and-ask signal — a nagging status line is
cheaper than a wrong push.

## Terminal conditions

Stop cleanly and print the report when **any** of:

- PR is `MERGED` or `CLOSED`.
- Every unresolved thread has been classified and handled (fixed, resolved, or
  deferred) — nothing autonomous left to do.
- The user interrupts.

Ambiguous review findings are **not** a terminal condition; they are deferred
and surfaced in the report.

## Graceful degradation

- **kfuri-pair skill missing:** warn and skip the gate — treat every ambiguous
  thread as stop-and-ask (defer), the safer fallback when the ladder isn't
  available to consult.
- **greptile-triage.md missing:** skip the suppressions check — triage
  Greptile threads like any other bot's.
- **No PR detected:** print a short note asking the user to pass a PR number
  or URL, then stop.
- **User interrupts mid-run:** stop at the next natural checkpoint and print
  the report.
