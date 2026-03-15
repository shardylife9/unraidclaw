**UnraidClaw** is a permission-enforcing REST API gateway that lets AI agents manage your Unraid server.

It provides a unified REST API with fine-grained access control for Docker, VMs, Array, Shares, System, Notifications, Network, Rclone, Docker Compose, and raw GraphQL access.

**v0.2.0 Features:**
- GraphQL escape hatch for arbitrary queries
- Docker container update management
- Rclone cloud storage operations (copy, sync, move)
- Docker Compose stack management (up, down, pull, restart, logs)
- VM configuration generation with libvirt XML templates
- Dry-run mode on all write endpoints
- 28 permission keys in resource:action matrix
- SHA-256 API key authentication with rate limiting
- HTTPS with auto-generated TLS certificate
- Activity logging with JSONL format
- Requires Node.js 22+ (built-in on Unraid 7.x)
