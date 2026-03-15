import type { FastifyInstance } from "fastify";
import { Resource, Action } from "@unraidclaw/shared";
import type { GraphQLClient } from "../graphql-client.js";
import { requirePermission } from "../permissions.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const execFileAsync = promisify(execFile);

interface VMConfigBody {
  name: string;
  memory_mb: number;
  vcpus: number;
  os_type?: string;
  disk_path?: string;
  disk_size_gb?: number;
  iso_path?: string;
  network?: string;
  gpu_passthrough?: string;
}

const VALID_VM_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const VALID_PATH_RE = /^\/[a-zA-Z0-9/_.-]+$/;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function validateVMConfig(body: VMConfigBody): string | null {
  if (!body.name || !VALID_VM_NAME_RE.test(body.name)) {
    return "Invalid VM name (alphanumeric, dots, dashes, underscores)";
  }
  if (!body.memory_mb || body.memory_mb < 128 || body.memory_mb > 1048576) {
    return "memory_mb must be between 128 and 1048576";
  }
  if (!body.vcpus || body.vcpus < 1 || body.vcpus > 256) {
    return "vcpus must be between 1 and 256";
  }
  if (body.disk_path && !VALID_PATH_RE.test(body.disk_path)) {
    return "Invalid disk_path (must be an absolute path)";
  }
  if (body.iso_path && !VALID_PATH_RE.test(body.iso_path)) {
    return "Invalid iso_path (must be an absolute path)";
  }
  if (body.disk_size_gb !== undefined && (body.disk_size_gb < 1 || body.disk_size_gb > 65536)) {
    return "disk_size_gb must be between 1 and 65536";
  }
  return null;
}

function generateXML(cfg: VMConfigBody): string {
  const devices: string[] = [];

  // Disk
  if (cfg.disk_path) {
    devices.push(
      `    <disk type='file' device='disk'>` +
      `<driver name='qemu' type='qcow2'/>` +
      `<source file='${escapeXml(cfg.disk_path)}'/>` +
      `<target dev='vda' bus='virtio'/>` +
      `</disk>`
    );
  }

  // CDROM
  if (cfg.iso_path) {
    devices.push(
      `    <disk type='file' device='cdrom'>` +
      `<driver name='qemu' type='raw'/>` +
      `<source file='${escapeXml(cfg.iso_path)}'/>` +
      `<target dev='hda' bus='sata'/>` +
      `<readonly/>` +
      `</disk>`
    );
  }

  // Network
  const bridge = cfg.network || "br0";
  devices.push(
    `    <interface type='bridge'><source bridge='${escapeXml(bridge)}'/><model type='virtio'/></interface>`
  );

  // GPU passthrough
  if (cfg.gpu_passthrough) {
    devices.push(
      `    <hostdev mode='subsystem' type='pci' managed='yes'>` +
      `<source><address domain='0x0000' bus='0x${escapeXml(cfg.gpu_passthrough)}' slot='0x00' function='0x0'/></source>` +
      `</hostdev>`
    );
  }

  // Graphics & video
  devices.push(`    <graphics type='vnc' port='-1' autoport='yes'/>`);
  devices.push(`    <video><model type='qxl'/></video>`);

  const osType = cfg.os_type || "hvm";

  return `<domain type='kvm'>
  <name>${escapeXml(cfg.name)}</name>
  <memory unit='MiB'>${cfg.memory_mb}</memory>
  <vcpu placement='static'>${cfg.vcpus}</vcpu>
  <os><type arch='x86_64' machine='pc-q35-8.1'>${escapeXml(osType)}</type><boot dev='cdrom'/><boot dev='hd'/></os>
  <features><acpi/><apic/></features>
  <cpu mode='host-passthrough'/>
  <clock offset='utc'/>
  <devices>
${devices.join("\n")}
  </devices>
</domain>`;
}

export function registerVMConfigRoutes(app: FastifyInstance, _gql: GraphQLClient): void {
  // Generate XML only
  app.post<{ Body: VMConfigBody }>("/api/vms/generate-xml", {
    preHandler: requirePermission(Resource.VMS, Action.CREATE),
    handler: async (req, reply) => {
      const body = req.body;
      const err = validateVMConfig(body);
      if (err) {
        return reply.status(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: err } });
      }

      const xml = generateXML(body);
      return reply.send({ ok: true, data: { xml } });
    },
  });

  // Define VM (generate XML + virsh define)
  app.post<{ Body: VMConfigBody; Querystring: { dry_run?: string } }>("/api/vms/define", {
    preHandler: requirePermission(Resource.VMS, Action.CREATE),
    handler: async (req, reply) => {
      const body = req.body;
      const err = validateVMConfig(body);
      if (err) {
        return reply.status(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: err } });
      }

      const xml = generateXML(body);
      const dryRun = req.query.dry_run === "true";

      if (dryRun) {
        return reply.send({
          ok: true,
          data: {
            dry_run: true,
            xml,
            disk_create: body.disk_path && body.disk_size_gb ? { path: body.disk_path, size_gb: body.disk_size_gb } : null,
          },
        });
      }

      try {
        // Create disk image if requested
        if (body.disk_path && body.disk_size_gb) {
          await execFileAsync("qemu-img", ["create", "-f", "qcow2", body.disk_path, `${body.disk_size_gb}G`], {
            timeout: 30_000,
          });
        }

        // Write XML to temp file and define
        const tmpFile = join(tmpdir(), `vm-${body.name}-${Date.now()}.xml`);
        await writeFile(tmpFile, xml, "utf-8");

        try {
          const { stdout } = await execFileAsync("virsh", ["define", tmpFile], { timeout: 15_000 });
          return reply.send({
            ok: true,
            data: { name: body.name, xml, virsh_output: stdout.trim() },
          });
        } finally {
          await unlink(tmpFile).catch(() => {});
        }
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Failed to define VM";
        return reply.status(500).send({
          ok: false,
          error: { code: "VM_DEFINE_FAILED", message },
        });
      }
    },
  });
}
