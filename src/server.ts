import { createMcpHandler } from "agents/mcp/server";
import { JsonRpcTransportHandler, ServerCallContext } from "@a2a-js/sdk/server";
import type { Env } from "./env";
import { createKnowledgeMcpServer, requireAuth, authenticate } from "./mcp";
import { createMessengerHandler, buildAgentCard } from "./a2a-server";
import { ownerOf } from "./a2a-store";
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
          a2a: url.origin + "/a2a",
          agentCard: url.origin + "/.well-known/agent-card.json",
          admin: url.origin + "/admin",
          health: "ok",
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // A2A Agent Card — 다른 에이전트가 이 허브를 발견하는 진입점 (공개)
    if (request.method === "GET" && url.pathname === "/.well-known/agent-card.json") {
      return new Response(JSON.stringify(buildAgentCard(url.origin)), {
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    // A2A 메신저 엔드포인트 (JSON-RPC, Bearer 인증)
    if (url.pathname === "/a2a" && request.method === "POST") {
      const label = await authenticate(env, request);
      if (label === null) {
        return new Response(
          JSON.stringify({ error: "unauthorized", message: "유효한 A2A/MCP 토큰이 필요합니다. /admin 에서 발급받으세요." }),
          { status: 401, headers: { "Content-Type": "application/json", "WWW-Authenticate": "Bearer" } }
        );
      }

      const { handler, store } = createMessengerHandler(env, label, url.origin);
      const transport = new JsonRpcTransportHandler(handler);

      const body = await request.text();
      const context = new ServerCallContext({
        user: { isAuthenticated: true, userName: label },
        requestedVersion: "1.0",
      });

      // A2A 확장: consumeTask — 소유자 사서함에서 Task를 읽고 즉시 삭제(소비, 휘발)
      let rpcRequest: { method?: unknown; params?: unknown; id?: unknown };
      try {
        rpcRequest = JSON.parse(body) as typeof rpcRequest;
      } catch {
        rpcRequest = {};
      }
      if (rpcRequest.method === "consumeTask") {
        const params = (rpcRequest.params && typeof rpcRequest.params === "object" ? rpcRequest.params : {}) as { taskId?: unknown };
        if (typeof params.taskId !== "string" || !params.taskId) {
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: rpcRequest.id ?? null, error: { code: -32602, message: "taskId가 필요합니다." } }),
            { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
          );
        }
        const task = await store.load(params.taskId, context);
        const deleted = task ? await store.consume(params.taskId, ownerOf(context)) : false;
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: rpcRequest.id ?? null,
            result: { consumed: deleted, task },
          }),
          { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
        );
      }

      const result = await transport.handle(body, context);

      // 스트리밍 응답(비지원이지만 안전 처리) — 이 허브는 streaming=false 이므로 단일 응답
      if (result && typeof result === "object" && Symbol.asyncIterator in result) {
        const chunks: string[] = [];
        for await (const r of result as AsyncIterable<unknown>) {
          chunks.push(JSON.stringify(r));
        }
        return new Response(chunks.join("\n"), {
          headers: { "Content-Type": "application/jsonl; charset=utf-8", "Cache-Control": "no-store" },
        });
      }

      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      });
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