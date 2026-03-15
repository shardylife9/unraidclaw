import type { FastifyInstance } from "fastify";
import { Resource, Action } from "@unraidclaw/shared";
import type { GraphQLClient } from "../graphql-client.js";
import { requirePermission } from "../permissions.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

const DEFAULT_COMPOSE_DIR = "/boot/config/plugins/compose.manager/projects";

function getComposeDir(): string {
  return process.env.OCC_COMPOSE_DIR || DEFAULT_COMPOSE_DIR;
}

const VALID_STACK_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

function validateStackName(name: string): string | null {
  if (!VALID_STACK_NAME_RE.test(name)) {
    return "Invalid stack name (alphanumeric, hyphens, and underscores only)";
  }
  return null;
}

function findComposeFile(stackDir: string): string | null {
  for (const name of ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"]) {
    const p = join(stackDir, name);
    if (existsSync(p)) return p;
  }
  return null;
}

export function registerComposeRoutes(app: FastifyInstance, _gql: GraphQLClient): void {
  // List stacks
  app.get("/api/compose/stacks", {
    preHandler: requirePermission(Resource.COMPOSE, Action.READ),
    handler: async (_req, reply) => {
      const dir = getComposeDir();
      if (!existsSync(dir)) {
        return reply.send({ ok: true, data: [] });
      }

      try {
        const entries = await readdir(dir, { withFileTypes: true });
        const stacks: Array<{ name: string; hasComposeFile: boolean; status?: unknown }> = [];
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const stackDir = join(dir, entry.name);
          const composeFile = findComposeFile(stackDir);
          stacks.push({ name: entry.name, hasComposeFile: composeFile !== null });
        }

        // Enrich with runtime status from docker compose ls
        try {
          const { stdout } = await execFileAsync("docker", ["compose", "ls", "--format", "json"], { timeout: 15_000 });
          const running = JSON.parse(stdout) as Array<{ Name: string; Status: string; ConfigFiles: string }>;
          const runMap = new Map(running.map((r) => [r.Name, r.Status]));
          for (const stack of stacks) {
            const status = runMap.get(stack.name);
            if (status) stack.status = status;
          }
        } catch {
          // docker compose ls not available; leave status undefined
        }

        return reply.send({ ok: true, data: stacks });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to list stacks";
        return reply.status(500).send({
          ok: false,
          error: { code: "COMPOSE_ERROR", message },
        });
      }
    },
  });

  // Get stack detail
  app.get<{ Params: { name: string } }>("/api/compose/stacks/:name", {
    preHandler: requirePermission(Resource.COMPOSE, Action.READ),
    handler: async (req, reply) => {
      const { name } = req.params;
      const err = validateStackName(name);
      if (err) {
        return reply.status(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: err } });
      }

      const stackDir = join(getComposeDir(), name);
      const composeFile = findComposeFile(stackDir);
      if (!composeFile) {
        return reply.status(404).send({
          ok: false,
          error: { code: "NOT_FOUND", message: `Stack '${name}' not found or has no compose file` },
        });
      }

      try {
        const content = await readFile(composeFile, "utf-8");

        let containers: unknown[] = [];
        try {
          const { stdout } = await execFileAsync(
            "docker",
            ["compose", "-f", composeFile, "ps", "--format", "json"],
            { timeout: 15_000 }
          );
          // docker compose ps --format json outputs one JSON object per line
          containers = stdout
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line));
        } catch {
          // Containers may not be running
        }

        return reply.send({
          ok: true,
          data: { name, composeFile, content, containers },
        });
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Failed to read stack";
        return reply.status(500).send({
          ok: false,
          error: { code: "COMPOSE_ERROR", message },
        });
      }
    },
  });

  // Stack control actions: up, down, pull, restart
  for (const action of ["up", "down", "pull", "restart"] as const) {
    app.post<{ Params: { name: string }; Querystring: { dry_run?: string } }>(
      `/api/compose/stacks/:name/${action}`,
      {
        preHandler: requirePermission(Resource.COMPOSE, Action.UPDATE),
        handler: async (req, reply) => {
          const { name } = req.params;
          const err = validateStackName(name);
          if (err) {
            return reply.status(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: err } });
          }
          const dryRun = req.query.dry_run === "true";

          const stackDir = join(getComposeDir(), name);
          const composeFile = findComposeFile(stackDir);
          if (!composeFile) {
            return reply.status(404).send({
              ok: false,
              error: { code: "NOT_FOUND", message: `Stack '${name}' not found or has no compose file` },
            });
          }

          if (dryRun) {
            return reply.send({
              ok: true,
              data: { dry_run: true, action, stack: name, composeFile },
            });
          }

          const args = ["compose", "-f", composeFile];
          if (action === "up") {
            args.push("up", "-d");
          } else {
            args.push(action);
          }

          try {
            const { stdout, stderr } = await execFileAsync("docker", args, { timeout: 300_000 });
            return reply.send({
              ok: true,
              data: { action, stack: name, output: stdout + stderr },
            });
          } catch (e: unknown) {
            const message = e instanceof Error ? e.message : `compose ${action} failed`;
            return reply.status(500).send({
              ok: false,
              error: { code: "COMPOSE_ERROR", message },
            });
          }
        },
      }
    );
  }

  // Stack logs
  app.get<{ Params: { name: string }; Querystring: { tail?: string } }>(
    "/api/compose/stacks/:name/logs",
    {
      preHandler: requirePermission(Resource.COMPOSE, Action.READ),
      handler: async (req, reply) => {
        const { name } = req.params;
        const err = validateStackName(name);
        if (err) {
          return reply.status(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: err } });
        }

        const stackDir = join(getComposeDir(), name);
        const composeFile = findComposeFile(stackDir);
        if (!composeFile) {
          return reply.status(404).send({
            ok: false,
            error: { code: "NOT_FOUND", message: `Stack '${name}' not found or has no compose file` },
          });
        }

        const tail = Math.min(Math.max(parseInt(req.query.tail || "100", 10) || 100, 1), 5000);
        try {
          const { stdout, stderr } = await execFileAsync(
            "docker",
            ["compose", "-f", composeFile, "logs", "--tail", String(tail)],
            { timeout: 30_000 }
          );
          return reply.send({ ok: true, data: { stack: name, logs: stdout + stderr } });
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : "Failed to get logs";
          return reply.status(500).send({
            ok: false,
            error: { code: "COMPOSE_ERROR", message },
          });
        }
      },
    }
  );
}
