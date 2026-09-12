# Pi package gallery

Gallery previews are captures of real Pi sessions in Bootty, using Maple Mono
and the Tokyo Night palette. Use a separate Pi agent directory and a small demo
project so recordings contain no personal session history.

Pi discovers packages through the `pi-package` keyword. Preview URLs belong in
`package.json` under `pi.image` (PNG) and `pi.video` (MP4). When both are present,
the gallery shows the video. Use H.264, `yuv420p`, and MP4 fast-start for browser
playback.

Capture one complete workflow per extension: a concrete starting task, the
extension's distinguishing interaction, and a visible result. For example,
an annotation preview should show selection, saved feedback, submission, and
the response using that feedback. A picker or unfinished draft alone is not
a completed demonstration.

Keep recording until the result is visible and verified. Do not use a fixed
recording deadline as the ending. Trim idle time while preserving the actions
needed to understand the result. Inspect the exported video, including every
cut's beginning and end and the final frame; file validity alone does not
establish that the workflow is shown. Check screenshots at their published
size for readable content. Document omitted recovery steps, resumed sessions,
and editorial input images so the preview does not imply a different flow.

Library previews show their components in real consuming extensions and name
the host. Show an actual interaction and its effect, rather than a palette
sample or a separate showcase renderer. Keep UI-free libraries free of extension
entry points; declare an empty `pi.extensions` array so gallery metadata does
not trigger extension auto-discovery.

After content review, store previews in `site/media/previews/` with a content
hash in each filename. Use absolute `https://pi.luan.sh/media/previews/` URLs in
package metadata and READMEs. Verify the deployed public URLs before publishing
a new npm version through the repository release workflow.

Reference: [Pi gallery metadata](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md#gallery-metadata).
