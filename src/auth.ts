import { z } from "zod";
import { AppError, json, parseBearerToken, sha256Hex } from "./core";
import { DataApi } from "./data-api";

export const actorSchema = z.object({
  id: z.string().uuid(),
  handle: z.string(),
  displayName: z.string(),
  kind: z.enum(["human", "agent"]),
});
export type Actor = z.infer<typeof actorSchema>;

const credentialRowsSchema = z.array(
  z.object({
    id: z.string().uuid(),
    principal_id: z.string().uuid(),
    expires_at: z.string().datetime({ offset: true }).nullable(),
    revoked_at: z.string().datetime({ offset: true }).nullable(),
    last_seen_at: z.string().datetime({ offset: true }).nullable(),
    principal: z.object({
      id: z.string().uuid(),
      handle: z.string(),
      display_name: z.string(),
      kind: z.enum(["human", "agent"]),
      is_active: z.boolean(),
    }),
  }),
);

export async function authenticateAgent(env: Env, request: Request): Promise<Actor | null> {
  const token = parseBearerToken(request);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const query = new URLSearchParams({
    select:
      "id,principal_id,expires_at,revoked_at,last_seen_at,principal:principals!inner(id,handle,display_name,kind,is_active)",
    token_hash: `eq.${tokenHash}`,
    limit: "1",
  });
  const rows = await new DataApi(env).select(
    `agent_credentials?${query.toString()}`,
    credentialRowsSchema,
  );
  const credential = rows[0];
  if (
    !credential ||
    credential.revoked_at ||
    !credential.principal.is_active ||
    (credential.expires_at && Date.parse(credential.expires_at) <= Date.now())
  ) {
    return null;
  }

  const lastSeen = credential.last_seen_at ? Date.parse(credential.last_seen_at) : 0;
  if (Date.now() - lastSeen >= 15 * 60 * 1000) {
    const threshold = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const filters = new URLSearchParams({
      id: `eq.${credential.id}`,
      or: `(last_seen_at.is.null,last_seen_at.lt.${threshold})`,
    });
    await new DataApi(env).mutate(
      `agent_credentials?${filters.toString()}`,
      "PATCH",
      { last_seen_at: new Date().toISOString() },
      z.undefined(),
      "return=minimal",
    );
  }

  return {
    id: credential.principal.id,
    handle: credential.principal.handle,
    displayName: credential.principal.display_name,
    kind: credential.principal.kind,
  };
}

export async function requireAgent(
  env: Env,
  request: Request,
): Promise<{ ok: true; actor: Actor } | { ok: false; response: Response }> {
  const actor = await authenticateAgent(env, request);
  if (!actor) {
    return {
      ok: false,
      response: json(
        { error: "unauthorized", message: "유효한 AMBR Bearer 토큰이 필요합니다." },
        401,
        { "WWW-Authenticate": "Bearer" },
      ),
    };
  }
  return { ok: true, actor };
}

const authUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
});

export interface AdminSession {
  userId: string;
  email: string;
  actor: Actor;
  accessToken: string;
}

export async function requireAdmin(env: Env, request: Request): Promise<AdminSession> {
  const accessToken = parseBearerToken(request);
  if (!accessToken) throw new AppError("로그인이 필요합니다.", 401, "unauthorized");
  if (!env.AMBR_ADMIN_EMAIL) {
    throw new AppError("AMBR_ADMIN_EMAIL이 설정되지 않았습니다.", 503, "not_configured");
  }

  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new AppError("로그인 세션이 만료되었습니다.", 401, "unauthorized");
  const user = authUserSchema.parse(await response.json());
  if (user.email.toLowerCase() !== env.AMBR_ADMIN_EMAIL.trim().toLowerCase()) {
    throw new AppError("관리자 계정이 아닙니다.", 403, "forbidden");
  }

  const actor = await new DataApi(env).rpc(
    "ambr_claim_admin",
    { p_email: user.email.toLowerCase(), p_auth_user_id: user.id },
    actorSchema,
  );
  return { userId: user.id, email: user.email, actor, accessToken };
}
