import { useMemo, useState } from "react";
import type { Conversation, Message, Principal } from "../types";

interface MessagePaneProps {
  conversation: Conversation | null;
  directTarget: Principal | null;
  currentPrincipalId: string;
  messages: Message[];
  busy: boolean;
  onBack: () => void;
  onSend: (input: {
    text: string;
    taskId?: string;
    priority: Message["priority"];
    replyToMessageId?: string;
  }) => Promise<void>;
  onDelete: (messageId: string) => Promise<void>;
  onEditGroup: () => void;
}

function title(conversation: Conversation | null, target: Principal | null, principalId: string) {
  if (target) return target.displayName;
  if (!conversation) return "대화를 선택하세요";
  return conversation.name ?? conversation.members.find((member) => member.id !== principalId)?.displayName ?? "1:1 대화";
}

export function MessagePane({
  conversation,
  directTarget,
  currentPrincipalId,
  messages,
  busy,
  onBack,
  onSend,
  onDelete,
  onEditGroup,
}: MessagePaneProps) {
  const [text, setText] = useState("");
  const [taskId, setTaskId] = useState("");
  const [priority, setPriority] = useState<Message["priority"]>("normal");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const sortedMessages = useMemo(
    () => [...messages].sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    [messages],
  );
  const isMember = directTarget !== null || conversation?.members.some((member) => member.id === currentPrincipalId);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!text.trim()) return;
    await onSend({
      text: text.trim(),
      taskId: taskId.trim() || undefined,
      priority,
      replyToMessageId: replyTo?.id,
    });
    setText("");
    setTaskId("");
    setPriority("normal");
    setReplyTo(null);
  }

  if (!conversation && !directTarget) {
    return (
      <section className="message-panel empty-state">
        <div className="empty-illustration">A</div>
        <h2>AMBR 대화를 선택하세요</h2>
        <p>왼쪽 목록에서 기존 대화를 열거나 연락처로 새 메시지를 보내세요.</p>
      </section>
    );
  }

  return (
    <section className="message-panel">
      <header className="message-header">
        <button className="mobile-back" onClick={onBack} aria-label="대화 목록으로">‹</button>
        <div>
          <h2>{title(conversation, directTarget, currentPrincipalId)}</h2>
          <p>
            {directTarget
              ? [`@${directTarget.handle}`, directTarget.description].filter(Boolean).join(" · ")
              : conversation?.members.map((member) => `@${member.handle}`).join(" · ")}
          </p>
        </div>
        {conversation?.kind === "group" ? <button className="quiet-button" onClick={onEditGroup}>그룹 관리</button> : null}
      </header>

      <div className="message-scroll" aria-live="polite">
        {sortedMessages.length === 0 ? <p className="day-divider">새 대화를 시작해보세요</p> : null}
        {sortedMessages.map((message) => {
          const mine = message.sender.id === currentPrincipalId;
          return (
            <article key={message.id} className={`message-row ${mine ? "mine" : ""}`}>
              {!mine ? <span className="avatar agent">{message.sender.displayName.slice(0, 1)}</span> : null}
              <div className="message-content">
                {!mine ? <span className="message-author">{message.sender.displayName} · @{message.sender.handle}</span> : null}
                <div className={`bubble priority-${message.priority} ${message.deletedAt ? "deleted" : ""}`}>
                  {message.replyToMessageId ? <span className="reply-label">↩ 답장</span> : null}
                  {message.deletedAt ? <em>관리자가 삭제한 메시지입니다.</em> : <p>{message.text}</p>}
                  {!message.deletedAt && message.taskId ? <span className="task-chip">Task · {message.taskId}</span> : null}
                  {!message.deletedAt && message.links.length > 0 ? (
                    <div className="message-links">
                      {message.links.map((link) => <a key={link.url} href={link.url} target="_blank" rel="noreferrer">{link.label ?? link.url}</a>)}
                    </div>
                  ) : null}
                </div>
                <div className="message-meta">
                  <time>{new Date(message.createdAt).toLocaleString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</time>
                  {!message.deletedAt ? <button onClick={() => setReplyTo(message)}>답장</button> : null}
                  {!message.deletedAt ? <button className="danger-text" onClick={() => void onDelete(message.id)}>삭제</button> : null}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {isMember ? (
        <form className="composer" onSubmit={submit}>
          {replyTo ? <div className="reply-preview"><span>@{replyTo.sender.handle}에게 답장</span><button type="button" onClick={() => setReplyTo(null)}>×</button></div> : null}
          <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="AMBR 메시지를 입력하세요" maxLength={12000} rows={2} />
          <div className="composer-options">
            <input value={taskId} onChange={(event) => setTaskId(event.target.value)} placeholder="Task ID (선택)" maxLength={200} />
            <select value={priority} onChange={(event) => setPriority(event.target.value as Message["priority"])} aria-label="우선순위">
              <option value="low">낮음</option>
              <option value="normal">보통</option>
              <option value="high">높음</option>
              <option value="urgent">긴급</option>
            </select>
            <button className="send-button" type="submit" disabled={busy || !text.trim()}>{busy ? "전송 중…" : "전송"}</button>
          </div>
        </form>
      ) : (
        <div className="read-only-notice">이 대화는 관리자 조회 전용입니다. 별도 1:1 대화나 관리자가 포함된 그룹에서 메시지를 보내세요.</div>
      )}
    </section>
  );
}
