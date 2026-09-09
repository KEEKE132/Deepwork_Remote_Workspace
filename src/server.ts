import { createMcpHandler } from "agents/mcp/server";
import type { Env } from "./env";
import { createKnowledgeMcpServer, requireAuth } from "./mcp";
import { handleWeb } from "./web";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 상태 확인
    if (request.method === "GET" && url.pathname === "/") {
      return new Response(
        JSON.stringify({
          name: "deepwork-knowledge-workspace",
          mcp: url.origin + "/mcp",
          admin: url.origin + "/admin",
          health: "ok",
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // MCP 원격 엔드포인트 (Streamable HTTP, stateless)
    if (url.pathname === "/mcp") {
      const auth = await requireAuth(env, request);
      if (!auth.ok) return auth.response;

      const handler = createMcpHandler(() => createKnowledgeMcpServer(env, { label: auth.label }), {
        route: "/mcp",
      });
      return handler(request, env, ctx);
    }

    // 관리자 페이지 및 API (토큰 발급/취소, 문서 확인)
    if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
      return handleWeb(request, env);
    }

    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;