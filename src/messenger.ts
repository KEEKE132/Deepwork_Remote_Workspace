import { z } from "zod";
import type { Actor } from "./auth";
import { decodeCursor, idSchema, nextCursor, sendMessageSchema } from "./core";
import { DataApi } from "./data-api";

const memberSchema = z.object({
  id: z.string().uuid(),
  handle: z.string(),
  displayName: z.string(),
  kind: z.enum(["human", "agent"]),
  role: z.enum(["owner", "member"]),
});

const lastMessageSchema = z
  .object({
    id: z.string().uuid(),
    senderHandle: z.string(),
    text: z.string().nullable(),
    deleted: z.boolean(),
    priority: z.enum(["low", "normal", "high", "urgent"]),
    createdAt: z.string().datetime({ offset: true }),
  })
  .nullable();

const conversationRowSchema = z.object({
  conversation_id: z.string().uuid(),
  kind: z.enum(["direct", "group"]),
  name: z.string().nullable(),
  sort_at: z.string().datetime({ offset: true }),
  unread_count: z.coerce.number().int().nonnegative(),
  members: z.array(memberSchema),
  last_message: lastMessageSchema,
});

const messageRowSchema = z.object({
  message_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  sender_id: z.string().uuid(),
  sender_handle: z.string(),
  sender_display_name: z.string(),
  body: z.string().nullable(),
  reply_to_message_id: z.string().uuid().nullable(),
  task_id: z.string().nullable(),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  links: z.array(z.object({ url: z.string().url(), label: z.string().optional() })),
  client_message_id: z.string().uuid().nullable(),
  created_at: z.string().datetime({ offset: true }),
  expires_at: z.string().datetime({ offset: true }),
  deleted_at: z.string().datetime({ offset: true }).nullable(),
});

const sentMessageSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  senderId: z.string().uuid(),
  text: z.string().nullable(),
  replyToMessageId: z.string().uuid().nullable(),
  taskId: z.string().nullable(),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  links: z.array(z.object({ url: z.string().url(), label: z.string().optional() })),
  clientMessageId: z.string().uuid(),
  createdAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  deduplicated: z.boolean(),
});

const readResultSchema = z.object({
  conversationId: z.string().uuid(),
  lastReadMessageId: z.string().uuid(),
  readAt: z.string().datetime({ offset: true }),
});

const statusSchema = z.object({
  messageId: z.string().uuid(),
  conversationId: z.string().uuid(),
  delivered: z.boolean(),
  participants: z.array(
    z.object({
      principalId: z.string().uuid(),
      handle: z.string(),
      displayName: z.string(),
      read: z.boolean(),
      readAt: z.string().datetime({ offset: true }).nullable(),
    }),
  ),
});

export type SendMessageInput = z.input<typeof sendMessageSchema>;

export class Messenger {
  private readonly data: DataApi;

  constructor(
    env: Env,
    private readonly actor: Actor,
    private readonly includeAll = false,
  ) {
    this.data = new DataApi(env);
  }

  async listContacts() {
    const query = new URLSearchParams({
      select: "id,handle,display_name,kind",
      is_active: "eq.true",
      id: `neq.${this.actor.id}`,
      order: "handle.asc",
    });
    const rows = await this.data.select(
      `principals?${query.toString()}`,
      z.array(
        z.object({
          id: z.string().uuid(),
          handle: z.string(),
          display_name: z.string(),
          kind: z.enum(["human", "agent"]),
        }),
      ),
    );
    return rows.map((row) => ({
      id: row.id,
      handle: row.handle,
      displayName: row.display_name,
      kind: row.kind,
    }));
  }

  async listConversations(cursor?: string, requestedLimit = 30) {
    const limit = Math.min(Math.max(requestedLimit, 1), 100);
    const before = decodeCursor(cursor);
    const rows = await this.data.rpc(
      "ambr_list_conversations",
      {
        p_actor_id: this.actor.id,
        p_include_all: this.includeAll,
        p_before_at: before?.at ?? null,
        p_before_id: before?.id ?? null,
        p_limit: limit,
      },
      z.array(conversationRowSchema),
    );
    const conversations = rows.map((row) => ({
      id: row.conversation_id,
      kind: row.kind,
      name: row.name,
      updatedAt: row.sort_at,
      unreadCount: row.unread_count,
      members: row.members,
      lastMessage: row.last_message,
    }));
    return {
      conversations,
      nextCursor: nextCursor(rows, limit, (row) => ({ at: row.sort_at, id: row.conversation_id })),
    };
  }

  async checkInbox() {
    const page = await this.listConversations(undefined, 100);
    const conversations = page.conversations.filter((conversation) => conversation.unreadCount > 0);
    return {
      unreadConversations: conversations,
      unreadConversationCount: conversations.length,
      unreadMessageCount: conversations.reduce((sum, conversation) => sum + conversation.unreadCount, 0),
    };
  }

  async listMessages(conversationId: string, cursor?: string, requestedLimit = 50) {
    const id = idSchema.parse(conversationId);
    const limit = Math.min(Math.max(requestedLimit, 1), 100);
    const before = decodeCursor(cursor);
    const rows = await this.data.rpc(
      "ambr_list_messages",
      {
        p_actor_id: this.actor.id,
        p_conversation_id: id,
        p_include_all: this.includeAll,
        p_before_at: before?.at ?? null,
        p_before_id: before?.id ?? null,
        p_limit: limit,
      },
      z.array(messageRowSchema),
    );
    const messages = rows.map((row) => ({
      id: row.message_id,
      conversationId: row.conversation_id,
      sender: {
        id: row.sender_id,
        handle: row.sender_handle,
        displayName: row.sender_display_name,
      },
      text: row.body,
      replyToMessageId: row.reply_to_message_id,
      taskId: row.task_id,
      priority: row.priority,
      links: row.links,
      clientMessageId: row.client_message_id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      deletedAt: row.deleted_at,
    }));
    return {
      messages,
      nextCursor: nextCursor(rows, limit, (row) => ({ at: row.created_at, id: row.message_id })),
    };
  }

  async sendMessage(input: SendMessageInput) {
    const parsed = sendMessageSchema.parse(input);
    return this.data.rpc(
      "ambr_send_message",
      {
        p_actor_id: this.actor.id,
        p_to_handle: parsed.to ?? null,
        p_conversation_id: parsed.conversationId ?? null,
        p_text: parsed.text,
        p_reply_to_message_id: parsed.replyToMessageId ?? null,
        p_task_id: parsed.taskId ?? null,
        p_priority: parsed.priority,
        p_links: parsed.links,
        p_client_message_id: parsed.clientMessageId ?? crypto.randomUUID(),
      },
      sentMessageSchema,
    );
  }

  markRead(conversationId: string, messageId: string) {
    return this.data.rpc(
      "ambr_mark_read",
      {
        p_actor_id: this.actor.id,
        p_conversation_id: idSchema.parse(conversationId),
        p_message_id: idSchema.parse(messageId),
      },
      readResultSchema,
    );
  }

  getMessageStatus(messageId: string) {
    return this.data.rpc(
      "ambr_get_message_status",
      { p_actor_id: this.actor.id, p_message_id: idSchema.parse(messageId) },
      statusSchema,
    );
  }
}
