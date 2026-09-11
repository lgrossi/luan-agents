# @luan-pi/pi-tuicr

`@luan-pi/pi-tuicr` runs the `tuicr` code review TUI inside Pi. One action
opens a picker of git review targets, launches `tuicr` in an embedded terminal,
and watches tuicr's session files for review comments. Comments written in
tuicr appear in Pi's editor as a single attachment pill and expand into a
formatted request when the prompt is submitted.

It is a Pi extension, not a model-facing tool. It registers no tools and adds
no settings.

## Install

```sh
pi install npm:@luan-pi/pi-tuicr
```

### Requirements

- `tuicr` on `PATH`. tuicr is a third-party code review tool; install it
  separately. The extension checks `tuicr --version` before listing targets and
  reports "Could not start tuicr — is it on your PATH?" if that fails.
- `git` on `PATH`, used to discover a base branch for the branch-comparison
  targets. Without it those two targets are simply omitted.
- Requires a Rust toolchain (https://rustup.rs). The `terminal_bridge` binary
  builds itself on first use under Pi's agent directory
  (`native/terminal-bridge/<version>/`). Set `PI_TERMINAL_BRIDGE_BINARY` to use
  a prebuilt binary. This binary backs the embedded terminal pane.

### Optional companion

`pi install npm:@luan-pi/pi-side-panel` adds a side panel; when it is present,
reviews open as panel tabs, and when it is absent, they open in a fullscreen
overlay. Both modes are described below.

## Use it

The extension registers one action, `side-panel.tuicr.open` ("Review changes
with tuicr"). Running it lists review targets for Pi's current working
directory:

| Target | tuicr arguments |
| --- | --- |
| Uncommitted changes | `-w` |
| Branch vs `<base>` (+ uncommitted) | `-r <base>..HEAD -w` |
| Branch vs `<base>` | `-r <base>..HEAD` |
| Last commit | `-r HEAD~1..HEAD` |
| Pick commits | none (tuicr's own picker) |
| Every tracked file | `-A` |
| Custom revset… | prompts for a revset, then `-r <revset>` |
| Pull request… | prompts for a number, `owner/repo#N`, or URL, then `pr <target>` |

The two branch targets appear only when a base branch is found. The base is the
first of `origin/HEAD`'s target, `origin/main`, `origin/master`, `main`, or
`master` that exists and is not the current branch. Cancelling the revset or PR
prompt, or leaving it empty, aborts without launching anything.

`tuicr` is launched with `--appearance dark` or `--appearance light`, resolved
from Pi's active theme, so embedded truecolor rendering does not depend on a
terminal background query.

### With a side panel

When a side-panel host is attached, each review is a tab labelled "Review" (or
"Review N" once there is more than one). The tab's header action shows the
current target label and reruns `side-panel.tuicr.open`; on an active review
tab that reopens the target picker as a floating overlay over the running
tuicr pane. Picking the same target again closes the picker; picking a
different one restarts tuicr for that target. Cancelling the picker on a tab
that has no target yet closes the tab. The tab closes itself when tuicr exits.
The panel's empty state also gets a "Review" entry that runs the same action.

### Without a side panel

The target list appears in Pi's standard select prompt and tuicr opens in a
fullscreen overlay titled "Review". Closing the overlay or quitting tuicr ends
the review.

### Review comments

Before launching, the extension records the ids of comments that already exist
in tuicr sessions (via `tuicr review list --all` and
`tuicr review comments --session <path>`), so only comments written during
this review are picked up. It then watches tuicr's session directories and
re-reads changed `.json` files, debounced by 25 ms, rather than polling the
CLI. Only sessions whose `repo_path` matches Pi's working directory are
considered; review-level, file-level, and line-level comments are all
collected, and comments with empty content are ignored.

New comments are published into Pi's editor as one "N review comments" pill
backed by a private token appended to the editor text. Hovering the pill shows
a detail card listing each comment with its type and `path:line` anchor. When
the prompt is submitted, the token is replaced with:

```
I reviewed your changes. Please address these comments:

1. `src/one.ts:4` - Updated first issue
2. `src/two.ts` [SUGGESTION] - Second issue
```

Comments whose type is `none` get no bracketed tag. The comment set clears once
Pi confirms that user message started. Disposing the extension (session end or
reload) removes the token from the editor without submitting anything.
Comments still present when a review closes are published as well, so nothing
written in tuicr is lost when it exits.

Session directories are discovered from `tuicr review list --all` and fall
back to tuicr's platform default: `~/Library/Application Support/tuicr/reviews/sessions`
on macOS, `%LOCALAPPDATA%\tuicr\reviews\sessions` on Windows, and
`$XDG_DATA_HOME/tuicr/reviews/sessions` (default `~/.local/share/...`) elsewhere.

## Keybindings

`side-panel.tuicr.open` is registered through `pi-libactions` and has no
default key. Bind it in `keybindings.json` in Pi's agent directory (normally
`~/.pi/agent/keybindings.json`). The file maps action IDs to a key ID or an
array of key IDs:

```json
{
  "side-panel.tuicr.open": "ctrl+shift+r"
}
```

Bindings take effect only when a shortcut host is installed
(`pi install npm:@luan-pi/pi-xsettings` provides one). The file is read on
load, so `/reload` after editing it.

## Settings

None. The package does not read `pi-xsettings` or any configuration file.

## Library API

`src/index.ts` exports `TuicrManager`, `ReviewCommentAttachments`, and the
contents of `src/tuicr-review.ts` (`createTuicrRuntime`, `listTuicrTargets`,
`prepareTuicrReview`, `createTuicrCommentFeed`, `formatTuicrComments`, and
their types). Importing it does not start the extension.

## Layout

| Concern | Owner |
| --- | --- |
| Pi hooks, action and side-panel provider registration, runtime wiring | `src/extension.ts` |
| Review tabs, target picker, PTY lifecycle, overlay fallback | `src/manager.ts` |
| Target list, base-branch discovery, tuicr JSON parsing, session-file watcher, comment formatting | `src/tuicr-review.ts` |
| Editor pill, hover detail card, submit-time expansion | `src/review-comments.ts` |
| Public exports | `src/index.ts` |

## Develop

Source: https://github.com/luan/agents, directory
harnesses/pi/agent/packages/pi-tuicr. Run `bun run typecheck` and
`bun test test` in that directory.

Tests cover target discovery when tuicr is missing, the session-file comment
feed, the editor attachment, and overlay suppression after dispose. They use
injected runtimes and do not run `tuicr` or `git`.
