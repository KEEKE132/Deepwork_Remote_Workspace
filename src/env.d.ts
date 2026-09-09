/**
 * Cloudflare Worker 환경 타입 정의.
 * wrangler.toml의 KV 바인딩(name = "KV")과 시크릿(ADMIN_KEY)을 노출합니다.
 */
export interface Env {
  /** KV 네임스페이스: tokens/* (MCP 토큰 해시), docs/* (지식 마크다운) */
  KV: KVNamespace;
  /** /admin 페이지를 보호하는 관리자 키 (wrangler secret put ADMIN_KEY) */
  ADMIN_KEY?: string;
}