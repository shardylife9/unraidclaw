<p align="center">
  <img src="packages/unraid-plugin/src/usr/local/emhttp/plugins/unraidclaw/unraidclaw.png" width="96" alt="UnraidClaw logo" />
</p>

<h1 align="center">UnraidClaw</h1>

<p align="center">
  AI Agent Gateway for Unraid. Permission-enforcing REST API that lets AI agents manage your server.
</p>

<p align="center">
  <a href="https://github.com/shardylife9/unraidclaw/releases"><img src="https://img.shields.io/github/v/release/shardylife9/unraidclaw" alt="Release" /></a>
  <a href="https://www.npmjs.com/package/unraidclaw"><img src="https://img.shields.io/npm/v/unraidclaw" alt="npm" /></a>
  <img src="https://img.shields.io/badge/unraid-7.0%2B-orange" alt="Unraid 7.0+" />
  <img src="https://img.shields.io/badge/node-22%2B-green" alt="Node 22+" />
</p>

---

UnraidClaw sits between AI agents and your Unraid server, providing a unified REST API with fine-grained access control. It combines Unraid's GraphQL API with direct system integration (CLI commands for Docker, VMs, parity checks, rclone, Docker Compose; filesystem operations for share config editing and notification management) to expose capabilities that no single Unraid API covers. Every call is authenticated, authorized against a configurable permission matrix, and logged.

## Features

- **60+ tools** across 15 categories: Docker, Docker Updates, VMs, VM Config, Array, Disks, Shares, System, Notifications, Network, Users, Logs, GraphQL, Rclone, Docker Compose
- **28 permission keys** in a resource:action matrix, configurable from the WebGUI
- **Dry-run mode** on all write endpoints — preview changes before executing
- **GraphQL escape hatch** for arbitrary queries beyond built-in tools
- **Docker update management** — check for and apply container image updates
- **Rclone cloud storage** — manage remotes, browse files, copy/sync/move
- **Docker Compose** — manage stacks (up, down, pull, restart, logs)
- **VM config generation** — generate libvirt XML and define VMs with templates
- **HTTPS** with auto-generated self-signed TLS certificate
- **SHA-256 API key** authentication with rate limiting
- **Activity logging** with JSONL format, filter, and search
- **OpenClaw plugin** available on npm (`openclaw plugins install unraidclaw`)
- **MCP server** available for Claude Code and other MCP-compatible agents
- **Single-file server**, no `node_modules` needed on Unraid

## Requirements

- **Unraid 7.0.0+** (Node.js 22 is built-in)
- **Rclone plugin** (optional, for rclone features)
- **Docker Compose Manager plugin** (optional, for compose features)

## Installation

### From Community Applications

Search for **UnraidClaw** in the Unraid CA store and click Install.

### Manual install

```bash
# Download and install the plugin
plugin install https://raw.githubusercontent.com/shardylife9/unraidclaw/main/packages/unraid-plugin/unraidclaw.plg
```

### Setup

1. Go to **Settings > Management Access** in the Unraid WebGUI, scroll to the API section, and copy your Unraid API key (must have **ADMIN** role)
2. Go to **Settings > UnraidClaw**, paste the Unraid API key into the **Unraid API Key** field
3. Generate an UnraidClaw API key (it's hashed with SHA-256; save it, it won't be shown again)
4. Configure permissions on the **Permissions** tab
5. Set Service to **Enabled** and click Apply

The server starts on port `9876` over HTTPS by default. A self-signed TLS certificate is auto-generated on first start.

## API

All endpoints return a consistent envelope:

```json
{
  "ok": true,
  "data": { ... }
}
```

Authentication via `x-api-key: <api-key>` header.

### Dry-Run Mode

All write endpoints support dry-run mode. Add `?dry_run=true` to preview what would happen without executing:

```bash
curl -X POST "https://unraid:9876/api/docker/containers/abc/start?dry_run=true" \
  -H "x-api-key: YOUR_KEY"
```

Returns `{ "ok": true, "data": { "dry_run": true, "would_execute": "...", "description": "..." } }`

### Endpoints

| Category | Method | Endpoint | Permission |
|----------|--------|----------|------------|
| **Health** | GET | `/api/health` | none |
| **Docker** | GET | `/api/docker/containers` | `docker:read` |
| | GET | `/api/docker/containers/:id` | `docker:read` |
| | GET | `/api/docker/containers/:id/logs` | `docker:read` |
| | POST | `/api/docker/containers` | `docker:create` |
| | POST | `/api/docker/containers/:id/:action` | `docker:update` |
| | DELETE | `/api/docker/containers/:id` | `docker:delete` |
| **Docker Updates** | GET | `/api/docker/updates` | `docker:read` |
| | POST | `/api/docker/containers/:id/update` | `docker:update` |
| | POST | `/api/docker/update-all` | `docker:update` |
| **VMs** | GET | `/api/vms` | `vms:read` |
| | GET | `/api/vms/:id` | `vms:read` |
| | POST | `/api/vms/:id/:action` | `vms:update` |
| | DELETE | `/api/vms/:id` | `vms:delete` |
| **VM Config** | POST | `/api/vms/generate-xml` | `vms:create` |
| | POST | `/api/vms/define` | `vms:create` |
| **Array** | GET | `/api/array/status` | `array:read` |
| | GET | `/api/array/parity/status` | `array:read` |
| | POST | `/api/array/start` | `array:update` |
| | POST | `/api/array/stop` | `array:update` |
| | POST | `/api/array/parity/start` | `array:update` |
| | POST | `/api/array/parity/pause` | `array:update` |
| | POST | `/api/array/parity/resume` | `array:update` |
| | POST | `/api/array/parity/cancel` | `array:update` |
| **Disks** | GET | `/api/disks` | `disk:read` |
| | GET | `/api/disks/:id` | `disk:read` |
| **Shares** | GET | `/api/shares` | `share:read` |
| | GET | `/api/shares/:name` | `share:read` |
| | PATCH | `/api/shares/:name` | `share:update` |
| **System** | GET | `/api/system/info` | `info:read` |
| | GET | `/api/system/metrics` | `info:read` |
| | GET | `/api/system/services` | `services:read` |
| | POST | `/api/system/reboot` | `os:update` |
| | POST | `/api/system/shutdown` | `os:update` |
| **Notifications** | GET | `/api/notifications` | `notification:read` |
| | GET | `/api/notifications/overview` | `notification:read` |
| | POST | `/api/notifications` | `notification:create` |
| | POST | `/api/notifications/:id/archive` | `notification:update` |
| | DELETE | `/api/notifications/:id` | `notification:delete` |
| **Network** | GET | `/api/network` | `network:read` |
| **Users** | GET | `/api/users/me` | `me:read` |
| **Logs** | GET | `/api/logs/syslog` | `logs:read` |
| **GraphQL** | POST | `/api/graphql` | `graphql:read` / `graphql:update` |
| **Rclone** | GET | `/api/rclone/remotes` | `rclone:read` |
| | GET | `/api/rclone/remotes/:name` | `rclone:read` |
| | GET | `/api/rclone/remotes/:name/ls` | `rclone:read` |
| | POST | `/api/rclone/copy` | `rclone:update` |
| | POST | `/api/rclone/sync` | `rclone:update` |
| | POST | `/api/rclone/move` | `rclone:update` |
| **Compose** | GET | `/api/compose/stacks` | `compose:read` |
| | GET | `/api/compose/stacks/:name` | `compose:read` |
| | POST | `/api/compose/stacks/:name/up` | `compose:update` |
| | POST | `/api/compose/stacks/:name/down` | `compose:update` |
| | POST | `/api/compose/stacks/:name/pull` | `compose:update` |
| | POST | `/api/compose/stacks/:name/restart` | `compose:update` |
| | GET | `/api/compose/stacks/:name/logs` | `compose:read` |

### Docker create

`POST /api/docker/containers` accepts:

```json
{
  "image": "vikunja/vikunja:latest",
  "name": "vikunja",
  "ports": ["3456:3456"],
  "volumes": ["/mnt/cache/appdata/vikunja:/app/vikunja/files"],
  "env": ["VIKUNJA_SERVICE_TIMEZONE=Europe/London"],
  "restart": "unless-stopped",
  "network": "bridge",
  "icon": "https://example.com/icon.png",
  "webui": "http://[IP]:[PORT:3456]/"
}
```

Only `image` is required. The container is started immediately and an Unraid dockerMan XML template is created so it appears in the Docker tab.

### Docker actions

`POST /api/docker/containers/:id/:action` where action is one of: `start`, `stop`, `restart`, `pause`, `unpause`

### Docker updates

```bash
# Check which containers have updates available
GET /api/docker/updates

# Update a single container
POST /api/docker/containers/:id/update

# Update all containers with available updates
POST /api/docker/update-all
```

### VM actions

`POST /api/vms/:id/:action` where action is one of: `start`, `stop`, `force-stop`, `pause`, `resume`, `reboot`, `reset`

### VM config generation

```bash
# Generate libvirt XML for a new VM
POST /api/vms/generate-xml
{
  "name": "ubuntu-server",
  "memory_mb": 4096,
  "vcpus": 4,
  "os_type": "linux",
  "disk_path": "/mnt/user/domains/ubuntu/vdisk1.img",
  "disk_size_gb": 50,
  "iso_path": "/mnt/user/isos/ubuntu-24.04.iso",
  "network": "br0"
}

# Generate XML AND define the VM (ready to start)
POST /api/vms/define
```

Supported `os_type` values: `linux`, `windows`, `macos`. Windows VMs get HyperV features; macOS gets the Penryn CPU model.

### Share update

`PATCH /api/shares/:name` accepts:

```json
{
  "comment": "My share description",
  "allocator": "highwater",
  "splitLevel": "1",
  "floor": "0"
}
```

### GraphQL proxy

Execute any GraphQL query or mutation against Unraid's API:

```bash
POST /api/graphql
{
  "query": "{ info { os { hostname uptime } } }",
  "variables": {}
}
```

Queries require `graphql:read` permission; mutations require `graphql:update`.

### Rclone operations

```bash
# List configured remotes
GET /api/rclone/remotes

# Browse files on a remote
GET /api/rclone/remotes/gdrive/ls?path=backups&recursive=false

# Copy files (supports dry_run)
POST /api/rclone/copy
{ "source": "gdrive:backups", "dest": "/mnt/user/backups" }

# Sync (mirror source to dest)
POST /api/rclone/sync
{ "source": "/mnt/user/media", "dest": "b2:my-bucket/media" }
```

Requires the rclone plugin to be installed on Unraid.

### Docker Compose

```bash
# List all stacks
GET /api/compose/stacks

# Start a stack
POST /api/compose/stacks/my-stack/up

# Stop a stack
POST /api/compose/stacks/my-stack/down

# Pull latest images
POST /api/compose/stacks/my-stack/pull

# View logs
GET /api/compose/stacks/my-stack/logs?tail=200
```

Requires the Docker Compose Manager plugin.

## MCP Server

An MCP (Model Context Protocol) server is available for Claude Code and other MCP-compatible agents. Install it alongside the Unraid plugin:

```json
{
  "mcpServers": {
    "unraidclaw": {
      "type": "stdio",
      "command": "uv",
      "args": ["--directory", "/path/to/unraidclaw_mcp", "run", "unraidclaw-mcp"],
      "env": {
        "UNRAIDCLAW_API_KEY": "your-api-key"
      }
    }
  }
}
```

The MCP server exposes 47 tools covering all gateway features.

## OpenClaw Plugin

The [OpenClaw](https://github.com/openclaw/openclaw) plugin exposes all tools to any AI agent that supports the OpenClaw protocol.

### Install

```bash
openclaw plugins install unraidclaw
```

### Configure

Edit `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "allow": ["unraidclaw"],
    "entries": {
      "unraidclaw": {
        "config": {
          "serverUrl": "https://YOUR_UNRAID_IP:9876",
          "apiKey": "YOUR_API_KEY",
          "tlsSkipVerify": true
        }
      }
    }
  }
}
```

Set `tlsSkipVerify: true` when using the auto-generated self-signed certificate.

## Permissions

Permissions use a `resource:action` format. Configure them from the WebGUI Permissions tab or edit `/boot/config/plugins/unraidclaw/permissions.json` directly.

| Category | Permissions |
|----------|------------|
| Docker | `docker:read`, `docker:create`, `docker:update`, `docker:delete` |
| VMs | `vms:read`, `vms:create`, `vms:update`, `vms:delete` |
| Array & Storage | `array:read`, `array:update`, `disk:read`, `share:read`, `share:update` |
| System | `info:read`, `os:update`, `services:read` |
| Notifications | `notification:read`, `notification:create`, `notification:update`, `notification:delete` |
| Network | `network:read` |
| Users | `me:read` |
| Logs | `logs:read` |
| GraphQL | `graphql:read`, `graphql:update` |
| Rclone | `rclone:read`, `rclone:update` |
| Compose | `compose:read`, `compose:update` |

The WebGUI includes presets: **Read Only**, **Docker Manager**, **VM Manager**, **Full Admin**, and **None**.

New permissions added on upgrade are disabled by default — existing permissions are preserved.

## Architecture

```
                                                        GraphQL ──> Unraid API
                                                       /            (list queries, array, disks)
┌─────────────┐     HTTPS      ┌──────────────────┐──+
│  AI Agent   │ ──────────────> │   UnraidClaw     │   \
│ (MCP/OClaw) │   x-api-key    │   (Fastify)      │    CLI ──────> docker, virsh, mdcmd,
└─────────────┘                 │                  │   /            rclone, docker compose,
                                │  - Auth          │──+             reboot, ip, qemu-img
                                │  - Permissions   │   \
                                │  - Activity Log  │    Filesystem > share configs, syslog,
                                │  - Dry-Run       │                 notifications, compose
                                └──────────────────┘                 projects
```

This is a pnpm monorepo with three packages:

| Package | Description |
|---------|-------------|
| `packages/shared` | Shared TypeScript types, permission definitions, API interfaces |
| `packages/unraid-plugin/server` | Fastify REST API server, bundles to a single CJS file |
| `packages/openclaw-plugin` | OpenClaw plugin, bundles to a single ESM file, published to npm as `unraidclaw` |

## Security

- API keys are hashed with SHA-256 before storage; the plaintext key is never persisted
- Rate limiting on authentication (10 attempts/minute per IP)
- All requests require authentication via `x-api-key` header
- Every API call is checked against the permission matrix before execution
- Activity logging records all requests with timestamps, endpoints, and results
- HTTPS with auto-generated EC (prime256v1) certificates, 10-year validity
- CORS restricted to local network origins only
- Input validation on all endpoints with protection against command injection and path traversal
- The server runs locally on your Unraid box, no cloud dependencies

## License

MIT
