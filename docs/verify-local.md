# 로컬 검증 결과 (wrangler dev)

검증 일시: 2026-09-09
방식: `npx wrangler dev --port 8787` + curl (로컬 KV 사용)

## 결과 요약

| 항목 | 결과 |
|---|---|
| `npm run check` (tsc --noEmit) | ✅ 통과 (0 에러) |
| `wrangler deploy --dry-run` | ✅ 통과 (KV 바인딩 인식, 1190.64 KiB) |
| `GET /` | ✅ 200 — 헬스체크 JSON |
| `GET /admin` (키 없음) | ✅ 200 — 로그인 폼 HTML |
| `POST /admin/api/tokens` (키 없음) | ✅ 401 - Unauthorized |
| `POST /admin/api/tokens` (ADMIN_KEY) | ✅ 201 — 토큰 발급 (1회 노출) |
| `POST /mcp` (토큰 없음) | ✅ 401 + `WWW-Authenticate: Bearer` |
| `POST /mcp` (initialize, 토큰) | ✅ 200 — protocolVersion 2025-06-18, tools capability |
| `POST /mcp` (tools/list) | ✅ 7개 지식 도구 노출 (update_doc/delete_doc 포함) |
| `tools/call add_doc` | ✅ 저장 성공 (slug 자동 생성) |
| `tools/call list_docs` | ✅ 목록 조회 |
| `tools/call read_doc` | ✅ 본문 조회 |
| `tools/call search_docs` | ✅ 한글 키워드 검색 |
| `tools/call update_doc` | ✅ 기존 문서 수정 (`read_doc`으로 변경 반영 확인) |
| `tools/call update_doc` (없는 slug) | ✅ "문서를 찾을 수 없습니다" — 변경 없음 |
| `tools/call delete_doc` | ✅ 삭제 성공 |
| `tools/call whoami` | ✅ 연결 라벨(local-test) 반환 |
| 토큰 폐기 → `/mcp` 재접속 | ✅ 401 차단 |

## 문서 관리 API 검증 (추가됨)

| 항목 | 결과 |
|---|---|
| `POST /admin/api/docs` (title/content) | ✅ 201 — slug 자동 생성 |
| `GET /admin/api/docs/<slug>` | ✅ 200 — 단건 조회 |
| `PUT /admin/api/docs/<slug>` | ✅ 200 — 수정 + updatedAt 갱신 |
| `PUT` 후 목록 조회 | ✅ 목록 메타 title 반영 |
| `DELETE /admin/api/docs/<slug>` | ✅ 200 — 삭제 |
| 삭제 후 `GET /admin/api/docs/<slug>` | ✅ 404 |
| 없는 slug `PUT`/`DELETE` | ✅ 404 |
| `title` 누락 `POST` | ✅ 400 |
| 관리자 페이지 HTML | ✅ 문서 관리 폼/테이블/스크립트 포함 확인 |

## 주요 동작
- MCP 서버는 stateless Streamable HTTP (`createMcpHandler`).
- 토큰은 SHA-256 해시로만 KV에 저장 (원문 미저장).
- 폐기(revoke) 시 즉시 접근 차단.
- 지식은 KV `docs:` 접두사로 저장 (슬러그·제목·본문·수정시각).

## 참고
- 한글 출력이 일부 터미널에서 깨져 보였지만, 이는 Windows 콘솔 표시 문제이며
  실제 HTTP 응답/저장 값은 UTF-8 정상으로 확인됨.
- `.dev.vars`(로컬 전용 ADMIN_KEY)는 `.gitignore`에 추가되어 커밋되지 않음.