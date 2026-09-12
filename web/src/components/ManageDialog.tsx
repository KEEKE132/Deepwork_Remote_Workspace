import { useEffect, useState } from "react";
import type { Agent, Conversation, Principal } from "../types";

interface ManageDialogProps {
  open: boolean;
  agents: Agent[];
  contacts: Principal[];
  editingGroup: Conversation | null;
  onClose: () => void;
  onRefreshAgents: () => Promise<void>;
  onCreateAgent: (input: { handle: string; displayName: string; description: string; expiresInDays: number | null }) => Promise<string>;
  onUpdateAgent: (agentId: string, input: { displayName?: string; description?: string }) => Promise<void>;
  onIssueToken: (agentId: string, expiresInDays: number | null) => Promise<string>;
  onRevoke: (credentialId: string) => Promise<void>;
  onToggleAgent: (agent: Agent) => Promise<void>;
  onSaveGroup: (input: { id?: string; name: string; memberIds: string[] }) => Promise<void>;
}

function TokenReveal({ token, onClose }: { token: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(token);
    setCopied(true);
  }
  return (
    <div className="token-reveal" role="alertdialog" aria-modal="true" aria-labelledby="token-title">
      <div className="token-card">
        <p className="eyebrow">한 번만 표시됩니다</p>
        <h3 id="token-title">새 AMBR 토큰</h3>
        <p>지금 안전한 비밀 저장소에 복사하세요. 원문 토큰은 서버에 저장되지 않습니다.</p>
        <code>{token}</code>
        <div className="dialog-actions">
          <button className="quiet-button" onClick={() => void copy()}>{copied ? "복사됨" : "복사"}</button>
          <button className="primary-button" onClick={onClose}>확인</button>
        </div>
      </div>
    </div>
  );
}

function AgentEditor({
  agent,
  disabled,
  onSave,
}: {
  agent: Agent;
  disabled: boolean;
  onSave: (input: { displayName: string; description: string }) => Promise<void>;
}) {
  const [name, setName] = useState(agent.displayName);
  const [description, setDescription] = useState(agent.description);

  useEffect(() => {
    setName(agent.displayName);
    setDescription(agent.description);
  }, [agent.description, agent.displayName]);

  const unchanged = name.trim() === agent.displayName && description.trim() === agent.description;

  return (
    <form
      className="agent-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave({ displayName: name, description });
      }}
    >
      <label>
        표시 이름
        <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={100} />
      </label>
      <label>
        역할 설명
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="담당 업무와 이 에이전트에게 메시지를 보내야 하는 상황"
          rows={3}
          maxLength={500}
        />
        <small>{description.length}/500</small>
      </label>
      <button className="quiet-button" type="submit" disabled={disabled || unchanged}>설명 저장</button>
    </form>
  );
}

export function ManageDialog({
  open,
  agents,
  contacts,
  editingGroup,
  onClose,
  onRefreshAgents,
  onCreateAgent,
  onUpdateAgent,
  onIssueToken,
  onRevoke,
  onToggleAgent,
  onSaveGroup,
}: ManageDialogProps) {
  const [tab, setTab] = useState<"agents" | "groups">("agents");
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [expiry, setExpiry] = useState("90");
  const [groupName, setGroupName] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (editingGroup) {
      setTab("groups");
      setGroupName(editingGroup.name ?? "");
      setMemberIds(editingGroup.members.map((member) => member.id));
    } else {
      setGroupName("");
      setMemberIds([]);
    }
    void onRefreshAgents();
  }, [editingGroup, onRefreshAgents, open]);

  if (!open) return null;

  async function createAgent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const rawToken = await onCreateAgent({
        handle,
        displayName,
        description,
        expiresInDays: expiry ? Number(expiry) : null,
      });
      setToken(rawToken);
      setHandle("");
      setDisplayName("");
      setDescription("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "에이전트를 만들지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function updateAgent(agentId: string, input: { displayName: string; description: string }) {
    setBusy(true);
    setError(null);
    try {
      await onUpdateAgent(agentId, input);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "에이전트 설명을 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function saveGroup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSaveGroup({
        ...(editingGroup ? { id: editingGroup.id } : {}),
        name: groupName,
        memberIds,
      });
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "그룹을 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="manage-dialog" role="dialog" aria-modal="true" aria-labelledby="manage-title">
        <header>
          <div>
            <p className="eyebrow">AMBR Control</p>
            <h2 id="manage-title">에이전트와 그룹 관리</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="닫기">×</button>
        </header>
        <div className="dialog-tabs" role="tablist">
          <button className={tab === "agents" ? "active" : ""} onClick={() => setTab("agents")}>에이전트</button>
          <button className={tab === "groups" ? "active" : ""} onClick={() => setTab("groups")}>그룹</button>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}

        {tab === "agents" ? (
          <div className="manage-content">
            <form className="compact-form" onSubmit={createAgent}>
              <h3>새 에이전트</h3>
              <div className="form-grid">
                <label>Handle<input value={handle} onChange={(event) => setHandle(event.target.value.toLowerCase())} placeholder="research-agent" required pattern="[a-z0-9][a-z0-9._-]*[a-z0-9]" /></label>
                <label>표시 이름<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Research Agent" required /></label>
                <label>토큰 만료<select value={expiry} onChange={(event) => setExpiry(event.target.value)}><option value="30">30일</option><option value="90">90일</option><option value="365">1년</option><option value="">없음</option></select></label>
              </div>
              <label>
                역할 설명
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="담당 업무와 이 에이전트에게 메시지를 보내야 하는 상황"
                  rows={3}
                  maxLength={500}
                />
                <small>{description.length}/500</small>
              </label>
              <button className="primary-button" type="submit" disabled={busy}>에이전트와 토큰 생성</button>
            </form>
            <div className="agent-list">
              {agents.map((agent) => (
                <article key={agent.id} className="agent-panel">
                  <div className="agent-title"><span className="avatar agent">{agent.displayName.slice(0, 1)}</span><div><strong>{agent.displayName}</strong><small>@{agent.handle} · {agent.isActive ? "활성" : "중지"}</small></div></div>
                  <div className="agent-actions">
                    <button className="quiet-button" onClick={async () => setToken(await onIssueToken(agent.id, 90))}>토큰 추가</button>
                    <button className="quiet-button" onClick={() => void onToggleAgent(agent)}>{agent.isActive ? "중지" : "활성화"}</button>
                  </div>
                  <AgentEditor agent={agent} disabled={busy} onSave={(input) => updateAgent(agent.id, input)} />
                  <div className="credential-list">
                    {agent.credentials.map((credential) => (
                      <div key={credential.id}>
                        <span>{credential.revokedAt ? "폐기됨" : credential.expiresAt && Date.parse(credential.expiresAt) <= Date.now() ? "만료" : "활성"} · 마지막 사용 {credential.lastSeenAt ? new Date(credential.lastSeenAt).toLocaleString("ko-KR") : "없음"}</span>
                        {!credential.revokedAt ? <button className="danger-text" onClick={() => void onRevoke(credential.id)}>폐기</button> : null}
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : (
          <form className="manage-content compact-form" onSubmit={saveGroup}>
            <h3>{editingGroup ? "그룹 수정" : "새 그룹"}</h3>
            <label>그룹 이름<input value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="프로젝트 운영" required maxLength={100} /></label>
            <fieldset className="member-picker">
              <legend>멤버</legend>
              {contacts.map((contact) => (
                <label key={contact.id}>
                  <input
                    type="checkbox"
                    checked={memberIds.includes(contact.id)}
                    onChange={(event) => setMemberIds((current) => event.target.checked ? [...current, contact.id] : current.filter((id) => id !== contact.id))}
                  />
                  <span className={`avatar ${contact.kind}`}>{contact.displayName.slice(0, 1)}</span>
                  <span>
                    {contact.displayName}
                    <small>@{contact.handle}</small>
                    {contact.description ? <small className="contact-description">{contact.description}</small> : null}
                  </span>
                </label>
              ))}
            </fieldset>
            <button className="primary-button" type="submit" disabled={busy}>{busy ? "저장 중…" : "그룹 저장"}</button>
          </form>
        )}
      </section>
      {token ? <TokenReveal token={token} onClose={() => setToken(null)} /> : null}
    </div>
  );
}
