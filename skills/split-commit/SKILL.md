---
name: split-commit
description: Use when a branch has multiple messy commits that must be repackaged into clean, testable vertical commits before review or merge
---

# Split Commit

Repackage branch changes into clean vertical commits. Each commit should compile and pass tests independently.

## Inputs

- `base-branch` (optional): branch to compare against; default to upstream trunk (`main`/`master`) if not provided.
- `test-command` (optional): explicit verification command to run per commit.

## Phase 1: Analyze

Parse: `<base-branch>`, optional `--test='command'`. If no base-branch arg, resolve at runtime: `git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/||' || echo main`.

**Noop check** — `git log --oneline <base>..HEAD | wc -l`. If ≤1 → stop: "Nothing to repackage — use $commit."

```text
TEST_COMMANDS: <detected or provided>
COMMIT_PLAN:
1. type(scope): message
   Files: <list>
   Partial hunks: <if any>
   Deps: <cross-file dependency notes>
   Rationale: <why this boundary>
DEPENDENCY_NOTES: <ordering constraints and split risks>
```

## Phase 2: Execute

After approval, collapse branch commits into unstaged changes:

```bash
git reset --soft <base>
git reset HEAD
```

Then execute plan sequentially:

1. Stage files/hunks for commit `N` (`git add <file>` and `git add -p` for partials).
2. Run tests for commit `N`:
   - Prefer provided `test-command`.
   - Otherwise use project default (`just`, `make test`, `npm test`, `pytest`, `cargo test`, etc.).
3. If tests fail due to missing dependency, stage the missing dependency and retry once.
4. If still failing, stop and report the exact commit number and error.
5. Commit with planned message.

If execution is complex, dispatch one `worker` subagent for the full sequence (not one subagent per commit) so context stays consistent.

## Recovery Rules

- If commit `N` fails, preserve commits `1..N-1`; do not restart from scratch.
- Apply targeted fix, then continue from remaining commits.
- Do not rewrite already-good commits unless explicitly requested.

## Final Verification

Run:

```bash
git status
git log --oneline <base>..HEAD
git diff --stat
```

Expected:

- Working tree clean.
- Commit history matches approved plan (or documented deviations).
- No unintended unstaged leftovers.

If leftovers remain and belong to this effort, either:
- include them in a final `chore: clean up remaining` commit, or
- stop and ask user whether to keep or discard.

## Key Rules

- Ask for approval after analysis, before history rewrite.
- Keep commit history bisectable: every commit should build and test.
- Prefer precise hunk staging over broad staging.
- Let dependency correctness override an overly rigid grouping plan.
