# pi-transcript

`pi-transcript` folds runs of tool calls and thinking blocks in Pi's fullscreen
transcript into one collapsed activity row. The row shows the latest tool action
or the latest provider-supplied thinking heading, a step count, and a failure
count. Click it to expand the run back into the original tool renderers and
thinking Markdown. User messages, assistant prose, errors, and other entries stay
visible and separate one run from the next.

It is a Pi extension, not a model-facing tool. It changes only how existing
transcript components are laid out on screen. Session history, tool output, and
model-visible content are never rewritten.

## Preview

![pi-transcript in Bootty](https://github.com/luan/agents/releases/download/v0.2.2/pi-transcript.png)

[Watch the demo](https://github.com/luan/agents/releases/download/v0.2.2/pi-transcript.mp4).

## Install

```sh
pi install npm:@luan-pi/pi-transcript
```

That is the only step. The package ships its rendering library and mouse host
with it and registers both through `package.json`; nothing else needs to be
installed. It runs inside Pi (`@earendil-works/pi-coding-agent` with
`@earendil-works/pi-tui`); 0.84.2 is the tested version.

Optional companion: `pi install npm:@luan-pi/pi-xsettings` adds the
`/xsettings` UI for the shared appearance settings (activity indicator, text
effects, animation speed) that the collapsed row uses; without it the compiled
defaults apply.

## Use it

There are no commands, tools, actions, or side-panel tabs. The extension does
its work on `session_start`:

- In interactive TUI mode it installs a hidden widget (`pi-transcript.host`)
  that mounts a transcript projection over Pi's chat container.
- In fullscreen mode, consecutive `thinking` and tool entries become one
  `ActivitySection`. Its header row shows the summary, a `N steps` count, and
  `M failed` when any tool in the run failed. The row animates while any
  entry is still running.
- Clicking the row toggles between collapsed and expanded. Expanded content is
  the original components, so tool renderers, thinking Markdown, and libtui's
  scrolling and fold controls behave as they do natively.
- Entries that are not tools or thinking (`content` entries) are rendered
  unchanged and end the current run.
- Streaming updates keep the current fold state and refresh the header summary
  as new headings arrive. Loading a session rebuilds collapsed sections.
- On `session_shutdown`, or when the widget is disposed, the projection is
  released and Pi's native rendering returns.

Regular scrollback mode keeps native rendering: `mountTranscriptProjection`
projects entries only when `tui.mode === "fullscreen"`, because Pi's clickable
transcript controls need the fullscreen surface.

### Header summary

`activitySummary` picks the header text:

- Tool entries use the tool's own summary with leading punctuation stripped.
- Thinking entries use the last `**bold**` or `#` heading in the final 8,000
  characters of the thought; without a heading they use the first line of the
  last paragraph, and finally the literal `Thinking`. No summary is invented.
- The result is passed through `sanitizeTuiFieldPreview`, which removes
  control sequences and caps the text at 240 characters.

## Settings and keybindings

The package registers no settings, no actions, and no keybindings. The only
input it handles is a mouse press on the activity row, provided by
the bundled `pi-libtui` mouse host. There is nothing to add to
`~/.pi/agent/keybindings.json` for this package. The running indicator and
text effects follow `pi-libtui`'s shared appearance settings (`activityIndicator`,
default `spinner`; `textEffect`, default `off`; `animationSpeed`, default
`normal`; and the other keys documented in the `@luan-pi/pi-libtui` README).
These are edited via `/xsettings` when `@luan-pi/pi-xsettings` is installed;
otherwise the defaults apply.

## Library API

`import { ActivityTranscript } from "@luan-pi/pi-transcript"` gives a
`ComponentStack` that takes an entry reader, a Pi `Theme`, and a
`requestRender` callback. It groups `TranscriptEntry` values from
`@luan-pi/pi-libtui/tool` and owns the fold state of each section. Pass it to
`mountTranscriptProjection` to use it outside this extension, or render it
directly in tests. It has no native binary.

## Native boundary

`@luan-pi/pi-libtui/tool` supplies the versioned transcript bridge. It reads Pi 0.84–0.85
private transcript fields, guards each node's shape, and fails open: when the
document layout does not match, when a node is not a recognised assistant or
tool component, or when a projection is already installed, the transcript is
left untouched. Unknown nodes and native error notices render as they are.

## Layout

| Responsibility | Owner |
| --- | --- |
| Pi registration, widget lifecycle, session hooks | `src/extension.ts` |
| Grouping entries into sections and fold state | `src/activity-transcript.ts` (`ActivityTranscript`, `ActivitySection`) |
| Header text for a run | `activitySummary` in `src/activity-transcript.ts` |
| Public exports | `src/index.ts` |
| Native transcript bridge | `mountTranscriptProjection` in `@luan-pi/pi-libtui/tool` |
| Row rendering, motion, folding, mouse | `ToolActivity`, `ComponentStack`, and the mouse host in `@luan-pi/pi-libtui` |
| Tool execution | None; existing tools run unchanged |

## Develop

Source: https://github.com/luan/agents, directory
`harnesses/pi/agent/packages/pi-transcript`. Run `bun run typecheck` and
`bun test test` in that directory.

`test/transcript.test.ts` drives a real `TuiAltScreen` with native
`AssistantMessageComponent` and `ToolExecutionComponent` instances and checks
collapse, click expansion, streaming updates, failure counts, unmount
behaviour, and summary sanitisation.
