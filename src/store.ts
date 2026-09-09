import type { Env } from "./env";

/** KV 키: tokens/<sha256> -> <유저 레이블 JSON> */
const TOKEN_PREFIX = "tokens:";
/** KV 키: docs/<slug> -> <마크다운 본문> */
const DOC_PREFIX = "docs:";

/** MCP 토큰 레코드 (KV에는 토큰 자체가 아닌 해시만 저장) */
export interface TokenRecord {
  /** MCP 토큰 해시 (SHA-256 hex) — 원문은 저장하지 않음 */
  hash: string;
  /** 발급 용도/사용자 라벨 */
  label: string;
  /** ISO8601 생성 시각 */
  createdAt: string;
  /** ISO8601 만료 시각 (없으면 무기한) */
  expiresAt?: string;
  /** 마지막 사용 시각 */
  lastUsedAt?: string;
  /** 폐기(revoke) 여부 */
  revoked?: boolean;
}

export interface DocRecord {
  slug: string;
  title: string;
  content: string;
  updatedAt: string;
}

/** crypto.subtle을 이용한 SHA-256 해시 (hex) */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 랜덤 URL-safe 토큰 생성 (48바이트 → 64자) */
export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(48));
  return Array.from(bytes)
    .map((b) => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"[b % 64])
    .join("");
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** 토큰 레코드 저장 */
export async function putToken(env: Env, record: TokenRecord): Promise<void> {
  await env.KV.put(`${TOKEN_PREFIX}${record.hash}`, JSON.stringify(record));
}

/** 토큰 해시로 레코드 조회 */
export async function getTokenByHash(env: Env, hash: string): Promise<TokenRecord | null> {
  const raw = await env.KV.get(`${TOKEN_PREFIX}${hash}`);
  return raw ? (JSON.parse(raw) as TokenRecord) : null;
}

/** 만료 체크 (폐기/만료 모두) */
export function isTokenExpired(record: TokenRecord): boolean {
  if (record.revoked) return true;
  if (!record.expiresAt) return false;
  return new Date(record.expiresAt).getTime() <= Date.now();
}

/** 토큰 삭제 (해시 기준) */
export async function deleteTokenByHash(env: Env, hash: string): Promise<void> {
  await env.KV.delete(`${TOKEN_PREFIX}${hash}`);
}

/** 새 MCP 토큰 발급 (원문 토큰 + 레코드 반환) */
export async function createToken(
  env: Env,
  label: string,
  expiresInDays?: number
): Promise<{ token: string; record: TokenRecord }> {
  const token = generateToken();
  const hash = await sha256Hex(token);
  const record: TokenRecord = {
    hash,
    label,
    createdAt: nowIso(),
    expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000).toISOString() : undefined,
  };
  await putToken(env, record);
  return { token, record };
}

/** 토큰 폐기(revoke) — 해시 기준 */
export async function revokeTokenByHash(env: Env, hash: string): Promise<boolean> {
  const record = await getTokenByHash(env, hash);
  if (!record) return false;
  record.revoked = true;
  await putToken(env, record);
  return true;
}

/** 전체 토큰 목록 (해시로 저장되어 있으므로 라벨/생성일만) */
export async function listTokens(env: Env): Promise<TokenRecord[]> {
  const out: TokenRecord[] = [];
  let cursor: string | undefined;
  while (true) {
    const result = await env.KV.list({ prefix: TOKEN_PREFIX, cursor, limit: 100 });
    for (const key of result.keys) {
      const raw = await env.KV.get(key.name);
      if (raw) out.push(JSON.parse(raw) as TokenRecord);
    }
    if (result.list_complete) break;
    cursor = result.cursor;
  }
  return out.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
}

// ---- 문서 저장소 ----

export async function putDoc(env: Env, slug: string, title: string, content: string): Promise<DocRecord> {
  const record: DocRecord = {
    slug,
    title,
    content,
    updatedAt: nowIso(),
  };
  await env.KV.put(`${DOC_PREFIX}${slug}`, JSON.stringify(record));
  await env.KV.put(`${DOC_PREFIX}:list:${slug}`, slug, { metadata: { title, updatedAt: record.updatedAt } });
  return record;
}

export async function getDoc(env: Env, slug: string): Promise<DocRecord | null> {
  const raw = await env.KV.get(`${DOC_PREFIX}${slug}`);
  return raw ? (JSON.parse(raw) as DocRecord) : null;
}

export async function deleteDoc(env: Env, slug: string): Promise<void> {
  await env.KV.delete(`${DOC_PREFIX}${slug}`);
  await env.KV.delete(`${DOC_PREFIX}:list:${slug}`);
}

/** slug 목록 (타이틀 메타데이터 포함) */
export async function listDocs(env: Env): Promise<{ slug: string; title: string; updatedAt?: string }[]> {
  const out: { slug: string; title: string; updatedAt?: string }[] = [];
  let cursor: string | undefined;
  while (true) {
    const result = await env.KV.list({ prefix: `${DOC_PREFIX}:list:`, cursor, limit: 100 });
    for (const key of result.keys) {
      const slug = key.name.slice(`${DOC_PREFIX}:list:`.length);
      out.push({
        slug,
        title: (key.metadata as { title?: string } | undefined)?.title || slug,
        updatedAt: (key.metadata as { updatedAt?: string } | undefined)?.updatedAt,
      });
    }
    if (result.list_complete) break;
    cursor = result.cursor;
  }
  return out.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
}

/** slug/제목/본문에 대한 단순 텍스트 검색 (대소문자 무시) */
export async function searchDocs(env: Env, query: string): Promise<DocRecord[]> {
  const q = query.toLowerCase();
  const docs = await listDocs(env);
  const out: DocRecord[] = [];
  for (const { slug } of docs) {
    const doc = await getDoc(env, slug);
    if (!doc) continue;
    const haystack = `${doc.title}\n${doc.content}`.toLowerCase();
    if (haystack.includes(q)) out.push(doc);
  }
  return out;
}

export function normalizeSlug(input: string): string {
  const slug = input.trim().toLowerCase().replace(/[^a-z0-9가-힣_-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-|-$/g, "");
  return slug || "untitled";
}