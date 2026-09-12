import { z } from "zod";
import { requireAdmin } from "./auth";
import {
  AppError,
  errorResponse,
  generateToken,
  handleSchema,
  idSchema,
  json,
  sendMessageSchema,
  sha256Hex,
} from "./core";
import { DataApi } from "./data-api";
import { Messenger } from "./messenger";

const createAgentSchema = z.object({
  handle: handleSchema,
  displayName: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).default(""),
  expiresInDays: z.number().int().min(1).max(3650).nullable().default(90),
});

const issueTokenSchema = z.object({
  expiresInDays: z.number().int().min(1).max(3650).nullable().default(90),
});

const saveGroupSchema = z.object({
  id: idSchema.optional(),
  name: z.string().trim().min(1).max(100),
  memberIds: z.array(idSchema).max(100).transform((ids) => [...new Set(ids)]),
});

const updateAgentSchema = z.object({
  displayName: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(500).optional(),
  isActive: z.boolean().optional(),
});

const agentResultSchema = z.object({
  id: z.string().uuid(),
  handle: z.string(),
  displayName: z.string(),
  description: z.string(),
  credentialId: z.string().uuid(),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }),
});

const tokenResultSchema = z.object({
  credentialId: z.string().uuid(),
  principalId: z.string().uuid(),
  handle: z.string(),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }),
});

const groupResultSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  kind: z.literal("group"),
});

const deletedMessageSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  deletedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
});

function expiryFromDays(days: number | null): string | null {
  return days === null ? null : new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

async function readJson(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("Content-Length") ?? 0);
  if (length > 64 * 1024) throw new AppError("요청 본문이 너무 큽니다.", 413, "payload_too_large");
  try {
    return await request.json();
  } catch {
    throw new AppError("올바른 JSON 본문이 필요합니다.", 400, "invalid_json");
  }
}

function readLimit(url: URL, fallback: number): number {
  return z.coerce.number().int().min(1).max(100).parse(url.searchParams.get("limit") ?? fallback);
}

async function createAgent(data: DataApi, request: Request) {
  const input = createAgentSchema.parse(await readJson(request));
  const token = generateToken();
  const result = await data.rpc(
    "ambr_admin_create_agent_with_description",
    {
      p_handle: input.handle,
      p_display_name: input.displayName,
      p_description: input.description,
      p_token_hash: await sha256Hex(token),
      p_expires_at: expiryFromDays(input.expiresInDays),
    },
    agentResultSchema,
  );
  return json({ agent: result, token }, 201);
}

async function issueToken(data: DataApi, principalId: string, request: Request) {
  const input = issueTokenSchema.parse(await readJson(request));
  const token = generateToken();
  const result = await data.rpc(
    "ambr_admin_issue_token",
    {
      p_principal_id: idSchema.parse(principalId),
      p_token_hash: await sha256Hex(token),
      p_expires_at: expiryFromDays(input.expiresInDays),
    },
    tokenResultSchema,
  );
  return json({ credential: result, token }, 201);
}

export async function handleAdminApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/api/config" && request.method === "GET") {
    return json({
      product: "AMBR",
      supabaseUrl: env.SUPABASE_URL,
      supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY,
    });
  }

  try {
    const admin = await requireAdmin(env, request);
    const data = new DataApi(env);
    const messenger = new Messenger(env, admin.actor, true);

    if (url.pathname === "/api/admin/session" && request.method === "GET") {
      return json({ email: admin.email, principal: admin.actor });
    }
    if (url.pathname === "/api/admin/contacts" && request.method === "GET") {
      return json({ contacts: await messenger.listContacts() });
    }
    if (url.pathname === "/api/admin/conversations" && request.method === "GET") {
      const limit = readLimit(url, 50);
      return json(await messenger.listConversations(url.searchParams.get("cursor") ?? undefined, limit));
    }
    if (url.pathname === "/api/admin/messages" && request.method === "GET") {
      const conversationId = url.searchParams.get("conversationId");
      if (!conversationId) throw new AppError("conversationId가 필요합니다.");
      const limit = readLimit(url, 100);
      return json(
        await messenger.listMessages(
          conversationId,
          url.searchParams.get("cursor") ?? undefined,
          limit,
        ),
      );
    }
    if (url.pathname === "/api/admin/messages" && request.method === "POST") {
      const input = sendMessageSchema.parse(await readJson(request));
      return json({ message: await messenger.sendMessage(input) }, 201);
    }
    if (url.pathname === "/api/admin/read" && request.method === "POST") {
      const input = z
        .object({ conversationId: idSchema, messageId: idSchema })
        .parse(await readJson(request));
      return json({ read: await messenger.markRead(input.conversationId, input.messageId) });
    }

    const deleteMessageMatch = /^\/api\/admin\/messages\/([0-9a-f-]+)$/u.exec(url.pathname);
    if (deleteMessageMatch && request.method === "DELETE") {
      return json({
        message: await data.rpc(
          "ambr_admin_delete_message",
          { p_actor_id: admin.actor.id, p_message_id: idSchema.parse(deleteMessageMatch[1]) },
          deletedMessageSchema,
        ),
      });
    }

    if (url.pathname === "/api/admin/groups" && request.method === "POST") {
      const input = saveGroupSchema.parse(await readJson(request));
      const group = await data.rpc(
        "ambr_admin_save_group",
        {
          p_actor_id: admin.actor.id,
          p_name: input.name,
          p_member_ids: input.memberIds,
          p_group_id: input.id ?? null,
        },
        groupResultSchema,
      );
      return json({ group }, input.id ? 200 : 201);
    }

    if (url.pathname === "/api/admin/agents" && request.method === "GET") {
      const query = new URLSearchParams({
        select:
          "id,handle,display_name,description,is_active,created_at,agent_credentials(id,expires_at,revoked_at,last_seen_at,created_at)",
        kind: "eq.agent",
        order: "handle.asc",
      });
      const agents = await data.select(
        `principals?${query.toString()}`,
        z.array(
          z.object({
            id: z.string().uuid(),
            handle: z.string(),
            display_name: z.string(),
            description: z.string(),
            is_active: z.boolean(),
            created_at: z.string().datetime({ offset: true }),
            agent_credentials: z.array(
              z.object({
                id: z.string().uuid(),
                expires_at: z.string().datetime({ offset: true }).nullable(),
                revoked_at: z.string().datetime({ offset: true }).nullable(),
                last_seen_at: z.string().datetime({ offset: true }).nullable(),
                created_at: z.string().datetime({ offset: true }),
              }),
            ),
          }),
        ),
      );
      return json({
        agents: agents.map((agent) => ({
          id: agent.id,
          handle: agent.handle,
          displayName: agent.display_name,
          description: agent.description,
          isActive: agent.is_active,
          createdAt: agent.created_at,
          credentials: agent.agent_credentials.map((credential) => ({
            id: credential.id,
            expiresAt: credential.expires_at,
            revokedAt: credential.revoked_at,
            lastSeenAt: credential.last_seen_at,
            createdAt: credential.created_at,
          })),
        })),
      });
    }
    if (url.pathname === "/api/admin/agents" && request.method === "POST") {
      return createAgent(data, request);
    }

    const agentMatch = /^\/api\/admin\/agents\/([0-9a-f-]+)$/u.exec(url.pathname);
    if (agentMatch && request.method === "PATCH") {
      const principalId = idSchema.parse(agentMatch[1]);
      const input = updateAgentSchema.parse(await readJson(request));
      if (Object.keys(input).length === 0) throw new AppError("변경할 값이 없습니다.");
      const query = new URLSearchParams({ id: `eq.${principalId}`, kind: "eq.agent" });
      const rows = await data.mutate(
        `principals?${query.toString()}`,
        "PATCH",
        {
          ...(input.displayName === undefined ? {} : { display_name: input.displayName }),
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.isActive === undefined ? {} : { is_active: input.isActive }),
          updated_at: new Date().toISOString(),
        },
        z.array(z.object({ id: z.string().uuid() })),
      );
      if (rows.length === 0) throw new AppError("에이전트를 찾을 수 없습니다.", 404, "not_found");
      return json({ updated: true });
    }

    const issueMatch = /^\/api\/admin\/agents\/([0-9a-f-]+)\/tokens$/u.exec(url.pathname);
    if (issueMatch && request.method === "POST") {
      return issueToken(data, issueMatch[1] ?? "", request);
    }

    const revokeMatch = /^\/api\/admin\/credentials\/([0-9a-f-]+)\/revoke$/u.exec(url.pathname);
    if (revokeMatch && request.method === "POST") {
      const query = new URLSearchParams({ id: `eq.${idSchema.parse(revokeMatch[1])}` });
      const rows = await data.mutate(
        `agent_credentials?${query.toString()}`,
        "PATCH",
        { revoked_at: new Date().toISOString() },
        z.array(z.object({ id: z.string().uuid(), revoked_at: z.string() })),
      );
      if (rows.length === 0) throw new AppError("토큰을 찾을 수 없습니다.", 404, "not_found");
      return json({ revoked: true });
    }

    return json({ error: "not_found", message: "API 경로를 찾을 수 없습니다." }, 404);
  } catch (error) {
    return errorResponse(error);
  }
}
