# Forge UI Public Export

Public-safe export of the Forge frontend package.

## What this includes

- `forge/ui/` - the Vite + React frontend
- `forge/lib/` - selected helper modules used by the Studio UI flows

## What this does not include

- backend server runtime
- Docker deployment files
- webhook simulation helpers
- internal security and infrastructure docs
- private operational config

## Notes

This export is intentionally product-specific. It preserves Forge and Echo Studio naming found in the frontend code, but excludes private infrastructure and secret material.

## Build

```bash
cd forge/ui
npm install
npm run build
```

## Review status

This export was assembled from a larger private repository, then manually pruned and reviewed for:

- secrets and token-like material
- private hostnames and host paths
- tunnel and runtime auth artifacts
- internal-only operational docs and deployment files

No public push has been performed by this file alone. Review the final diff and remote configuration before publishing.
