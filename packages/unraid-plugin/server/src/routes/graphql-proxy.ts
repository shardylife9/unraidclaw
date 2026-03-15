import type { FastifyInstance } from "fastify";
import { Resource, Action } from "@unraidclaw/shared";
import type { GraphQLClient } from "../graphql-client.js";
import { requirePermission } from "../permissions.js";

interface GraphQLBody {
  query: string;
  variables?: Record<string, unknown>;
}

function isMutation(query: string): boolean {
  return /^\s*mutation\b/i.test(query);
}

export function registerGraphQLProxyRoutes(app: FastifyInstance, gql: GraphQLClient): void {
  app.post<{ Body: GraphQLBody; Querystring: { dry_run?: string } }>("/api/graphql", {
    preHandler: async (req, reply) => {
      const body = req.body;
      if (!body || typeof body.query !== "string" || !body.query.trim()) {
        return reply.status(400).send({
          ok: false,
          error: { code: "VALIDATION_ERROR", message: "Request body must include a non-empty 'query' string" },
        });
      }

      const mutation = isMutation(body.query);
      const permission = mutation
        ? requirePermission(Resource.GRAPHQL, Action.UPDATE)
        : requirePermission(Resource.GRAPHQL, Action.READ);
      return permission(req, reply);
    },
    handler: async (req, reply) => {
      const { query, variables } = req.body;
      const dryRun = req.query.dry_run === "true";

      if (dryRun) {
        return reply.send({
          ok: true,
          data: {
            dry_run: true,
            operation: isMutation(query) ? "mutation" : "query",
            query,
            variables: variables ?? null,
          },
        });
      }

      try {
        const data = await gql.query(query, variables);
        return reply.send({ ok: true, data });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "GraphQL request failed";
        return reply.status(502).send({
          ok: false,
          error: { code: "GRAPHQL_PROXY_ERROR", message },
        });
      }
    },
  });
}
