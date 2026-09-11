# Pi package gallery

Gallery previews are captures of real Pi sessions in Bootty, using Maple Mono
and the Tokyo Night palette. Use a separate Pi agent directory and a small demo
project so recordings contain no personal session history.

Pi discovers packages through the `pi-package` keyword. Preview URLs belong in
`package.json` under `pi.image` (PNG) and `pi.video` (MP4). When both are present,
the gallery shows the video. Use H.264, `yuv420p`, and MP4 fast-start for browser
playback.

Capture one useful workflow per extension. Check the actual image and video
before publishing. Host the media as GitHub release assets, verify the public
URLs, then publish a new npm version using the repository release workflow.
Library previews show their components in real consuming extensions and name
the host. Keep UI-free libraries free of extension entry points; declare an
empty `pi.extensions` array so gallery metadata does not trigger extension
auto-discovery.

Reference: [Pi gallery metadata](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md#gallery-metadata).
