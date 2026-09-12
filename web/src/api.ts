import type { Agent, Config, Conversation, Credential, Message, Principal } from "./types";

interface ApiErrorBody {
  error?: string;
  message?: string;
}

export class ApiClient {
  constructor(private readonly accessToken: string) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.accessToken}`);
    if (init.body) headers.set("Content-Type", "application/json");
    const response = await fetch(path, { ...init, headers });
    const body: unknown = await response.json();
    if (!response.ok) {
      const error = body as ApiErrorBody;
      throw new Error(error.message ?? error.error ?? "요청을 처리하지 못했습니다.");
    }
    return body as T;
  }

  session() {
    return this.request<{ email: string; principal: Principal }>("/api/admin/session");
  }

  contacts() {
    return this.request<{ contacts: Principal[] }>("/api/admin/contacts");
  }

  conversations() {
    return this.request<{ conversations: Conversation[]; nextCursor: string | null }>(
      "/api/admin/conversations?limit=100",
    );
  }

  messages(conversationId: string) {
    return this.request<{ messages: Message[]; nextCursor: string | null }>(
      `/api/admin/messages?conversationId=${encodeURIComponent(conversationId)}&limit=100`,
    );
  }

  sendMessage(input: {
    conversationId?: string;
    to?: string;
    text: string;
    replyToMessageId?: string;
    taskId?: string;
    priority?: Message["priority"];
    links?: Array<{ url: string; label?: string }>;
    clientMessageId?: string;
  }) {
    return this.request<{ message: Message }>("/api/admin/messages", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  deleteMessage(messageId: string) {
    return this.request<{ message: { id: string } }>(`/api/admin/messages/${messageId}`, {
      method: "DELETE",
    });
  }

  markRead(conversationId: string, messageId: string) {
    return this.request<{ read: { lastReadMessageId: string } }>("/api/admin/read", {
      method: "POST",
      body: JSON.stringify({ conversationId, messageId }),
    });
  }

  agents() {
    return this.request<{ agents: Agent[] }>("/api/admin/agents");
  }

  createAgent(input: { handle: string; displayName: string; expiresInDays: number | null }) {
    return this.request<{ agent: Agent; token: string }>("/api/admin/agents", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  issueToken(agentId: string, expiresInDays: number | null) {
    return this.request<{ credential: Credential; token: string }>(
      `/api/admin/agents/${agentId}/tokens`,
      { method: "POST", body: JSON.stringify({ expiresInDays }) },
    );
  }

  updateAgent(agentId: string, input: { displayName?: string; isActive?: boolean }) {
    return this.request<{ updated: true }>(`/api/admin/agents/${agentId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  revokeCredential(credentialId: string) {
    return this.request<{ revoked: true }>(`/api/admin/credentials/${credentialId}/revoke`, {
      method: "POST",
    });
  }

  saveGroup(input: { id?: string; name: string; memberIds: string[] }) {
    return this.request<{ group: Conversation }>("/api/admin/groups", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }
}

export async function loadConfig(): Promise<Config> {
  const response = await fetch("/api/config");
  if (!response.ok) throw new Error("AMBR 연결 설정을 불러오지 못했습니다.");
  return (await response.json()) as Config;
}
