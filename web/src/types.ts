export interface Config {
  product: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
}

export interface Principal {
  id: string;
  handle: string;
  displayName: string;
  description?: string;
  kind: "human" | "agent";
}

export interface Member extends Principal {
  role: "owner" | "member";
}

export interface Conversation {
  id: string;
  kind: "direct" | "group";
  name: string | null;
  updatedAt: string;
  unreadCount: number;
  members: Member[];
  lastMessage: {
    id: string;
    senderHandle: string;
    text: string | null;
    deleted: boolean;
    priority: "low" | "normal" | "high" | "urgent";
    createdAt: string;
  } | null;
}

export interface Message {
  id: string;
  conversationId: string;
  sender: Pick<Principal, "id" | "handle" | "displayName">;
  text: string | null;
  replyToMessageId: string | null;
  taskId: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  links: Array<{ url: string; label?: string }>;
  clientMessageId: string | null;
  createdAt: string;
  expiresAt: string;
  deletedAt: string | null;
}

export interface Credential {
  id: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface Agent extends Omit<Principal, "kind" | "description"> {
  description: string;
  isActive: boolean;
  createdAt: string;
  credentials: Credential[];
}
