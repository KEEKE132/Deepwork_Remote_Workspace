import { readFile } from "node:fs/promises";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const workerUrl = process.env.AMBR_E2E_URL ?? "http://127.0.0.1:8787";
const localVars = Object.fromEntries(
  (await readFile(new URL("../.dev.vars", import.meta.url), "utf8"))
    .split(/\r?\n/u)
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1)];
    }),
);

const supabaseUrl = localVars.SUPABASE_URL;
const secretKey = localVars.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !secretKey) throw new Error(".dev.vars에 로컬 Supabase 설정이 필요합니다.");

const createdPrincipalIds = [];
let conversationId;

async function database(path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("apikey", secretKey);
  headers.set("Content-Type", "application/json");
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, { ...init, headers });
  if (!response.ok) throw new Error(`Database ${response.status}: ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

async function createAgent(handle, token, expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(), description = "") {
  const agent = await database("rpc/ambr_admin_create_agent_with_description", {
    method: "POST",
    body: JSON.stringify({
      p_handle: handle,
      p_display_name: handle,
      p_description: description,
      p_token_hash: createHash("sha256").update(token).digest("hex"),
      p_expires_at: expiresAt,
    }),
  });
  createdPrincipalIds.push(agent.id);
  return agent;
}

async function expectUnauthorized(url, init) {
  const response = await fetch(url, init);
  if (response.status !== 401) throw new Error(`Expected 401, received ${response.status}`);
}

async function expectConnectRejected(token, name) {
  const client = new Client({ name, version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${workerUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  try {
    await client.connect(transport);
  } catch {
    return;
  }
  await client.close().catch(() => undefined);
  throw new Error(`${name} credential unexpectedly connected`);
}

async function connect(token, name) {
  const client = new Client({ name, version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${workerUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return client;
}

async function connectThroughBrowserOAuth(ambrToken) {
  const metadataResponse = await fetch(`${workerUrl}/.well-known/oauth-protected-resource/mcp`);
  const metadata = await metadataResponse.json();
  if (metadata.resource !== `${workerUrl}/mcp`) throw new Error("OAuth protected resource metadata mismatch");

  const redirectUri = "http://127.0.0.1:43991/callback/ambr-e2e";
  const registrationResponse = await fetch(`${workerUrl}/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
      client_name: "AMBR E2E",
    }),
  });
  if (registrationResponse.status !== 201) {
    throw new Error(`OAuth client registration failed: ${await registrationResponse.text()}`);
  }
  const registration = await registrationResponse.json();
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorizeUrl = new URL(`${workerUrl}/oauth/authorize`);
  const authorizationParams = {
    client_id: registration.client_id,
    redirect_uri: redirectUri,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: randomUUID(),
    resource: `${workerUrl}/mcp`,
    scope: "ambr",
  };
  for (const [key, value] of Object.entries(authorizationParams)) authorizeUrl.searchParams.set(key, value);
  const authorizationPage = await fetch(authorizeUrl);
  const pageHtml = await authorizationPage.text();
  const csrfToken = /name="csrf_token" value="([^"]+)"/u.exec(pageHtml)?.[1];
  const setCookie = authorizationPage.headers.get("set-cookie");
  const cookie = setCookie?.split(";", 1)[0];
  if (!csrfToken || !cookie || !setCookie || !pageHtml.includes("에이전트 토큰")) {
    throw new Error("OAuth token-entry page did not load");
  }
  assert.match(setCookie, /; Path=\//u);
  assert.doesNotMatch(setCookie, /; Path=\/oauth\/authorize/u);

  const approvalResponse = await fetch(`${workerUrl}/oauth/authorize`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
    body: new URLSearchParams({ ...authorizationParams, csrf_token: csrfToken, ambr_token: ambrToken }),
  });
  if (approvalResponse.status !== 302) {
    throw new Error(`OAuth token approval failed: ${approvalResponse.status} ${await approvalResponse.text()}`);
  }
  const callback = new URL(approvalResponse.headers.get("location"));
  const code = callback.searchParams.get("code");
  if (!code || callback.searchParams.get("state") !== authorizationParams.state) {
    throw new Error("OAuth authorization response mismatch");
  }

  async function exchange(codeVerifier) {
    return fetch(`${workerUrl}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: codeVerifier,
        client_id: registration.client_id,
        redirect_uri: redirectUri,
        resource: `${workerUrl}/mcp`,
      }),
    });
  }

  const wrongVerifier = randomBytes(48).toString("base64url");
  const rejectedExchange = await exchange(wrongVerifier);
  if (rejectedExchange.status !== 400) throw new Error("OAuth PKCE mismatch was not rejected");
  const tokenResponse = await exchange(verifier);
  const tokens = await tokenResponse.json();
  if (!tokenResponse.ok || tokens.access_token !== ambrToken || tokens.token_type !== "Bearer") {
    throw new Error("OAuth token exchange failed");
  }
  const replayResponse = await exchange(verifier);
  if (replayResponse.status !== 400) throw new Error("OAuth authorization code replay was not rejected");
  return tokens.access_token;
}

const suffix = randomUUID().slice(0, 8);
const firstHandle = `e2e-one-${suffix}`;
const secondHandle = `e2e-two-${suffix}`;
const firstToken = `ambr_${randomBytes(48).toString("base64url")}`;
const secondToken = `ambr_${randomBytes(48).toString("base64url")}`;
const expiredToken = `ambr_${randomBytes(48).toString("base64url")}`;
const revokedToken = `ambr_${randomBytes(48).toString("base64url")}`;
let firstClient;
let secondClient;

try {
  await expectUnauthorized(`${workerUrl}/mcp`, { method: "POST" });
  await expectUnauthorized(`${workerUrl}/mcp?token=${encodeURIComponent(firstToken)}`, { method: "POST" });
  await expectConnectRejected(`ambr_${randomBytes(48).toString("base64url")}`, "forged");

  await createAgent(`e2e-expired-${suffix}`, expiredToken, new Date(Date.now() - 60_000).toISOString());
  await expectConnectRejected(expiredToken, "expired");
  const revokedAgent = await createAgent(`e2e-revoked-${suffix}`, revokedToken);
  await database(`agent_credentials?id=eq.${revokedAgent.credentialId}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ revoked_at: new Date().toISOString() }),
  });
  await expectConnectRejected(revokedToken, "revoked");

  await createAgent(firstHandle, firstToken, undefined, "Coordinates AMBR end-to-end verification.");
  await createAgent(secondHandle, secondToken, undefined, "Receives AMBR verification messages.");
  const oauthAccessToken = await connectThroughBrowserOAuth(firstToken);
  firstClient = await connect(oauthAccessToken, "ambr-e2e-first");
  secondClient = await connect(secondToken, "ambr-e2e-second");

  const tools = await firstClient.listTools();
  const expectedTools = [
    "check_inbox",
    "get_message_status",
    "list_contacts",
    "list_conversations",
    "list_messages",
    "mark_read",
    "send_message",
    "whoami",
  ];
  const actualTools = tools.tools.map((tool) => tool.name).toSorted();
  if (JSON.stringify(actualTools) !== JSON.stringify(expectedTools)) {
    throw new Error(`Unexpected tools: ${actualTools.join(", ")}`);
  }

  const contacts = await firstClient.callTool({ name: "list_contacts", arguments: {} });
  const contactResult = contacts.structuredContent?.result;
  if (
    !Array.isArray(contactResult)
    || !contactResult.some(
      (contact) => contact.handle === secondHandle
        && contact.description === "Receives AMBR verification messages.",
    )
  ) {
    throw new Error("list_contacts did not return the routing description");
  }

  const clientMessageId = randomUUID();
  const sent = await firstClient.callTool({
    name: "send_message",
    arguments: {
      to: secondHandle,
      text: "AMBR local E2E message",
      taskId: "e2e-task",
      priority: "high",
      links: [{ url: "https://example.com", label: "reference" }],
      clientMessageId,
    },
  });
  const sentResult = sent.structuredContent?.result;
  if (!sentResult || typeof sentResult !== "object" || !("conversationId" in sentResult)) {
    throw new Error("send_message did not return a conversation ID");
  }
  conversationId = sentResult.conversationId;
  const firstMessageId = sentResult.id;

  const duplicate = await firstClient.callTool({
    name: "send_message",
    arguments: {
      to: secondHandle,
      text: "This retry must not replace the original",
      clientMessageId,
    },
  });
  const duplicateResult = duplicate.structuredContent?.result;
  if (!duplicateResult || typeof duplicateResult !== "object" || duplicateResult.id !== firstMessageId) {
    throw new Error("idempotent retry did not return the original message");
  }

  const followUp = await firstClient.callTool({
    name: "send_message",
    arguments: {
      to: secondHandle,
      text: "AMBR direct conversation reuse",
      clientMessageId: randomUUID(),
    },
  });
  const followUpResult = followUp.structuredContent?.result;
  if (!followUpResult || typeof followUpResult !== "object" || followUpResult.conversationId !== conversationId) {
    throw new Error("direct conversation was not reused");
  }

  const reply = await secondClient.callTool({
    name: "send_message",
    arguments: {
      conversationId,
      text: "AMBR reply",
      replyToMessageId: firstMessageId,
      clientMessageId: randomUUID(),
    },
  });
  const replyResult = reply.structuredContent?.result;
  if (!replyResult || typeof replyResult !== "object" || replyResult.replyToMessageId !== firstMessageId) {
    throw new Error("reply metadata was not preserved");
  }

  const inbox = await secondClient.callTool({ name: "check_inbox", arguments: {} });
  const inboxResult = inbox.structuredContent?.result;
  if (!inboxResult || typeof inboxResult !== "object" || inboxResult.unreadMessageCount !== 2) {
    throw new Error("receiver inbox did not contain the new message");
  }

  const page = await secondClient.callTool({
    name: "list_messages",
    arguments: { conversationId, limit: 2 },
  });
  const pageResult = page.structuredContent?.result;
  const messages = pageResult && typeof pageResult === "object" && "messages" in pageResult
    ? pageResult.messages
    : null;
  if (!Array.isArray(messages) || messages.length !== 2 || !pageResult.nextCursor) {
    throw new Error("message cursor page mismatch");
  }
  const newestMessageId = messages[0].id;

  const olderPage = await secondClient.callTool({
    name: "list_messages",
    arguments: { conversationId, cursor: pageResult.nextCursor, limit: 2 },
  });
  const olderResult = olderPage.structuredContent?.result;
  const olderMessages = olderResult && typeof olderResult === "object" && "messages" in olderResult
    ? olderResult.messages
    : null;
  if (!Array.isArray(olderMessages) || olderMessages.length !== 1) {
    throw new Error("message cursor continuation mismatch");
  }

  await secondClient.callTool({
    name: "mark_read",
    arguments: { conversationId, messageId: newestMessageId },
  });
  const backwards = await secondClient.callTool({
    name: "mark_read",
    arguments: { conversationId, messageId: firstMessageId },
  });
  if (!backwards.isError) throw new Error("read cursor moved backwards");
  const status = await firstClient.callTool({
    name: "get_message_status",
    arguments: { messageId: firstMessageId },
  });
  const statusResult = status.structuredContent?.result;
  const participants = statusResult && typeof statusResult === "object" && "participants" in statusResult
    ? statusResult.participants
    : null;
  if (!Array.isArray(participants) || !participants.some((participant) => participant.handle === secondHandle && participant.read)) {
    throw new Error("read receipt was not recorded");
  }

  console.log(JSON.stringify({
    status: "pass",
    tools: actualTools.length,
    contactDescription: true,
    browserOAuth: true,
    authCases: 5,
    delivered: true,
    directConversationReused: true,
    idempotentRetry: true,
    reply: true,
    cursorPagination: true,
    backwardsReadRejected: true,
    inboxUnread: 2,
    readReceipt: true,
  }));
} finally {
  await firstClient?.close().catch(() => undefined);
  await secondClient?.close().catch(() => undefined);
  if (conversationId) {
    await database(`conversations?id=eq.${conversationId}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    }).catch(() => undefined);
  }
  for (const principalId of createdPrincipalIds) {
    await database(`principals?id=eq.${principalId}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    }).catch(() => undefined);
  }
}
