# Image Pruner (`image-pruner`)

## What it does
Removes large base64 image payloads from tool results, saves image files to disk, and replaces payloads with small placeholders.

## When to use it / why it exists
- Your sessions include screenshots/image data and context size grows too fast.
- You want to keep artifacts while preventing transcript bloat.

## How it works (high-level)
- Hooks `tool_result_persist`.
- For configured tools, scans result content for:
  - `data:image/...;base64,...` strings
  - structured image blocks (`type: image`, `source.type: base64`)
- Saves image to disk with timestamp/hash filename.
- Writes sidecar metadata (`.meta.json`) with tool/session/context info.
- Replaces base64 content with `[IMAGE SAVED: ...]` marker.
- Background cleanup removes old files (TTL 30 minutes, check every 5 minutes).

## Config reference
From `openclaw.plugin.json`:
- `enabled` (boolean)
- `pruneTools` (string[])

Used by code (not in manifest schema):
- `imageDir` (string)

Environment variable:
- `IMAGE_PRUNER_DIR` (fallback directory if `imageDir` not set)

Defaults in code:
- `pruneTools`: `['browser','image','nodes','canvas','screenshot']` in code initialization
- `imageDir`: `/tmp/pruned-images`

## Typical tweaks
```json
{
  "image-pruner": {
    "enabled": true,
    "pruneTools": ["browser", "image", "nodes"],
    "imageDir": "/tmp/pruned-images"
  }
}
```

- Add/remove tools in `pruneTools` to control scope.
- Set `imageDir` to a persistent volume if you need longer retention.

## Safe defaults / gotchas
- Metadata can contain tool inputs/URLs/commands - treat directory as sensitive.
- Cleanup TTL is hardcoded in code (30m), not configurable via manifest.
- The plugin mutates persisted tool messages; this is intentional.

## Validation checklist
- Run image-producing tool and confirm result text contains `[IMAGE SAVED: ...]`.
- Check image and `.meta.json` file exist in configured dir.
- Wait past TTL and confirm cleanup job removes old files.
