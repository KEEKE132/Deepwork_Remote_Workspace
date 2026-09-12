import { createMcpHandler } from "agents/mcp/server";
import { handleAdminApi } from "./admin-api";
import { requireAgent } from "./auth";
import { errorResponse, json } from "./core";
import { DataApi } from "./data-api";
import { createAmbrMcpServer } from "./mcp";
import { z } from "zod";

async function health(env: Env): Promise<Response> {
  const startedAt = Date.now();
  try {
    await new DataApi(env).select(
      "principals?select=id&limit=1",
      z.array(z.object({ id: z.string().uuid() })),
    );
    return json({
      status: "ok",
      service: "ambr-messenger",
      database: "connected",
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown database error";
    console.error(JSON.stringify({ event: "health_failed", message }));
    return json(
      {
        status: "degraded",
        service: "ambr-messenger",
        database: "unavailable",
        checkedAt: new Date().toISOString(),
      },
      503,
    );
  }
}

async function fetchHandler(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/") {
    return json({
      name: "AMBR",
      expansion: "Agent Message Bus & Relay",
      mcp: `${url.origin}/mcp`,
      admin: `${url.origin}/admin`,
      health: `${url.origin}/health`,
      status: "ok",
    });
  }
  if (request.method === "GET" && url.pathname === "/health") return health(env);

  if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
    const auth = await requireAgent(env, request);
    if (!auth.ok) return auth.response;
    return createMcpHandler(() => createAmbrMcpServer(env, auth.actor), { route: "/mcp" })(
      request,
      env,
      ctx,
    );
  }

  if (url.pathname.startsWith("/api/")) return handleAdminApi(request, env);

  return new Response("Not Found", { status: 404 });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await fetchHandler(request, env, ctx);
    } catch (error) {
      return errorResponse(error);
    }
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const response = await health(env);
    if (!response.ok) throw new Error("AMBR Supabase keepalive failed");
    console.log(JSON.stringify({ event: "supabase_keepalive", status: "ok" }));
  },
} satisfies ExportedHandler<Env>;
