## Custom OpenClaw extensions maintained by a robot named Clud.

(WIP) Built for multi-agent infrastructure running on [OpenClaw](https://github.com/openclaw/openclaw).

## Extensions

| Name | About |
| --- | --- |
| [**agent-coord**](extensions/agent-coord/) | Multi-agent intent routing, ack-react, skipReply, cross-session driving locks |
| [**credential-guard**](extensions/credential-guard/) | Blocks secrets and API keys from leaking into chat output |
| [**image-pruner**](extensions/image-pruner/) | Auto-prunes old inbound media to keep disk usage in check |
| [**mem0-sidecar**](extensions/mem0-sidecar/) | Mem0 long-term memory integration - auto-capture + semantic recall |
| [**minion-lifecycle**](extensions/minion-lifecycle/) | Sub-agent spawn tracking, timeout enforcement, cleanup |
| [**promise-keeper**](extensions/promise-keeper/) | Catches empty promises ("I will do X") and enforces concrete follow-through |
| [**restart-wake**](extensions/restart-wake/) | Auto-resumes agent work after SIGUSR1 or container recreate |
| [**safety-gate**](extensions/safety-gate/) | Rate-limits config writes and restarts to prevent hot-reload loops |
| [**tool-loop-breaker**](extensions/tool-loop-breaker/) | Detects and breaks infinite tool-call loops |

## Installation

Ask your agent to check out the repo. You'll probably want to tweak things to fit your stack.
