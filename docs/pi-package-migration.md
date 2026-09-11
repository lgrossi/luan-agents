# Pi package migration — 0.3.1

The packages have moved from `@luan-pi` to the names below. Annotations are now
part of Copy Mode; Tool Search remains independently installable.

| Previous package | Replacement |
| --- | --- |
| `@luan-pi/pi-annotations` | `pi-copy-mode` |
| `@luan-pi/pi-apply-patch` | `pi-fileops` |
| `@luan-pi/pi-code-mode` | `pi-codemode` |
| `@luan-pi/pi-codex-native` | `pi-codex-native` |
| `@luan-pi/pi-copy-mode` | `pi-copy-mode` |
| `@luan-pi/pi-custom-editor` | `pi-custom-editor` |
| `@luan-pi/pi-developer-prompt` | `pi-developer-messages` |
| `@luan-pi/pi-exec-command` | `pi-exec-command` |
| `@luan-pi/pi-libactions` | `pi-libactions` |
| `@luan-pi/pi-libtui` | `pi-libtui` |
| `@luan-pi/pi-prompt-storage` | `pi-prompt-storage` |
| `@luan-pi/pi-side-chat` | `pi-side` |
| `@luan-pi/pi-side-panel` | `pi-panels` |
| `@luan-pi/pi-skills` | `pi-skills` |
| `@luan-pi/pi-subagents` | `@cfcluan/pi-subagents` |
| `@luan-pi/pi-thinking-binding` | `pi-thinking-binding` |
| `@luan-pi/pi-tool-search` | `@cfcluan/pi-tool-search` |
| `@luan-pi/pi-transcript` | `pi-collapse` |
| `@luan-pi/pi-tuicr` | `@cfcluan/pi-tuicr` |
| `@luan-pi/pi-view-image` | `pi-view-image` |
| `@luan-pi/pi-xsettings` | `pi-xsettings` |

Remove each old package you use, then install its replacement. For example:

```sh
pi remove npm:@luan-pi/pi-copy-mode
pi remove npm:@luan-pi/pi-annotations
pi install npm:pi-copy-mode
```

Only remove packages you have installed. Restart Pi afterward. Do not load the
old and new packages together: both may register the same feature. Existing
action IDs, keybindings, settings namespaces, and versioned capability identifiers
retain their names. No manual settings-file migration is required.

Library consumers must update npm dependencies and imports to the new package
names. Annotation exports moved to `pi-copy-mode/annotations` and the Copy Mode
root. The old published versions remain available; deprecation messages identify
the replacements.

`pi-fileops` currently supplies `apply_patch`. Its tool name, native binary, and
`PI_APPLY_PATCH_BIN` override retain their existing names.

Tool Search is available as `@cfcluan/pi-tool-search`, both directly and inside
Code Mode. Code Mode continues to own tool placement.

The gallery media in this release shows real Bootty workflows. The combined
Copy Mode video covers selection/copying and comments/reactions; its README links
to the two individual workflows as well.

The attempted `pi-code-mode` publication was rejected by npm because of its
unpublished registry record. Code Mode is published as `pi-codemode`; its
`pi-code-mode` settings namespace and capability IDs are unchanged.
