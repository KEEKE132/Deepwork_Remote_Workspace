#!/usr/bin/env node
/**
 * A2A 메신저 허브 폴링 클라이언트 예제
 *
 * 다른 사람·다른 컴퓨터에서 동작하는 에이전트가 이 허브를 통해
 * "카카오톡처럼" 메시지를 주고받는 방법을 보여준다.
 *
 * 사용법:
 *   export A2A_URL="https://<worker>/a2a"
 *   export A2A_TOKEN="<admin에서 발급한 Bearer 토큰>"
 *   node examples/a2a-client.mjs send --to agent-b "안녕? 지금 디버깅 중이야"
 *   node examples/a2a-client.mjs inbox            # 내가 받은 메시지(사서함) 조회
 *   node examples/a2a-client.mjs reply --task <taskId> "응, 로그 보여줘"
 *
 * 설계 노트:
 * - sendMessage: 보낸이의 Task(전달 확인) + metadata.to 의 수신자 사서함 Task 생성
 * - 받기(폴링): ListTasks 로 내 사서함의 새 스레드를 확인한다
 * - 휘발성: 대화 Task는 지식 문서(docs)와 분리된 KV 사서함에만 존재한다
 */
const BASE = process.env.A2A_URL || "http://127.0.0.1:8787/a2a";
const TOKEN = process.env.A2A_TOKEN || "";

async function rpc(method, params) {
  const res = await fetch(BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
      "A2A-Version": "1.0",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method, params }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

const textPart = (msg) =>
  msg.parts?.find((p) => p.content?.$case === "text")?.content?.value || "";

async function sendMessage(to, text) {
  const contextId = crypto.randomUUID();
  const res = await rpc("SendMessage", {
    message: {
      messageId: crypto.randomUUID(),
      contextId,
      role: "user",
      parts: [{ content: { $case: "text", value: text }, filename: "", mediaType: "text/plain", metadata: {} }],
      metadata: { to },
      extensions: [],
      referenceTaskIds: [],
    },
    configuration: { returnImmediately: true, acceptedOutputModes: ["text/plain"], taskPushNotificationConfig: undefined },
  });
  console.log("전송 완료 →", JSON.stringify(res, null, 2));
  console.log("\n(대화 contextId:", contextId, ")");
  return res;
}

async function inbox() {
  const res = await rpc("ListTasks", {
    contextId: "",
    status: "",
    pageSize: 50,
    pageToken: "",
    includeArtifacts: true,
  });
  console.log("내 사서함:", JSON.stringify(res.result ?? res, null, 2));
  return res;
}

async function getTask(taskId) {
  const res = await rpc("GetTask", { id: taskId, historyLength: 10 });
  console.log("Task 상세:", JSON.stringify(res.result ?? res, null, 2));
  return res;
}

const [cmd, arg1, ...rest] = process.argv.slice(2);
if (cmd === "send" && arg1 && rest.length) {
  await sendMessage(arg1, rest.join(" "));
} else if (cmd === "inbox") {
  await inbox();
} else if (cmd === "get" && arg1) {
  await getTask(arg1);
} else {
  console.log("사용법:\n  send --to <라벨> <텍스트>\n  inbox\n  get <taskId>");
}