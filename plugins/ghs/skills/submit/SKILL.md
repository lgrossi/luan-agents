---
name: submit
description: >
  Use this skill to push a gh-stack stack and create or update its stacked PRs.
  Replaces raw git push and gh pr create for stack workflows. Triggers: push,
  ship it, submit, update PRs, create PR, push stack, send PRs.
user-invocable: true
agent: general-purpose
allowed-tools:
  - "Bash(gh stack:*)"
  - "Bash(git status)"
  - "Bash(git branch:*)"
  - "Bash(gh pr view:*)"
  - Skill
---

# Submit a gh-stack Stack

Publish the current stack and reconcile its GitHub PR Stack.

## Choose the operation

| User intent | Command |
| --- | --- |
| Push branch updates without creating PRs | `gh stack push --remote origin` |
| Create/update stacked PRs as drafts | `gh stack submit --auto --remote origin` |
| Create/update PRs ready for review | `gh stack submit --auto --open --remote origin` |

`push` updates branches only. `submit` pushes active branches, creates missing
PRs, updates existing PR bases, and creates or extends the native GitHub Stack.
`--auto` is required for non-interactive use; without it, the command opens a
full-screen editor.

If the repository has more than one remote, pass `--remote origin` unless
`git config remote.pushDefault origin` is already set.

`gh stack push` is not atomic. A later branch can be rejected after earlier
branches were already updated; fix the rejected branch and rerun safely.

## Procedure

1. Verify the target repository and clean state:

   ```bash
   git remote get-url origin
   git status --short
   gh stack view --json
   ```

2. Check the stack shape. Confirm that the intended bottom-to-top order is
   correct before publishing.

3. Run the selected command:

   ```bash
   gh stack submit --auto --remote origin
   # or:
   gh stack submit --auto --open --remote origin
   ```

4. Verify the result:

   ```bash
   gh stack view --json
   ```

5. Report the stack number, every PR number and URL, draft/ready state, and
   any branches that were skipped or rejected.

6. For every affected PR, read the current description before changing it:

   ```bash
   gh pr view <number> --json number,title,body,headRefName,baseRefName,url,state,isDraft
   ```

   Then use `Skill(pr-descr)` when the user asked for polished descriptions.
   Preserve useful existing context; do not replace a description blindly.

## Reconciliation behavior

- A stack with no remote object gets created after PR creation.
- A matching existing stack is left unchanged.
- New PRs that extend an existing linear stack are appended at the top.
- A changed local order requires `gh stack modify` followed by submit, or the
  documented unstack/rebuild fallback.
- `submit` can create a new stack when a prior stack is fully merged.
- `submit` never deletes PRs or branches.
- If GitHub stacked PRs are unavailable, stop and report that capability error;
  do not silently create ordinary independent PRs.

## Draft and ready state

`--auto` creates new PRs as drafts. Add `--open` when the user explicitly wants
ready-for-review PRs. `--open` also marks existing affected PRs ready, so call
that out before running it.

## Failure handling

- Push rejection: fix the rejected branch and rerun; earlier successful pushes
  remain valid.
- Existing PRs with the wrong base: rerun submit after fixing branch ancestry.
- Local/remote stack divergence: stop; use `ghs:sync` recovery instructions
  rather than forcing a new stack.
- Interactive editor unexpectedly opened: cancel it and rerun with `--auto`.
