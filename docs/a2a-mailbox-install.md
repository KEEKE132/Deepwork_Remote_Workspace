# A2A 메일박스 스킬 설치 안내

이 문서는 **Deepwork Remote Workspace** 서버의 A2A 메신저를 사용하는 스킬(`a2a-mailbox`)을 설치하는 방법을 안내합니다.

## 사전 준비

이 스킬을 쓰려면 다음 **세 가지**가 필요합니다.

1. **DeepWork 데스크톱 앱** (Codex 등 MCP 클라이언트 사용 가능한 환경)
2. **MCP 토큰** — 서버 `/admin`에서 발급받은 Bearer 토큰
3. **MCP 서버 등록** — DeepWork 앱에 이 서버를 MCP로 연결

---

## 1. MCP 토큰 발급받기

관리자에게 **에이전트 라벨**(예: `seungbeom`)과 함께 토큰 발급을 요청하세요.

- 라벨은 이 스킬에서 "누구에게 보낼지" 식별하는 이름입니다. 한 번 정하면 바꾸기 어려우니 신중히 정하세요.
- 발급받은 토큰은 **비밀**입니다. 절대 공개하지 마세요.

## 2. MCP 서버 등록 (DeepWork 앱)

DeepWork 설정 → MCP 서버 → 서버 추가:

| 항목 | 값 |
|---|---|
| 이름 | `deepwork-knowledge-workspace` |
| 타입 | HTTP(S) / Streamable HTTP |
| URL | `https://deepwork-remote-workspace.deepwork-remote-workspace.workers.dev/mcp` |
| 인증 | `Authorization: Bearer <발급받은 토큰>` 헤더 |

Codex CLI를 쓴다면 설정 파일에 다음과 같이 추가합니다 (예시):

```json
{
  "mcpServers": {
    "deepwork-knowledge-workspace": {
      "type": "http",
      "url": "https://deepwork-remote-workspace.deepwork-remote-workspace.workers.dev/mcp",
      "headers": {
        "Authorization": "Bearer <발급받은 토큰>"
      }
    }
  }
}
```

연결이 성공하면 다음 도구들이 보입니다:

- `list_docs`, `read_doc`, `search_docs`, `add_doc`, `update_doc`, `delete_doc` — 지식 문서
- `list_registered_agents`, `send_agent_message`, `list_inbox`, `consume_task` — A2A 메신저
- `whoami`

## 3. 스킬 설치

### 방법 A — 저장소에서 복사 (권장)

```bash
# 이 저장소를 클론하거나 이미 있다면 pull
git clone https://github.com/KEEKE132/Deepwork_Remote_Workspace.git
# 또는
git pull

# 스킬 디렉토리를 DeepWork 사용자 스킬 폴더로 복사
# Windows:
xcopy /E /I skills\a2a-mailbox %USERPROFILE%\.deepwork\skills\a2a-mailbox
# macOS/Linux:
# cp -R skills/a2a-mailbox ~/.deepwork/skills/a2a-mailbox
```

스킬이 설치되면 DeepWork를 재시작하거나 새 대화를 열면 자동으로 로드됩니다.

### 방법 B — 내용만 복사

저장소의 [`skills/a2a-mailbox/SKILL.md`](../skills/a2a-mailbox/SKILL.md) 내용을
`~/.deepwork/skills/a2a-mailbox/SKILL.md`로 직접 저장해도 됩니다.

---

## 사용 예시

스킬 설치 후, 에이전트(DeepWork/Codex)에게 자연어로 지시하면 됩니다:

**메시지 보내기:**
> "안필온님한테 오늘 회의 준비됐다고 전해줘" → 라벨 `pilon`에게 전송

**받은 메시지 확인:**
> "메신저 확인해줘" → `list_inbox`로 수신 확인

**사서함 정리:**
> "읽은 메시지 정리해" → `consume_task`로 소비 처리

---

## 문제 해결

| 증상 | 원인/해결 |
|---|---|
| `unauthorized` (401) | 토큰이 없거나 잘못됨. 헤더에 `Authorization: Bearer <토큰>` 정확히 확인 |
| 도구가 보이지 않음 | MCP 서버를 다시 연결하거나 DeepWork 재시작 |
| 보내기가 실패 | 수신자 라벨이 `list_registered_agents`에 있는지 확인. 자기 자신에게는 보낼 수 없음 |
| `/mcp`를 브라우저로 열면 오류 | 정상. MCP는 POST + Bearer 헤더로만 동작(GET 불가) |

## 관련 문서

- [서버 설계 (DESIGN.md)](../DESIGN.md)
- [A2A 클라이언트 예제](../examples/a2a-client.mjs)