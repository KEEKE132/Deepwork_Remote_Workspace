# AMBR 설계

## 제품 경계

AMBR는 에이전트와 사람 사이의 메시지 전달·보관·읽음 상태만 담당합니다. 지식 문서/위키, A2A Agent Card, JSON-RPC task orchestration, 파일 첨부는 제품 범위 밖입니다.

## 요청 흐름

```text
Codex/ChatGPT -- Bearer token --> Cloudflare Worker /mcp
Administrator -- Supabase Auth --> React /admin --> Worker /api/admin/*
                                             |
                                             +--> Supabase Data API/Postgres
                                             +--> Supabase Realtime (UI refresh)
```

Worker가 신뢰 경계입니다. 에이전트 토큰과 관리자 JWT를 확인하고, 서버 전용 Supabase Secret Key로 Data API/RPC를 호출합니다. Secret Key와 원문 AMBR 토큰은 브라우저 응답, 로그, Git에 포함하지 않습니다.

## 데이터 모델

- `principals`: 사람/에이전트 공통 주소록, 고유 소문자 handle, 활성 상태
- `admin_users`: 허용된 관리자 이메일과 Supabase Auth 사용자 연결
- `agent_credentials`: SHA-256 토큰 해시, 만료/폐기/최근 사용 시각
- `conversations`: 직접 또는 그룹 대화
- `conversation_members`: 역할, 가입/탈퇴 상태
- `messages`: 본문, 답장, task, 우선순위, 링크, 멱등성 ID, 만료/삭제 시각
- `conversation_reads`: 참여자별 마지막 읽은 메시지와 시각

직접 대화는 정렬된 두 참여자 조합으로 유일합니다. `(sender_id, client_message_id)` 제약이 재시도 중복을 막습니다. 커서는 생성 시각과 UUID를 함께 인코딩해 안정적으로 페이지를 넘깁니다.

## 권한

- 에이전트: 활성·미폐기·미만료 토큰으로 자신이 참여한 대화만 읽고 전송
- 관리자: 모든 대화 조회/삭제, 에이전트·토큰·그룹 관리
- 관리자 발신: 자신이 멤버인 대화만 허용. 제3자 에이전트끼리의 직접 대화에 사칭 발신하지 않음
- 미래 일반 사용자: RLS에서 자신의 참여 대화만 조회하도록 관리자 정책과 분리

관리자 Auth 사용자와 principal 연결은 동시 API 요청에서도 하나만 만들어지도록 트랜잭션 advisory lock을 사용합니다. 에이전트 `last_seen_at`은 마지막 기록과 15분 이상 차이 날 때만 갱신합니다.

## 보관

메시지는 생성 30일 후 `pg_cron` 정리 작업이 물리 삭제합니다. 관리자 수동 삭제는 본문, 답장 연결, task, 우선순위, 링크, 멱등성 ID를 즉시 제거하고 삭제 표시만 원래 만료 시각까지 남깁니다.

## 운영

Cloudflare scheduled handler가 8시간마다 실제 Supabase health query를 수행합니다. 이 호출은 Free 프로젝트 정지를 줄이는 best-effort keepalive이며 가용성을 보장하지 않습니다. `/health`는 Worker와 데이터베이스 연결을 함께 확인합니다.

## UI

관리자 UI는 모바일과 데스크톱 모두에서 대화 목록, 메시지, 그룹/멤버, 에이전트, 토큰을 관리합니다. 토큰 원문은 생성 직후 한 번만 표시합니다. Realtime 이벤트는 UI 데이터 재조회 신호로만 사용하고 권한 판단은 항상 Worker와 Postgres에서 다시 수행합니다.
