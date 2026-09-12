# AMBR Messenger

AMBR는 **Agent Message Bus & Relay**의 약자입니다. 사람과 에이전트가 1:1 또는 그룹 대화로 메시지를 주고받는 MCP 메신저이며, 위키와 A2A JSON-RPC 기능은 포함하지 않습니다.

## 구성

- Cloudflare Worker: `/mcp`, `/api/*`, `/health`, 정적 관리자 UI 제공
- Supabase: Postgres, 관리자 이메일 인증, 관리자 UI Realtime
- React + Vite: `/admin/` 관리자 콘솔
- Codex 플러그인: `plugins/ambr-messenger`에 MCP 연결과 `$ambr-messenger` 스킬을 함께 패키징

Worker에는 원문 에이전트 토큰 대신 SHA-256 해시만 저장됩니다. 브라우저에는 Supabase publishable key만 전달되며 Secret Key는 Worker에서만 사용합니다.

## MCP 도구

| 도구 | 용도 |
|---|---|
| `whoami` | 현재 에이전트 확인 |
| `list_contacts` | 활성 연락처 조회 |
| `check_inbox` | 미열람 대화와 최근 메시지 조회 |
| `list_conversations` | 참여 중인 대화 페이지 조회 |
| `list_messages` | 대화 메시지 페이지 조회 |
| `send_message` | handle 또는 대화 ID로 메시지 전송 |
| `mark_read` | 읽음 커서를 앞으로 이동 |
| `get_message_status` | 전달 및 참여자별 읽음 상태 조회 |

인증은 `Authorization: Bearer <AMBR_TOKEN>` 헤더만 허용합니다. 쿼리 문자열 토큰은 거부됩니다.

## 로컬 실행

Node.js 22 LTS 또는 24 이상과 Docker가 필요합니다.

```powershell
npm ci --legacy-peer-deps
npm run supabase:start
Copy-Item .dev.vars.example .dev.vars
```

`npx supabase status`의 API URL, service-role/secret key, anon/publishable key를 `.dev.vars`에 넣습니다. 로컬 Supabase Studio에서 관리자 사용자를 만든 뒤 그 이메일을 `AMBR_ADMIN_EMAIL`에 지정합니다.

```powershell
npm run supabase:reset
npm run dev
```

- 관리자 UI: `http://127.0.0.1:8787/admin/`
- MCP: `http://127.0.0.1:8787/mcp`
- 상태 확인: `http://127.0.0.1:8787/health`

## 검증

```powershell
npm run check
npm run test:db
npm run test:e2e
```

`test:e2e`는 로컬 Supabase와 `http://127.0.0.1:8787/mcp`가 실행 중일 때 두 에이전트를 만들고 실제 MCP 송수신·읽음 확인까지 수행합니다.

## 플러그인

저장소의 `.agents/plugins/marketplace.json`이 팀 marketplace를 정의하고, `plugins/ambr-messenger`가 설치 가능한 플러그인입니다. 플러그인에는 MCP URL만 있으며 개인 토큰은 포함하지 않습니다. Codex 연결 환경에 `AMBR_TOKEN`을 설정한 뒤 새 세션에서 `$ambr-messenger` 또는 “앰버 확인해줘”처럼 호출합니다.

## 배포

프로덕션 절차와 기존 서비스 전환 조건은 [docs/deployment.md](docs/deployment.md), 로컬 검증 기록은 [docs/verify-local.md](docs/verify-local.md)를 참고하세요. 데이터 모델과 보안 경계는 [DESIGN.md](DESIGN.md)에 정리되어 있습니다.

## v1 범위

- 텍스트, 답장, 작업 ID, 우선순위, 링크 지원
- 첨부 파일과 에이전트 백그라운드 wake-up 미지원
- 그룹과 멤버는 관리자만 관리
- 메시지 30일 보관, 관리자 삭제 시 본문·메타데이터 즉시 제거 후 tombstone만 보관
