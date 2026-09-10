---
name: a2a-mailbox
description: "A2A 메신저 사서함 확인·소비·답장 워크플로 (list_inbox → consume_task → send_agent_message)"
version: "1.0.0"
profiles: [deep-code-host]
tags: [a2a, messenger, mailbox, consume, agent-message]
---

# A2A 메일박스

에이전트 간 메신저(A2A)에서 메시지를 받고, 확인하고, 소비하고, 답장하는 워크플로를 안내합니다.

## 언제 사용하나

- 다른 에이전트가 나에게 보낸 메시지를 확인할 때
- 상대 에이전트에게 메시지를 보낼 때
- 사서함에 쌓인 메시지를 정리(소비)할 때
- 사용자가 "~~한테 전해줘/보내줘" 라고 할 때

## 핵심 도구 (MCP)

| 도구 | 역할 |
|---|---|
| `list_registered_agents` | 등록된 에이전트 목록 (누가 있는지, 라벨 확인) |
| `list_inbox` | 내 사서함의 수신 메시지 목록 (읽기 전용, 삭제 안 함) |
| `send_agent_message` | 상대에게 메시지 전송 (to = 라벨, text = 본문) |
| `consume_task` | taskId 지정으로 읽고 즉시 삭제 (소비 처리) |

## 워크플로

### 1. 수신 확인 (수시)
```
list_inbox
→ 새 메시지가 있으면 내용 파악
→ 사용자에게 요약 보고 (필요시)
```

### 2. 메시지 소비 (확인 후 반드시)
```
list_inbox에서 taskId 확보
→ consume_task { taskId }
→ 같은 taskId를 다시 list_inbox 하면 사라져야 함 (삭제 확인)
```
**원칙: 읽은 메시지는 그 자리에서 소비 처리한다.** 소비하지 않으면 사서함에 계속 쌓인다.

### 3. 답장/전송
```
상대 라벨 확인: list_registered_agents
→ send_agent_message { to, text, contextId? }
→ contextId를 유지하면 같은 대화 스레드로 이어진다
```

### 4. 라벨 인식 (사람 이름 → 라벨)
- 사용자가 "필온님한테 보내" "승범님한테 전해줘" 처럼 사람 이름/호칭으로 말하면,
  **라벨명을 그대로 쓰지 말고 문맥에 맞게 해석**해서 대응 라벨로 변환해 사용한다.
- 예: "안필온 님" → `pilon`, "박승범 님" → `seungbeom`
- 라벨이 확실하지 않으면 `list_registered_agents`로 확인 후 보낸다.
- 모르는 이름이면 사용자에게 어느 라벨인지 물어본다.

## 주의
- 자기 자신에게 보낼 수 없음 (`send_agent_message`가 거부)
- 없는 라벨로 보내면 수신자 사서함에 쌓이지 않을 수 있으니, 보내기 전 `list_registered_agents`로 존재 확인
- 사서함은 휘발성 KV — 소비하면 복구 불가