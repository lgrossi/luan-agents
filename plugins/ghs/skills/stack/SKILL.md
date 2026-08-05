---
name: stack
description: >
  Use this skill for GitHub stacked PR status, branch creation, navigation,
  restructuring, merge, and general gh-stack operations. Replaces raw branch
  creation, rebase, push, and PR-stack commands. Triggers: stack, stacked PRs,
  branch layers, move, reorder, absorb, fold, drop, insert, rename, unstack.
user-invocable: true
allowed-tools:
  - "Bash(gh stack:*)"
  - "Bash(git status)"
argument-hint: "[view|init|add|up|down|top|bottom|trunk|checkout|modify|link|unstack|merge|...] [flags]"
---

# GitHub Stacked PRs

Use `gh stack` for GitHub stacked-branch workflows in this repository.

A stack is a linear chain rooted at the trunk. The bottom branch is closest to
trunk and merges first; the top branch is furthest away and merges last. Each
PR targets the branch immediately below it; only the bottom PR targets trunk.

```text
main <- auth <- api <- frontend
```

## Setup

Before using the skill on another machine:

```bash
gh auth login
gh stack version
git config rerere.enabled true
git config remote.pushDefault origin
```

For remote commands (`push`, `submit`, `sync`, `rebase`, and `link`), pass
`--remote <name>` unless `remote.pushDefault` is configured. `checkout` and
`trunk` have no `--remote` flag, so configure `remote.pushDefault` when a
repository has multiple remotes.

If `gh stack version` is unavailable, install the upstream extension:

```bash
gh extension install github/gh-stack
gh stack version
```

GitHub stacked PRs must be enabled for the repository. If the feature is not
available, `submit`, `link`, or stack reconciliation can fail with GitHub's
stack-unavailable error; do not silently fall back to unrelated PR commands.

## Non-interactive defaults

Use explicit arguments and flags in agent sessions:

| Use | Command |
| --- | --- |
| Inspect | `gh stack view --json` |
| Start a stack | `gh stack init <bottom> [middle ...]` |
| Add a layer | `gh stack add <branch>` |
| Push only | `gh stack push --remote origin` |
| Create/update PRs | `gh stack submit --auto --remote origin` |
| Create ready PRs | `gh stack submit --auto --open --remote origin` |
| Sync | `gh stack sync --remote origin` |
| Rebase | `gh stack rebase --remote origin` |
| Navigate | `gh stack up`, `down`, `top`, `bottom`, `trunk` |
| Pull down a remote stack | `gh stack checkout <stack-number-or-pr>` |

Do not use bare `submit`, `init`, `add`, `switch`, or `view` in an agent PTY
when a flag or argument avoids a prompt. `modify` is intentionally interactive.

`gh stack push` is not atomic. A later branch can be rejected after earlier
branches were already updated; fix the rejected branch and rerun safely.

## Quick reference

```bash
gh stack init auth api frontend
gh stack view --json
gh stack add tests
gh stack up [n]
gh stack down [n]
gh stack top
gh stack bottom
gh stack trunk
gh stack checkout <branch-or-pr-or-stack>
gh stack push --remote origin
gh stack submit --auto --remote origin
gh stack submit --auto --open --remote origin
gh stack sync --remote origin
gh stack sync --remote origin --prune
gh stack rebase --remote origin
gh stack rebase --upstack --remote origin
gh stack rebase --downstack --remote origin
gh stack rebase --no-trunk
gh stack link <bottom> <middle> <top>
gh stack link <pr-number> <pr-number> <pr-number>
gh stack unstack
gh stack unstack --local
gh stack merge <pr-or-stack-number> -y --squash  # only if exposed by this CLI
```

## Restructuring: move, reorder, absorb, and everything else

`gh stack modify` opens the supported TUI. It requires a clean working tree,
linear history, no queued PRs, and an active local stack.

```bash
gh stack modify
```

| Key | Operation | Result |
| --- | --- | --- |
| `x` | Drop | Remove a branch and its commits from local stack tracking; branch and PR remain available. |
| `d` | Fold down / absorb down | Absorb the selected branch into the branch below, toward trunk; remove the selected layer. |
| `u` | Fold up / absorb up | Absorb the selected branch into the branch above, away from trunk; remove the selected layer. |
| `i` / `I` | Insert | Add an empty branch below or above the selected branch. |
| `Shift+Up` / `Shift+Down` | Reorder / move | Move a branch away from or toward trunk. This changes ancestry after apply. |
| `r` | Rename | Rename the local branch and stack metadata. |
| `z` | Undo | Undo the last staged modify action. |
| `Ctrl+S` | Apply | Apply all staged changes. Run `ghs:submit` afterward to reconcile GitHub. |
| `q` / `Esc` | Cancel | Leave the stack unchanged. |

For agent-driven sessions, do not invoke the TUI in an invisible or detached
terminal. Use a visible PTY when the user explicitly asks for an interactive
restructure, capture the before/after state, and keep the operation scoped to
the named demo repository. If no interactive terminal is available, use:

```bash
gh stack unstack
# rewrite branch ancestry with ordinary Git operations
gh stack init --base <trunk> <bottom> <middle> <top>
gh stack submit --auto --remote origin
```

## Working rules

- Build foundational work at the bottom and dependent work above it.
- Add branches only from the current top branch.
- After changing a lower layer, rebase the upstack before returning to the top.
- Use `ghs:submit`, not `gh pr create`, for stacked PR creation.
- If the installed CLI exposes `gh stack merge`, use it instead of `gh pr merge`; otherwise do not pretend `gh pr merge` merges a stack.
- `gh stack link` is additive and writes no local tracking state.
- `gh stack unstack` removes grouping only; it does not delete branches or PRs.
- `sync` never creates missing PRs; use `ghs:submit` for that.
- If local and remote stacks diverge, stop and choose which side is authoritative.

The installed GitHub CLI used for this validation (2.97.0, stack v0.0.8)
does not expose `gh stack merge`; check `gh stack` before teaching or using
that command on another machine.

## State and recovery

Use `gh stack view --json` as the machine-readable source of truth.

- Rebase conflict: resolve files, `git add` them, then run `gh stack rebase --continue`.
- Abort rebase: `gh stack rebase --abort`.
- Abort interrupted modify: `gh stack modify --abort`.
- Keep remote stack: `gh stack unstack --local`, then `gh stack checkout <stack>`.
- Keep local stack: `gh stack unstack`, then `ghs:submit`.
- Queued or auto-merge PRs may remain stacked after unstack; clear that state first.

See the sibling `submit`, `sync`, and `restack` skills for command-specific
procedures.
