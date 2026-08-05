# gh-stack skill resources

These resources teach Pi agents how to use GitHub stacked pull requests through
`gh stack`. The same workflows are mirrored in `plugins/ghs/skills/` for the
other agent integrations.

## Install on another machine

Clone the agents repository and run its idempotent setup:

```bash
git clone https://github.com/luan/agents.git ~/.agents
cd ~/.agents
just setup
```

If the repository is cloned elsewhere, run `just setup` from that checkout; it
will link the live agent configuration to the checkout.

Install and authenticate GitHub CLI:

```bash
gh auth login
gh stack version
```

Use the upstream extension only when the installed GitHub CLI does not provide
`gh stack`:

```bash
gh extension install github/gh-stack
gh stack version
```

For repositories using this strategy, configure the mode locally or globally:

```bash
# One repository
git config agents.git-tool gh-stack

# Default for all repositories; override per repository when needed
git config --global agents.git-tool gh-stack
```

Keep these settings in every clone that should load the gh-stack skills. The
agent extension reads `agents.git-tool` and exposes these four generic skills:
`stack`, `submit`, `sync`, and `restack`.

## Workflow matrix

| Goal | Command | Skill |
| --- | --- | --- |
| Create layers | `gh stack init`, `gh stack add` | `stack` |
| Inspect | `gh stack view --json` | `stack` |
| Move between layers | `gh stack up/down/top/bottom/trunk` | `stack` |
| Push only | `gh stack push --remote origin` | `submit` |
| Create/update PR stack | `gh stack submit --auto --remote origin` | `submit` |
| Ready PRs | `gh stack submit --auto --open --remote origin` | `submit` |
| Refresh/reconcile | `gh stack sync --remote origin` | `sync` |
| Rebase | `gh stack rebase [--upstack|--downstack]` | `restack` |
| API-only stack | `gh stack link ...` | `stack` |
| Restructure | `gh stack modify` | `stack` |
| Remove grouping | `gh stack unstack [--local]` | `stack` |
| Merge stack | `gh stack merge <number> -y` when exposed by the installed CLI | `stack` |

The validation machine's GitHub CLI 2.97.0 / stack v0.0.8 does not expose
`gh stack merge`; check `gh stack` before relying on that version-gated command.

## Restructure operations

`gh stack modify` is the only supported interactive path for restructuring a
tracked stack. It supports:

- `Shift+Up` / `Shift+Down`: reorder or move a layer.
- `d` / `u`: fold down/up, also called absorb toward/away from trunk.
- `x`: drop a layer while preserving its branch and PR.
- `i` / `I`: insert an empty layer below/above the cursor.
- `r`: rename a layer.
- `z`: undo the last staged change.
- `Ctrl+S`: apply the staged plan.

Run `gh stack submit --auto --remote origin` after applying a remote stack
restructure. If no visible interactive terminal is available, remove the remote
grouping, rewrite ancestry deterministically, re-init the stack, and submit.

## Agent safety

Use explicit arguments and non-interactive flags:

```bash
gh stack init auth api ui
gh stack add tests
gh stack view --json
gh stack submit --auto --remote origin
gh stack sync --remote origin
gh stack rebase --remote origin
```

Avoid bare `view`, `init`, `add`, `switch`, and `submit` in an agent PTY because
they can open a prompt or full-screen editor. `modify` is different: it is
TUI-only, so run it only in the named visible repository when the user asks for
an interactive operation and capture before/after evidence.

## Recovery

- Rebase conflict: `git add <paths>` then `gh stack rebase --continue`.
- Abort rebase: `gh stack rebase --abort`.
- Abort interrupted modify: `gh stack modify --abort`.
- Keep remote stack: `gh stack unstack --local`, then `gh stack checkout <stack>`.
- Keep local stack: `gh stack unstack`, then `gh stack submit --auto`.
- `sync` never creates PRs; use `submit`.
- `unstack` removes grouping but does not delete PRs or branches.
- A queued or auto-merge PR can remain stacked after unstacking.

Full command contracts live in the upstream gh-stack documentation:
https://github.com/github/gh-stack
