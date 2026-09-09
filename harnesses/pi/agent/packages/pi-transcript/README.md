# pi-transcript

In fullscreen Pi, consecutive tool calls and thinking blocks occupy one collapsed activity row.
The row shows the latest tool action or provider-supplied thinking heading
(falling back to its latest paragraph). It animates while activity is running.
Click the row to expand or collapse the section; expanded content keeps the
original tool renderers and thinking Markdown, with libtui's scrolling and fold
controls. Failure counts remain visible when collapsed.

User messages, assistant prose, errors, and other messages stay visible and
separate activity sections. Expansion survives streaming updates. Loading a
session rebuilds collapsed sections; history and model-visible content are never
rewritten. Tool output is not discarded.

Install with `pi install ./harnesses/pi/agent/packages/pi-transcript`.
The extension depends only on pi-libtui. It adds no tools or keybindings.
Regular scrollback mode keeps native rendering because Pi's clickable transcript
controls require fullscreen mode.

## Architecture

| Concern | Owner |
| --- | --- |
| Pi registration and lifecycle | `src/extension.ts` |
| Tool definition / execution | None; existing tools execute unchanged |
| State and presentation | `src/activity-transcript.ts` groups native entries and retains fold state |
| Native boundary | `pi-libtui/tool`'s versioned transcript bridge for Pi 0.84–0.85; absent shapes retain native rendering |
| Shared interaction | libtui ToolActivity, ComponentStack, motion, folding and mouse host |
| Public surface | `src/index.ts` exports ActivityTranscript |
