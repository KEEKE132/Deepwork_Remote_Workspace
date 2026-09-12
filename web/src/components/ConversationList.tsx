import type { Conversation, Principal } from "../types";

interface ConversationListProps {
  conversations: Conversation[];
  contacts: Principal[];
  currentPrincipalId: string;
  selectedId: string | null;
  onSelect: (conversation: Conversation) => void;
  onDirect: (contact: Principal) => void;
  onManage: () => void;
}

function conversationTitle(conversation: Conversation, currentPrincipalId: string): string {
  if (conversation.name) return conversation.name;
  return (
    conversation.members.find((member) => member.id !== currentPrincipalId)?.displayName ??
    "1:1 대화"
  );
}

function preview(conversation: Conversation): string {
  if (!conversation.lastMessage) return "아직 메시지가 없습니다";
  if (conversation.lastMessage.deleted) return "삭제된 메시지";
  return conversation.lastMessage.text ?? "삭제된 메시지";
}

export function ConversationList({
  conversations,
  contacts,
  currentPrincipalId,
  selectedId,
  onSelect,
  onDirect,
  onManage,
}: ConversationListProps) {
  return (
    <aside className="conversation-panel">
      <div className="conversation-header">
        <div>
          <p className="eyebrow">AMBR</p>
          <h1>Messages</h1>
        </div>
        <button className="icon-button" onClick={onManage} aria-label="에이전트와 그룹 관리">＋</button>
      </div>

      <div className="contact-strip" aria-label="새 1:1 대화">
        {contacts.map((contact) => (
          <button key={contact.id} className="contact-chip" onClick={() => onDirect(contact)}>
            <span className={`avatar ${contact.kind}`}>{contact.displayName.slice(0, 1)}</span>
            <span>@{contact.handle}</span>
          </button>
        ))}
      </div>

      <nav className="conversation-list" aria-label="전체 대화">
        {conversations.length === 0 ? (
          <p className="empty-copy">아직 대화가 없습니다. 위 연락처를 눌러 시작하세요.</p>
        ) : null}
        {conversations.map((conversation) => (
          <button
            key={conversation.id}
            className={`conversation-item ${selectedId === conversation.id ? "selected" : ""}`}
            onClick={() => onSelect(conversation)}
          >
            <span className={`avatar ${conversation.kind}`}>{conversation.kind === "group" ? "#" : conversationTitle(conversation, currentPrincipalId).slice(0, 1)}</span>
            <span className="conversation-summary">
              <span className="conversation-title-row">
                <strong>{conversationTitle(conversation, currentPrincipalId)}</strong>
                <time>{new Date(conversation.updatedAt).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })}</time>
              </span>
              <span className="conversation-preview">{preview(conversation)}</span>
            </span>
            {conversation.unreadCount > 0 ? <span className="unread-badge">{conversation.unreadCount}</span> : null}
          </button>
        ))}
      </nav>
    </aside>
  );
}
