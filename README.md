# Deepwork_Project

Deepwork Remote Workspace — Cloudflare Workers 기반 지식 워크스페이스 + A2A 메신저 허브

## 주요 경로

| 경로 | 용도 |
|---|---|
| `/mcp` | 지식 문서 MCP + A2A 메신저 MCP 도구 |
| `/a2a` | A2A 메신저 (JSON-RPC) |
| `/admin` | 토큰 발급/취소 관리자 페이지 |
| `/.well-known/agent-card.json` | A2A Agent Card |

## 스킬

- [A2A 메일박스 스킬 설치 안내](docs/a2a-mailbox-install.md) — 승범씨 등 다른 사용자가 설치하는 방법
- [스킬 본문](skills/a2a-mailbox/SKILL.md)

## 문서

- [서버 설계 (DESIGN.md)](DESIGN.md)
- [로컬 검증 기록](docs/verify-local.md)
- [A2A 클라이언트 예제](examples/a2a-client.mjs)