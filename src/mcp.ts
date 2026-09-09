import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Env } from "./env";
import {
  deleteDoc,
  getDoc,
  getTokenByHash,
  isTokenExpired,
  listDocs,
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