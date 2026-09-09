import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Env } from "./env";
import { sendAgentMessage, listMailbox, consumeMailboxTask } from "./a2a-server";
import {
  deleteDoc,
  getDoc,
  getTokenByHash,
  isTokenExpired,
  listDocs,
  listTokens,
  normalizeSlug,
  putDoc,
  putLastUsedAt,
  searchDocs,
  sha256Hex,
  updateDoc,
} from "./store";

/** Bearer 토큰에서 인증된 사용자 라벨을 반환 (실패 시 null) */
export async function authenticate(env: Env, request: Request): Promise<string | null> {
  const auth = request.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) return null;
  const token = auth.slice("Bearer ".length).trim();
  if (!token) return null;
  const hash = await sha256Hex(token);
  const record = await getTokenByHash(env, hash);
  if (!record || isTokenExpired(record)) return null;
  // 접속 성공 시각은 별도 KV 키에만 기록 (레코드 본체를 다시 쓰면 revoke 플래그가
  // stale 스냅샷으로 덮어써질 수 있음 — 본체는 절대 재기록하지 않는다)
  await putLastUsedAt(env, hash, new Date().toISOString());
  return record.label;
}

/** 토큰을 검증하고 실패 시 JSON 오류 Response를 돌려주는 진입점 헬퍼 */
export async function requireAuth(env: Env, request: Request): Promise<{ ok: true; label: string } | { ok: false; response: Response }> {
  const label = await authenticate(env, request);
  if (label === null) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "unauthorized", message: "유효한 MCP 토큰이 필요합니다. /admin 에서 발급받으세요." }), {
        status: 401,
        headers: { "Content-Type": "application/json", "WWW-Authenticate": "Bearer" },
      }),
    };
  }
  return { ok: true, label };
}

/**
 * 지식 공유 MCP 서버 팩토리.
 * stateless 핸들러가 요청마다 이 팩토리를 호출하므로,
 * 요청 스코프 인증 결과(actor)를 closure로 주입한다.
 */
export function createKnowledgeMcpServer(env: Env, actor: { label: string }) {
  const server = new McpServer({
    name: "deepwork-knowledge-workspace",
    version: "0.1.0",
  });

  server.registerTool(
    "list_docs",
    {
      title: "지식 문서 목록",
      description: "공유 워크스페이스의 마크다운 지식 문서 목록(슬러그/제목)을 반환합니다.",
      inputSchema: z.object({}),
    },
    async () => {
      const docs = await listDocs(env);
      return {
        content: [{ type: "text", text: JSON.stringify(docs, null, 2) }],
      };
    }
  );

  server.registerTool(
    "read_doc",
    {
      title: "지식 문서 읽기",
      description: "slug로 마크다운 지식 문서 본문을 읽습니다.",
      inputSchema: z.object({
        slug: z.string().describe("문서 슬러그 (list_docs로 확인)"),
      }),
    },
    async ({ slug }) => {
      const doc = await getDoc(env, normalizeSlug(slug));
      if (!doc) {
        return { content: [{ type: "text", text: `문서를 찾을 수 없습니다: ${slug}` }] };
      }
      return { content: [{ type: "text", text: `# ${doc.title}\n\n${doc.content}` }] };
    }
  );

  server.registerTool(
    "search_docs",
    {
      title: "지식 문서 검색",
      description: "전체 문서에서 키워드를 검색해 제목/본문을 반환합니다.",
      inputSchema: z.object({
        query: z.string().describe("검색할 키워드"),
      }),
    },
    async ({ query }) => {
      const results = await searchDocs(env, query);
      const text = results.length === 0
        ? "검색 결과가 없습니다."
        : results.map((d) => `## ${d.title} (${d.slug})\n\n${d.content}`).join("\n\n---\n\n");
      return { content: [{ type: "text", text }] };
    }
  );

  server.registerTool(
    "add_doc",
    {
      title: "지식 문서 추가",
      description: "새 마크다운 지식 문서를 워크스페이스에 추가합니다.",
      inputSchema: z.object({
        title: z.string().describe("문서 제목"),
        content: z.string().describe("마크다운 본문"),
        slug: z.string().optional().describe("슬러그 (생략 시 제목에서 자동 생성)"),
      }),
    },
    async ({ title, content, slug }) => {
      const finalSlug = slug ? normalizeSlug(slug) : normalizeSlug(title);
      await putDoc(env, finalSlug, title, content);
      return {
        content: [{ type: "text", text: `저장되었습니다: ${finalSlug}` }],
      };
    }
  );

  server.registerTool(
    "update_doc",
    {
      title: "지식 문서 수정",
      description: "기존 마크다운 문서의 제목/본문을 수정합니다. 없는 slug면 아무것도 변경하지 않습니다.",
      inputSchema: z.object({
        slug: z.string().describe("수정할 문서 슬러그 (list_docs로 확인)"),
        title: z.string().describe("새 문서 제목"),
        content: z.string().describe("새 마크다운 본문"),
      }),
    },
    async ({ slug, title, content }) => {
      const finalSlug = normalizeSlug(slug);
      const updated = await updateDoc(env, finalSlug, title, content);
      if (!updated) {
        return { content: [{ type: "text", text: `문서를 찾을 수 없습니다: ${finalSlug}` }] };
      }
      return {
        content: [{ type: "text", text: `수정되었습니다: ${finalSlug}` }],
      };
    }
  );

  server.registerTool(
    "delete_doc",
    {
      title: "지식 문서 삭제",
      description: "slug로 지식 문서를 삭제합니다. 없는 slug면 아무것도 삭제하지 않습니다.",
      inputSchema: z.object({
        slug: z.string().describe("삭제할 문서 슬러그 (list_docs로 확인)"),
      }),
    },
    async ({ slug }) => {
      const finalSlug = normalizeSlug(slug);
      const deleted = await deleteDoc(env, finalSlug);
      return {
        content: [{ type: "text", text: deleted ? `삭제되었습니다: ${finalSlug}` : `문서를 찾을 수 없습니다: ${finalSlug}` }],
      };
    }
  );

  server.registerTool(
    "list_registered_agents",
    {
      title: "등록된 에이전트 명단",
      description: "이 A2A 메신저 허브에 등록된(토큰 발급된) 에이전트 라벨 목록을 반환합니다. 메시지를 받을 수 있는 상대를 확인할 때 사용합니다.",
      inputSchema: z.object({}),
    },
    async () => {
      const records = (await listTokens(env)).filter((r) => !r.revoked && !isTokenExpired(r));
      if (records.length === 0) {
        return { content: [{ type: "text", text: "등록된 에이전트가 없습니다." }] };
      }
      const lines = records.map((r) => {
        const exp = r.expiresAt ? new Date(r.expiresAt).toISOString() : "무기한";
        const last = r.lastUsedAt ? new Date(r.lastUsedAt).toISOString() : "사용 기록 없음";
        return `- ${r.label} (발급: ${new Date(r.createdAt).toISOString()}, 만료: ${exp}, 마지막 사용: ${last})`;
      });
      return { content: [{ type: "text", text: `등록된 에이전트 ${records.length}명:\n` + lines.join("\n") }] };
    }
  );

  server.registerTool(
    "send_agent_message",
    {
      title: "에이전트에게 메시지 전송",
      description: "A2A 메신저 허브를 통해 다른 등록된 에이전트에게 텍스트 메시지를 보냅니다. 해 받는 쪽 사서함에 Task로 전달되며, 수신자가 ListTasks/consumeTask로 확인합니다. 상대 라벨은 list_registered_agents로 확인하세요.",
      inputSchema: z.object({
        to: z.string().describe("수신 에이전트 라벨 (list_registered_agents로 확인)"),
        text: z.string().describe("보낼 메시지 본문"),
        contextId: z.string().optional().describe("같은 대화 스레드에 이어 보내려면 이전에 받은 contextId를 지정"),
      }),
    },
    async ({ to, text, contextId }) => {
      if (!to || !text) {
        return { content: [{ type: "text", text: "to와 text는 필수입니다." }] };
      }
      if (to === actor.label) {
        return { content: [{ type: "text", text: "자기 자신에게는 보낼 수 없습니다." }] };
      }
      const result = await sendAgentMessage(env, actor.label, to, text, contextId);
      return {
        content: [
          {
            type: "text",
            text: `✅ ${to} 에게 전송되었습니다.\n- taskId: ${result.taskId}\n- contextId: ${result.contextId}\n- 수신자 사서함: ${result.deliveredTo}`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "list_inbox",
    {
      title: "내 사서함 조회",
      description: "현재 연결된 에이전트의 A2A 사서함에 도착한 수신 메시지(Task) 목록을 반환합니다. 메시지 확인 후 consume_task로 읽고 삭제할 수 있습니다.",
      inputSchema: z.object({}),
    },
    async () => {
      const tasks = await listMailbox(env, actor.label);
      if (tasks.length === 0) {
        return { content: [{ type: "text", text: "사서함이 비어 있습니다." }] };
      }
      const lines = tasks.map((t) => {
        const from = t.metadata?.sender ?? "?";
        const text = t.status?.message?.parts
          ?.find((p) => p.content?.$case === "text")
          ?.content?.value ?? "";
        return `- [${t.id}] ${from}: ${text} (contextId: ${t.contextId}, 상태: ${t.status?.state})`;
      });
      return { content: [{ type: "text", text: `사서함 ${tasks.length}건:\n` + lines.join("\n") }] };
    }
  );

  server.registerTool(
    "consume_task",
    {
      title: "메시지 소비(읽고 삭제)",
      description: "내 A2A 사서함에서 taskId로 메시지를 읽고 즉시 삭제합니다. 처리 완료된 메시지는 사서함을 비우기 위해 이 도구로 소비하세요.",
      inputSchema: z.object({
        taskId: z.string().describe("소비할 Task ID (list_inbox로 확인)"),
      }),
    },
    async ({ taskId }) => {
      const task = await consumeMailboxTask(env, actor.label, taskId);
      if (!task) {
        return { content: [{ type: "text", text: `Task를 찾을 수 없습니다 (이미 소비되었거나 소유자가 아닙니다): ${taskId}` }] };
      }
      const from = task.metadata?.sender ?? "?";
      const text = task.status?.message?.parts
        ?.find((p) => p.content?.$case === "text")
        ?.content?.value ?? "";
      return {
        content: [
          {
            type: "text",
            text: `✅ 소비되었습니다.\n- taskId: ${task.id}\n- 보낸이: ${from}\n- 내용: ${text}`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "whoami",
    {
      title: "현재 인증 정보",
      description: "이 연결에 사용된 MCP 토큰의 라벨을 반환합니다.",
      inputSchema: z.object({}),
    },
    async () => {
      return {
        content: [{ type: "text", text: `연결 사용자(라벨): ${actor.label}` }],
      };
    }
  );

  return server;
}