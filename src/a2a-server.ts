import {
  AgentCard,
  AgentSkill,
  Artifact,
  Message,
  Part,
  Role,
  Task,
  TaskArtifactUpdateEvent,
  TaskState,
  TaskStatusUpdateEvent,
} from "@a2a-js/sdk";
import {
  AgentEvent,
  AgentExecutor,
  DefaultRequestHandler,
  ExecutionEventBus,
  RequestContext,
  ServerCallContext,
} from "@a2a-js/sdk/server";
import type { Env } from "./env";
import { KvTaskStore, ownerOf } from "./a2a-store";

/**
 * A2A 메신저 허브 — 에이전트 간 대화(카톡 스타일)를 중계하는 Workers 핸들러.
 *
 * 설계 요약
 * - Message = 대화의 한 턴. 받아 소비하면 끝(휘발). docs/* 지식 DB에 저장되지 않는다.
 * - Task = 대화 스레드. contextId로 같은 대화를 묶는다.
 * - 사서함 = KvTaskStore. 소유자(인증된 에이전트 라벨)별 KV 사서함에 Task 보관.
 * - 폴링 = ListTasks/GetTask로 자신의 사서함을 확인한다.
 * - 수신 즉시 삭제 = 소비(consume) 시 KV에서 Task 삭제.
 *
 * 메시지 라우팅
 * - 발신자가 metadata.to = "수신자 라벨"로 보내면, 허브가 그 메시지를
 *   수신자 소유자 사서함에 Task로 저장해 전달한다.
 */

/** Agent Card — 다른 에이전트가 이 허브를 발견하고 대화하는 진입점 */
export function buildAgentCard(origin: string): AgentCard {
  const chatSkill: AgentSkill = {
    id: "agent-chat",
    name: "에이전트 간 메시지(대화)",
    description:
      "다른 에이전트와 작업 맥락·상황을 주고받는 메신저 허브. sendMessage로 대화를 시작하고, ListTasks/GetTask 폴링으로 수신한 메시지를 확인·소비한다.",
    tags: ["chat", "message", "collaboration"],
    examples: [
      '{"metadata":{"to":"agent-b"},"parts":[{"content":{"$case":"text","value":"지금 디버깅 중이야, 로그 참고해"}}]}',
    ],
    inputModes: ["text/plain"],
    outputModes: ["text/plain"],
    securityRequirements: [],
  };

  return {
    name: "deepwork-messenger-hub",
    description:
      "다른 사람·다른 컴퓨터에서 동작하는 에이전트들이 카카오톡처럼 대화하는 중앙 허브. 각 에이전트는 Bearer 토큰으로 인증하고, 폴링으로 사서함을 확인한다.",
    supportedInterfaces: [
      {
        url: `${origin}/a2a`,
        protocolBinding: "JSONRPC",
        tenant: "",
        protocolVersion: "1.0",
      },
    ],
    provider: { url: origin, organization: "deepwork" },
    version: "0.1.0",
    documentationUrl: `${origin}/admin`,
    capabilities: { streaming: false, pushNotifications: false, extensions: [], extendedAgentCard: false },
    securitySchemes: {
      bearer: {
        scheme: {
          $case: "httpAuthSecurityScheme",
          value: {
            description: "MCP/A2A 공용 Bearer 토큰 (/admin 에서 발급)",
            scheme: "bearer",
            bearerFormat: "opaque",
          },
        },
      },
    },
    securityRequirements: [{ schemes: { bearer: { list: [] } } }],
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [chatSkill],
    signatures: [],
  };
}

/** 메시지에서 텍스트 본문 추출 */
export function messageText(message: Message): string {
  const textPart = message.parts.find((p) => p.content?.$case === "text");
  const content = textPart?.content;
  return content && content.$case === "text" ? content.value : "";
}

/** 메시지 metadata.to — 목적지 에이전트 라벨 */
export function messageTo(message: Message): string | undefined {
  const to = message.metadata?.to;
  return typeof to === "string" && to ? to : undefined;
}

/** 수신자 소유자 사서함에 Task를 저장한다 (수신자 컨텍스트로) */
async function deliverToMailbox(
  store: KvTaskStore,
  recipientLabel: string,
  task: Task,
  context: ServerCallContext
): Promise<void> {
  // 수신자 라벨을 소유자로 하는 별도 컨텍스트로 저장
  const recipientContext = new ServerCallContext({
    user: { isAuthenticated: true, userName: recipientLabel },
    tenant: context.tenant,
    requestedVersion: context.requestedVersion,
  });
  await store.save(task, recipientContext);
}

/** task에서 수신자 사서함 전용 사본을 만든다 (발신자 Task와 별개 ID/상태) */
function buildIncomingTask(
  contextId: string,
  userMessage: Message,
  senderLabel: string,
  text: string
): Task {
  const taskId = crypto.randomUUID();
  const incomingMsg: Message = {
    messageId: userMessage.messageId,
    contextId,
    taskId,
    role: Role.ROLE_USER,
    parts: userMessage.parts,
    metadata: userMessage.metadata ?? {},
    extensions: userMessage.extensions ?? [],
    referenceTaskIds: userMessage.referenceTaskIds ?? [],
  };
  return {
    id: taskId,
    contextId,
    status: {
      state: TaskState.TASK_STATE_SUBMITTED,
      timestamp: new Date().toISOString(),
      message: {
        role: Role.ROLE_AGENT,
        messageId: crypto.randomUUID(),
        taskId,
        contextId,
        parts: [
          {
            content: {
              $case: "text",
              value: `[${senderLabel}] ${text}`,
            },
            metadata: undefined,
            filename: "",
            mediaType: "text/plain",
          },
        ],
        metadata: { sender: senderLabel, kind: "incoming" },
        extensions: [],
        referenceTaskIds: [],
      },
    },
    artifacts: [],
    history: [incomingMsg],
    metadata: { ...(userMessage.metadata ?? {}), sender: senderLabel, direction: "incoming" },
  };
}

/**
 * 허브 AgentExecutor.
 * - 발신자에게는 수신 확인(ack) Task를 반환한다.
 * - metadata.to가 있으면 해당 수신자 사서함에 Task를 전달한다.
 */
class HubExecutor implements AgentExecutor {
  constructor(
    private readonly store: KvTaskStore,
    private readonly senderLabel: string
  ) {}

  cancelTask = async (_taskId: string, _eventBus: ExecutionEventBus): Promise<void> => {};

  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const userMessage = requestContext.userMessage;
    const taskId = requestContext.taskId;
    const contextId = requestContext.contextId;
    const text = messageText(userMessage);
    const to = messageTo(userMessage);

    // 발신자 사서함 Task 스냅샷 (사서함에 영속화됨)
    const senderTask: Task = requestContext.task ?? {
      id: taskId,
      contextId,
      status: {
        state: TaskState.TASK_STATE_SUBMITTED,
        timestamp: new Date().toISOString(),
        message: undefined,
      },
      artifacts: [],
      history: [userMessage],
      metadata: userMessage.metadata ?? {},
    };
    eventBus.publish(AgentEvent.task(senderTask));

    // working 상태
    eventBus.publish(
      AgentEvent.statusUpdate({
        taskId,
        contextId,
        status: {
          state: TaskState.TASK_STATE_WORKING,
          timestamp: new Date().toISOString(),
          message: undefined,
        },
        metadata: {},
      })
    );

    // 상대 사서함으로 전달
    if (to && to !== this.senderLabel) {
      const incomingTask = buildIncomingTask(contextId, userMessage, this.senderLabel, text || "");
      await deliverToMailbox(this.store, to, incomingTask, requestContext.context);
    }

    // 발신자에게 완료 + ack 응답
    const replyText = to
      ? `메시지가 ${to} 에게 전달되었습니다. (대화 ${contextId})`
      : "메시지를 수신했습니다. (수신자는 metadata.to 로 지정하세요)";

    const artifact: Artifact = {
      artifactId: crypto.randomUUID(),
      name: "ack",
      description: "메신저 허브 전달 결과",
      parts: [
        {
          content: { $case: "text", value: replyText },
          metadata: undefined,
          filename: "",
          mediaType: "text/plain",
        },
      ],
      metadata: { deliveredTo: to ?? null, contextId },
      extensions: [],
    };
    const artifactUpdate: TaskArtifactUpdateEvent = {
      taskId,
      contextId,
      artifact,
      append: false,
      lastChunk: true,
      metadata: undefined,
    };
    eventBus.publish(AgentEvent.artifactUpdate(artifactUpdate));

    eventBus.publish(
      AgentEvent.statusUpdate({
        taskId,
        contextId,
        status: {
          state: TaskState.TASK_STATE_COMPLETED,
          timestamp: new Date().toISOString(),
          message: undefined,
        },
        metadata: {},
      })
    );
  }
}

/** A2A 요청을 처리하는 인스턴스를 만든다 (요청 스코프, stateless) */
export function createMessengerHandler(env: Env, senderLabel: string, origin: string) {
  const store = new KvTaskStore(env);
  const agentCard = buildAgentCard(origin);
  const executor = new HubExecutor(store, senderLabel);
  const handler = new DefaultRequestHandler(agentCard, store, executor);
  return { handler, store, agentCard };
}
