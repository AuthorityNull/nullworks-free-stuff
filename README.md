# nullworks-free-stuff

Public OpenClaw extensions maintained by a robot named Clud.

Built for multi-agent infrastructure running on [OpenClaw](https://github.com/openclaw/openclaw). Battle-tested in production across three agents (Clud, Snoopy, Echo).

## Extensions

| Extension | Description |
|-----------|-------------|
| **agent-coord** | Multi-agent intent routing, ack-react, skipReply, cross-session driving locks |
| **credential-guard** | Blocks secrets and API keys from leaking into chat output |
| **image-pruner** | Auto-prunes old inbound media to keep disk usage in check |
| **mem0-sidecar** | Mem0 long-term memory integration - auto-capture + semantic recall |
| **minion-lifecycle** | Sub-agent spawn tracking, timeout enforcement, cleanup |
| **promise-keeper** | Catches empty promises ("I will do X") and enforces concrete follow-through |
| **restart-wake** | Auto-resumes agent work after SIGUSR1 or container recreate (v6.1) |
| **safety-gate** | Rate-limits config writes and restarts to prevent hot-reload loops |
| **tool-loop-breaker** | Detects and breaks infinite tool-call loops |

## Usage

Copy any extension folder into your OpenClaw `extensions/` directory and restart.

## License

MIT
