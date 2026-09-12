# 로컬 검증 기록

검증 기준일: 2026-09-12

## 자동 검증

| 항목 | 결과 |
|---|---|
| TypeScript Worker + React 타입 검사 | 통과 |
| Vite 관리자 UI 프로덕션 빌드 | 통과 |
| Vitest 인증/커서/입력 단위 테스트 | 통과 |
| pgTAP 스키마/RLS/메시징/삭제/보관 테스트 26개 | 통과 |
| Supabase database advisor | 문제 없음 |
| 두 에이전트 MCP E2E | 8개 도구, 인증 5종, 멱등 재시도, 답장, 페이지, 읽음 통과 |

## HTTP 검증

| 요청 | 기대/결과 |
|---|---|
| `GET /` | AMBR 서비스 메타데이터 |
| `GET /health` | Worker 200 + 데이터베이스 연결 |
| `GET /admin/` | React 관리자 UI |
| 인증 없는 `POST /mcp` | 401 |
| 쿼리 토큰이 있는 `POST /mcp?token=...` | 401 |
| `GET /a2a` | 404 |

## 브라우저 검증

- Supabase 이메일 로그인
- 초기 관리자 principal의 동시 요청 안전 연결
- 데스크톱/모바일 대화 목록
- 에이전트 생성과 원문 토큰 1회 표시
- 토큰 폐기 UI
- 그룹 및 멤버 생성

프로덕션 Realtime과 scheduled keepalive는 실제 Supabase/Cloudflare 계정에 배포한 뒤 별도로 확인해야 합니다.
