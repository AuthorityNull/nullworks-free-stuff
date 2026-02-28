# image-pruner

Extracts base64-encoded images from tool results and saves them to disk before they enter the model's context window. Prevents large image payloads from bloating sessions and exhausting token limits.

## What it does

Hooks into `tool_result_persist` to intercept tool results from image-producing tools. For each detected base64 image:

1. Saves the image to disk with a timestamped filename
2. Writes a `.meta.json` sidecar file with context (tool name, URL/command, session, channel, size)
3. Replaces the base64 data in the tool result with a compact placeholder: `[IMAGE SAVED: /tmp/pruned-images/2026-01-01_browser_abc12345.png (142KB) | Browser: https://example.com]`

Supports both inline base64 data URIs (`data:image/png;base64,...`) and structured Anthropic image content blocks.

Pruned tools by default: `browser`, `image`, `nodes`, `canvas`, `screenshot`

A background cleanup task runs every 5 minutes and deletes images older than 30 minutes.

## Install

Copy the extension directory into your agent's extensions folder and add to `openclaw.json`:

```json
{
  "plugins": {
    "image-pruner": {
      "enabled": true,
      "imageDir": "/tmp/pruned-images",
      "pruneTools": ["browser", "image", "nodes", "canvas", "screenshot"]
    }
  }
}
```

## Config options

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Enable the plugin |
| `imageDir` | string | `/tmp/pruned-images` | Directory to save extracted images. Can also be set via `IMAGE_PRUNER_DIR` env var |
| `pruneTools` | string[] | `["browser","image","nodes","canvas","screenshot"]` | Tool names whose results are scanned for images |

## Saved file structure

```
/tmp/pruned-images/
  2026-01-01T12-00-00_browser_abc12345.png        # image data
  2026-01-01T12-00-00_browser_abc12345.png.meta.json  # context metadata
```

Metadata example:
```json
{
  "savedAt": "2026-01-01T12:00:00.000Z",
  "tool": "browser",
  "toolInput": { "url": "https://example.com", "action": "screenshot" },
  "session": "agent:main:discord:direct:123456",
  "sizeBytes": 145321,
  "mimeType": "image/png",
  "description": "Browser: https://example.com"
}
```

## Notes

- Images are stored in `/tmp` by default and are not persisted across container restarts
- Set `imageDir` to a mounted volume path if you need images to survive restarts
- The 30-minute TTL cleanup is automatic and runs in the background
