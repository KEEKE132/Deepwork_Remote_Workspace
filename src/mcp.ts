import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Actor } from "./auth";
import { AppError, cursorSchema, errorResponse, idSchema, linkSchema, prioritySchema } from "./core";
import { Messenger } from "./messenger";

const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

function toolError(error: unknown) {
  const response = errorResponse(error);
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: error instanceof AppError ? error.message : "AMBR 요청을 처리하지 못했습니다.",
      },
    ],
    _meta: { httpStatus: response.status },
  };
}

function result(value: unknown, summary: string) {
  return {
    content: [{ type: "text" as const, text: `${summary}\n\n${JSON.stringify(value, null, 2)}` }],
    structuredContent: { result: value },
  };
}

export function createAmbrMcpServer(env: Env, actor: Actor) {
  const server = new McpServer({ name: "ambr-messenger", version: "1.0.0" });
  const messenger = new Messenger(env, actor);

  server.registerTool(
    "whoami",
    {
      title: "AMBR 연결 정보",
      description: "현재 AMBR 토큰에 연결된 에이전트 handle과 활성 상태를 조회합니다.",
      inputSchema: z.object({}),
      annotations: readAnnotations,
    },
    async () => result({ ...actor, active: true }, `현재 AMBR 사용자는 @${actor.handle}입니다.`),
  );

  server.registerTool(
    "list_contacts",
    {
      title: "AMBR 연락처",
      description: "메시지를 보낼 수 있는 활성 에이전트와 사람의 handle, 표시 이름, 역할 설명을 조회합니다. 역할 설명을 비교해 작업에 맞는 수신자를 선택할 수 있습니다.",
      inputSchema: z.object({}),
      annotations: readAnnotations,
    },
    async () => {
      try {
        const contacts = await messenger.listContacts();
        return result(contacts, `활성 연락처 ${contacts.length}명을 찾았습니다.`);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "check_inbox",
    {
      title: "AMBR 수신함 확인",
      description: "미열람 대화, 미열람 메시지 수, 최근 메시지 미리보기를 조회합니다. 읽음으로 바꾸지는 않습니다.",
      inputSchema: z.object({}),
      annotations: readAnnotations,
    },
    async () => {
      try {
        const inbox = await messenger.checkInbox();
        return result(inbox, `미열람 메시지가 ${inbox.unreadMessageCount}건 있습니다.`);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "list_conversations",
    {
      title: "AMBR 대화 목록",
      description: "현재 참여 중인 1:1·그룹 대화를 최신순 커서 페이지로 조회합니다.",
      inputSchema: z.object({
        cursor: cursorSchema.optional().describe("이전 응답의 nextCursor"),
        limit: z.number().int().min(1).max(100).default(30),
      }),
      annotations: readAnnotations,
    },
    async ({ cursor, limit }) => {
      try {
        const page = await messenger.listConversations(cursor, limit);
        return result(page, `대화 ${page.conversations.length}개를 조회했습니다.`);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "list_messages",
    {
      title: "AMBR 메시지 목록",
      description: "지정한 참여 대화의 메시지를 최신순 커서 페이지로 조회합니다.",
      inputSchema: z.object({
        conversationId: idSchema,
        cursor: cursorSchema.optional().describe("이전 응답의 nextCursor"),
        limit: z.number().int().min(1).max(100).default(50),
      }),
      annotations: readAnnotations,
    },
    async ({ conversationId, cursor, limit }) => {
      try {
        const page = await messenger.listMessages(conversationId, cursor, limit);
        return result(page, `메시지 ${page.messages.length}건을 조회했습니다.`);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "send_message",
    {
      title: "AMBR 메시지 전송",
      description: "contact handle 또는 참여 conversation ID 중 하나로 텍스트와 구조화 맥락을 전송합니다.",
      inputSchema: z.object({
        to: z.string().trim().min(3).max(64).optional().describe("수신 contact handle"),
        conversationId: idSchema.optional(),
        text: z.string().trim().min(1).max(12000),
        replyToMessageId: idSchema.optional(),
        taskId: z.string().trim().min(1).max(200).optional(),
        priority: prioritySchema.default("normal"),
        links: z.array(linkSchema).max(20).default([]),
        clientMessageId: idSchema.optional().describe("재시도 중복 방지용 UUID"),
      }),
      annotations: writeAnnotations,
    },
    async (input) => {
      try {
        const message = await messenger.sendMessage(input);
        return result(message, `메시지를 전송했습니다. ID: ${message.id}`);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "mark_read",
    {
      title: "AMBR 읽음 처리",
      description: "지정한 메시지까지 읽음 커서를 원자적으로 전진시킵니다. 커서는 뒤로 이동하지 않습니다.",
      inputSchema: z.object({ conversationId: idSchema, messageId: idSchema }),
      annotations: writeAnnotations,
    },
    async ({ conversationId, messageId }) => {
      try {
        const read = await messenger.markRead(conversationId, messageId);
        return result(read, `메시지 ${messageId}까지 읽음 처리했습니다.`);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_message_status",
    {
      title: "AMBR 전달·읽음 상태",
      description: "메시지 전달 여부와 대화 참여자별 읽음 상태를 조회합니다.",
      inputSchema: z.object({ messageId: idSchema }),
      annotations: readAnnotations,
    },
    async ({ messageId }) => {
      try {
        const status = await messenger.getMessageStatus(messageId);
        return result(status, `메시지 ${messageId}의 상태입니다.`);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  return server;
}
