import type { FastifyInstance } from "fastify";
import { Resource, Action } from "@unraidclaw/shared";
import type { GraphQLClient } from "../graphql-client.js";
import { requirePermission } from "../permissions.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";

const execFileAsync = promisify(execFile);

const DEFAULT_CONFIG = "/boot/config/plugins/rclone/.rclone.conf";

function getConfigPath(): string {
  const envPath = process.env.OCC_RCLONE_CONFIG;
  if (envPath && existsSync(envPath)) return envPath;
  if (existsSync(DEFAULT_CONFIG)) return DEFAULT_CONFIG;
  // Fall back to rclone's default (no --config flag)
  return "";
}

function configArgs(): string[] {
  const cfg = getConfigPath();
  return cfg ? ["--config", cfg] : [];
}

const VALID_REMOTE_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_.+-]*$/;
const VALID_RCLONE_PATH_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_.+-]*:[^`$]*$/;

function validateRemoteName(name: string): string | null {
  if (!VALID_REMOTE_RE.test(name)) return "Invalid remote name";
  return null;
}

function validateRclonePath(path: string): string | null {
  if (!VALID_RCLONE_PATH_RE.test(path)) return "Invalid rclone path (expected format: remote:path)";
  return null;
}

interface TransferBody {
  source: string;
  dest: string;
  flags?: string[];
}

export function registerRcloneRoutes(app: FastifyInstance, _gql: GraphQLClient): void {
  // List remotes
  app.get("/api/rclone/remotes", {
    preHandler: requirePermission(Resource.RCLONE, Action.READ),
    handler: async (_req, reply) => {
      try {
        const { stdout } = await execFileAsync("rclone", ["listremotes", ...configArgs()], { timeout: 15_000 });
        const remotes = stdout
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((r) => r.replace(/:$/, ""));
        return reply.send({ ok: true, data: remotes });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to list remotes";
        return reply.status(500).send({
          ok: false,
          error: { code: "RCLONE_ERROR", message },
        });
      }
    },
  });

  // Get remote info
  app.get<{ Params: { name: string } }>("/api/rclone/remotes/:name", {
    preHandler: requirePermission(Resource.RCLONE, Action.READ),
    handler: async (req, reply) => {
      const { name } = req.params;
      const err = validateRemoteName(name);
      if (err) {
        return reply.status(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: err } });
      }

      try {
        const { stdout } = await execFileAsync("rclone", ["about", `${name}:`, "--json", ...configArgs()], { timeout: 30_000 });
        const info = JSON.parse(stdout);
        return reply.send({ ok: true, data: info });
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Failed to get remote info";
        return reply.status(500).send({
          ok: false,
          error: { code: "RCLONE_ERROR", message },
        });
      }
    },
  });

  // List files in remote
  app.get<{ Params: { name: string }; Querystring: { path?: string; recursive?: string } }>(
    "/api/rclone/remotes/:name/ls",
    {
      preHandler: requirePermission(Resource.RCLONE, Action.READ),
      handler: async (req, reply) => {
        const { name } = req.params;
        const err = validateRemoteName(name);
        if (err) {
          return reply.status(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: err } });
        }

        const remotePath = req.query.path ?? "";
        const recursive = req.query.recursive === "true";
        const args = ["lsjson", `${name}:${remotePath}`, ...configArgs()];
        if (!recursive) args.push("--no-modtime");

        try {
          const { stdout } = await execFileAsync("rclone", args, { timeout: 60_000 });
          const files = JSON.parse(stdout);
          return reply.send({ ok: true, data: files });
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : "Failed to list files";
          return reply.status(500).send({
            ok: false,
            error: { code: "RCLONE_ERROR", message },
          });
        }
      },
    }
  );

  // Transfer operations: copy, sync, move
  for (const op of ["copy", "sync", "move"] as const) {
    app.post<{ Body: TransferBody; Querystring: { dry_run?: string } }>(`/api/rclone/${op}`, {
      preHandler: requirePermission(Resource.RCLONE, Action.UPDATE),
      handler: async (req, reply) => {
        const { source, dest, flags = [] } = req.body ?? {};
        const dryRun = req.query.dry_run === "true";

        if (!source || typeof source !== "string") {
          return reply.status(400).send({
            ok: false,
            error: { code: "VALIDATION_ERROR", message: "source is required" },
          });
        }
        if (!dest || typeof dest !== "string") {
          return reply.status(400).send({
            ok: false,
            error: { code: "VALIDATION_ERROR", message: "dest is required" },
          });
        }

        const srcErr = validateRclonePath(source);
        if (srcErr) {
          return reply.status(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: `source: ${srcErr}` } });
        }
        const dstErr = validateRclonePath(dest);
        if (dstErr) {
          return reply.status(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: `dest: ${dstErr}` } });
        }

        if (!Array.isArray(flags) || flags.some((f) => typeof f !== "string")) {
          return reply.status(400).send({
            ok: false,
            error: { code: "VALIDATION_ERROR", message: "flags must be an array of strings" },
          });
        }

        const args = [op, source, dest, ...configArgs(), ...flags];
        if (dryRun) args.push("--dry-run");

        try {
          const { stdout, stderr } = await execFileAsync("rclone", args, { timeout: 600_000 });
          return reply.send({
            ok: true,
            data: { operation: op, source, dest, dry_run: dryRun, output: stdout + stderr },
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : `rclone ${op} failed`;
          return reply.status(500).send({
            ok: false,
            error: { code: "RCLONE_ERROR", message },
          });
        }
      },
    });
  }
}
