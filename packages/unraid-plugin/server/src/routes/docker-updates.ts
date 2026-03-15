import type { FastifyInstance } from "fastify";
import { Resource, Action } from "@unraidclaw/shared";
import type { GraphQLClient } from "../graphql-client.js";
import { requirePermission } from "../permissions.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";

const execFileAsync = promisify(execFile);

const UPDATE_STATUS_PATH = "/var/lib/docker/unraid-update-status.json";
const UPDATE_SCRIPT = "/usr/local/emhttp/plugins/dynamix.docker.manager/scripts/update_container";

interface UpdateStatus {
  id: string;
  name: string;
  image: string;
  hasUpdate: boolean;
  currentDigest?: string;
  latestDigest?: string;
}

async function readUpdateStatus(): Promise<UpdateStatus[]> {
  try {
    const raw = await readFile(UPDATE_STATUS_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as UpdateStatus[];
    return [];
  } catch {
    return [];
  }
}

async function updateContainer(name: string): Promise<string> {
  // Try the Unraid-native update script first
  try {
    const { stdout } = await execFileAsync(UPDATE_SCRIPT, [name], { timeout: 300_000 });
    return stdout;
  } catch {
    // Fallback: docker pull + restart
    const { stdout: inspectOut } = await execFileAsync("docker", ["inspect", "--format", "{{.Config.Image}}", name]);
    const image = inspectOut.trim();
    await execFileAsync("docker", ["pull", image], { timeout: 300_000 });
    await execFileAsync("docker", ["restart", name], { timeout: 60_000 });
    return `Pulled ${image} and restarted ${name}`;
  }
}

export function registerDockerUpdateRoutes(app: FastifyInstance, _gql: GraphQLClient): void {
  // Check for available updates
  app.get("/api/docker/updates", {
    preHandler: requirePermission(Resource.DOCKER, Action.READ),
    handler: async (_req, reply) => {
      const statuses = await readUpdateStatus();
      return reply.send({ ok: true, data: statuses });
    },
  });

  // Update a single container
  app.post<{ Params: { id: string }; Querystring: { dry_run?: string } }>("/api/docker/containers/:id/update", {
    preHandler: requirePermission(Resource.DOCKER, Action.UPDATE),
    handler: async (req, reply) => {
      const { id } = req.params;
      const dryRun = req.query.dry_run === "true";

      if (dryRun) {
        return reply.send({
          ok: true,
          data: { dry_run: true, action: "update_container", container: id },
        });
      }

      try {
        const output = await updateContainer(id);
        return reply.send({ ok: true, data: { container: id, output } });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Update failed";
        return reply.status(500).send({
          ok: false,
          error: { code: "DOCKER_UPDATE_FAILED", message },
        });
      }
    },
  });

  // Update all containers with available updates
  app.post<{ Querystring: { dry_run?: string } }>("/api/docker/update-all", {
    preHandler: requirePermission(Resource.DOCKER, Action.UPDATE),
    handler: async (req, reply) => {
      const dryRun = req.query.dry_run === "true";
      const statuses = await readUpdateStatus();
      const updatable = statuses.filter((s) => s.hasUpdate);

      if (dryRun) {
        return reply.send({
          ok: true,
          data: {
            dry_run: true,
            action: "update_all",
            containers: updatable.map((s) => s.name),
          },
        });
      }

      const results: Array<{ name: string; success: boolean; output?: string; error?: string }> = [];
      for (const status of updatable) {
        try {
          const output = await updateContainer(status.name);
          results.push({ name: status.name, success: true, output });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Update failed";
          results.push({ name: status.name, success: false, error: message });
        }
      }

      return reply.send({ ok: true, data: { updated: results.length, results } });
    },
  });
}
