import { z } from "zod";
import { authenticateAgentToken } from "./auth";
import { AppError, json, sha256Hex } from "./core";
import { DataApi } from "./data-api";

const TOKEN_PAGE_COOKIE = "__Host-AMBR_OAUTH_CSRF";
const AUTHORIZATION_CODE_LIFETIME_MS = 5 * 60 * 1000;
const MAX_CLIENT_ID_LENGTH = 16_384;

const registeredClientSchema = z.object({
  version: z.literal(1),
  redirectUris: z.array(z.string().min(1).max(2048)).min(1).max(10),
  clientName: z.string().min(1).max(100).optional(),
  issuedAt: z.number().int().nonnegative(),
});
type RegisteredClient = z.infer<typeof registeredClientSchema>;

const registrationRequestSchema = z
  .object({
    redirect_uris: z.array(z.string().min(1).max(2048)).min(1).max(10),
    token_endpoint_auth_method: z.literal("none").optional(),
    grant_types: z.array(z.string()).max(10).optional(),
    response_types: z.array(z.string()).max(10).optional(),
    client_name: z.string().trim().min(1).max(100).optional(),
  })
  .passthrough();

const authorizationRequestSchema = z.object({
  client_id: z.string().min(1).max(MAX_CLIENT_ID_LENGTH),
  redirect_uri: z.string().min(1).max(2048),
  response_type: z.literal("code"),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  code_challenge_method: z.literal("S256"),
  state: z.string().max(2048).optional(),
  resource: z.string().min(1).max(2048),
  scope: z.string().max(512).optional(),
});
type AuthorizationRequest = z.infer<typeof authorizationRequestSchema>;

const tokenRequestSchema = z.object({
  grant_type: z.literal("authorization_code"),
  code: z.string().min(1).max(512),
  code_verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/u),
  client_id: z.string().min(1).max(MAX_CLIENT_ID_LENGTH),
  redirect_uri: z.string().min(1).max(2048),
  resource: z.string().min(1).max(2048),
});

const consumedCodeSchema = z
  .object({
    encryptedToken: z.string().min(1).max(2048),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .nullable();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

function oauthKeyBytes(secret: string): Uint8Array<ArrayBuffer> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = base64UrlToBytes(secret.trim());
  } catch {
    throw new AppError("AMBR OAuth 암호화 키 형식이 올바르지 않습니다.", 503, "not_configured");
  }
  if (bytes.byteLength !== 32) {
    throw new AppError("AMBR OAuth 암호화 키가 설정되지 않았습니다.", 503, "not_configured");
  }
  return bytes;
}

async function deriveKey(
  secret: string,
  label: string,
  algorithm: HmacKeyGenParams | AesKeyGenParams,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", oauthKeyBytes(secret), "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32),
      info: new TextEncoder().encode(label),
    },
    material,
    algorithm,
    false,
    usages,
  );
}

async function hmac(secret: string, value: string): Promise<Uint8Array<ArrayBuffer>> {
  const key = await deriveKey(
    secret,
    "ambr-oauth-client-signing-v1",
    { name: "HMAC", hash: "SHA-256", length: 256 },
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

async function constantTimeEqual(first: Uint8Array, second: Uint8Array): Promise<boolean> {
  const [firstHash, secondHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", new Uint8Array(first)),
    crypto.subtle.digest("SHA-256", new Uint8Array(second)),
  ]);
  const left = new Uint8Array(firstHash);
  const right = new Uint8Array(secondHash);
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

export async function createRegisteredClientId(
  oauthKey: string,
  client: Omit<RegisteredClient, "version" | "issuedAt">,
  issuedAt = Math.floor(Date.now() / 1000),
): Promise<string> {
  const payload = bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify({ version: 1, issuedAt, ...client })),
  );
  const signature = bytesToBase64Url(await hmac(oauthKey, payload));
  return `ambr_dcr_${payload}.${signature}`;
}

export async function readRegisteredClient(
  oauthKey: string,
  clientId: string,
): Promise<RegisteredClient | null> {
  if (!clientId.startsWith("ambr_dcr_") || clientId.length > MAX_CLIENT_ID_LENGTH) return null;
  const encoded = clientId.slice("ambr_dcr_".length);
  const separator = encoded.lastIndexOf(".");
  if (separator <= 0) return null;
  const payload = encoded.slice(0, separator);
  const signature = encoded.slice(separator + 1);
  try {
    const valid = await constantTimeEqual(base64UrlToBytes(signature), await hmac(oauthKey, payload));
    if (!valid) return null;
    return registeredClientSchema.parse(
      JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload))),
    );
  } catch {
    return null;
  }
}

export async function encryptOAuthToken(oauthKey: string, token: string): Promise<string> {
  const key = await deriveKey(
    oauthKey,
    "ambr-oauth-code-encryption-v1",
    { name: "AES-GCM", length: 256 },
    ["encrypt"],
  );
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(token)),
  );
  const packed = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  packed.set(iv);
  packed.set(ciphertext, iv.byteLength);
  return bytesToBase64Url(packed);
}

export async function decryptOAuthToken(oauthKey: string, encryptedToken: string): Promise<string> {
  const packed = base64UrlToBytes(encryptedToken);
  if (packed.byteLength <= 28) throw new AppError("승인 코드가 올바르지 않습니다.", 400, "invalid_grant");
  const key = await deriveKey(
    oauthKey,
    "ambr-oauth-code-encryption-v1",
    { name: "AES-GCM", length: 256 },
    ["decrypt"],
  );
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: packed.slice(0, 12) },
      key,
      packed.slice(12),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new AppError("승인 코드가 올바르지 않습니다.", 400, "invalid_grant");
  }
}

export async function createPkceChallenge(verifier: string): Promise<string> {
  return bytesToBase64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
  );
}

function validRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.hash || url.username || url.password) return false;
    if (url.protocol === "https:") return true;
    return (
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]")
    );
  } catch {
    return false;
  }
}

function redirectUriMatches(requested: string, registered: string): boolean {
  if (requested === registered) return true;
  try {
    const requestUrl = new URL(requested);
    const registeredUrl = new URL(registered);
    const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
    return (
      loopbackHosts.has(requestUrl.hostname) &&
      requestUrl.protocol === registeredUrl.protocol &&
      requestUrl.hostname === registeredUrl.hostname &&
      requestUrl.pathname === registeredUrl.pathname &&
      requestUrl.search === registeredUrl.search
    );
  } catch {
    return false;
  }
}

function canonicalResource(origin: string): string {
  return `${origin}/mcp`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formField(name: string, value: string | undefined): string {
  return value === undefined
    ? ""
    : `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;
}

function securityHeaders(cookie?: string): Headers {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Security-Policy": [
      "default-src 'none'",
      "style-src 'unsafe-inline'",
      "img-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
    ].join("; "),
    "Content-Type": "text/html; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
  if (cookie) headers.set("Set-Cookie", cookie);
  return headers;
}

function csrfCookie(value: string, clear = false): string {
  return `${TOKEN_PAGE_COOKIE}=${clear ? "" : value}; HttpOnly; Secure; SameSite=Lax; Path=/oauth/authorize; Max-Age=${clear ? 0 : 600}`;
}

function cookieValue(request: Request, name: string): string | null {
  const cookies = request.headers.get("Cookie")?.split(";") ?? [];
  for (const cookie of cookies) {
    const [key, ...rest] = cookie.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

function authorizationPage(
  params: AuthorizationRequest,
  client: RegisteredClient,
  csrfToken: string,
  error?: string,
): Response {
  const clientName = escapeHtml(client.clientName ?? "Codex");
  const errorMarkup = error ? `<div class="error" role="alert">${escapeHtml(error)}</div>` : "";
  const html = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AMBR 연결</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #241f3d; background: #f6f3ee; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    main { width: min(100%, 460px); background: #fff; border: 1px solid #ded8ec; border-radius: 24px; padding: 30px; box-shadow: 0 18px 55px rgba(61, 47, 109, .12); }
    .brand { display: flex; align-items: center; gap: 12px; margin-bottom: 26px; }
    .mark { width: 44px; height: 44px; border-radius: 14px; display: grid; place-items: center; color: white; font-weight: 800; background: linear-gradient(145deg, #7768ef, #5546c9); }
    .eyebrow { margin: 0; font-size: 12px; letter-spacing: .12em; font-weight: 750; color: #71678f; }
    h1 { margin: 3px 0 0; font-size: 25px; line-height: 1.2; }
    p { color: #655e79; line-height: 1.6; }
    label { display: block; margin: 24px 0 8px; font-size: 14px; font-weight: 700; }
    input[type=password] { width: 100%; min-height: 48px; border: 1px solid #cfc7df; border-radius: 12px; padding: 0 14px; font: inherit; }
    input[type=password]:focus { outline: 3px solid rgba(109, 94, 245, .18); border-color: #6d5ef5; }
    button { width: 100%; min-height: 48px; margin-top: 14px; border: 0; border-radius: 12px; color: #fff; background: #6657e5; font: inherit; font-weight: 750; cursor: pointer; }
    .error { margin-top: 18px; padding: 12px 14px; border-radius: 10px; color: #962f28; background: #fff0ed; font-size: 14px; }
    .note { margin: 18px 0 0; font-size: 12px; color: #7c748e; }
    code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
  </style>
</head>
<body>
  <main>
    <div class="brand"><div class="mark">A</div><div><p class="eyebrow">AGENT MESSAGE BUS &amp; RELAY</p><h1>AMBR 연결</h1></div></div>
    <p><strong>${clientName}</strong>에서 이 에이전트의 AMBR 메시지에 접근하도록 연결합니다.</p>
    ${errorMarkup}
    <form method="post" action="/oauth/authorize" autocomplete="off">
      ${formField("client_id", params.client_id)}
      ${formField("redirect_uri", params.redirect_uri)}
      ${formField("response_type", params.response_type)}
      ${formField("code_challenge", params.code_challenge)}
      ${formField("code_challenge_method", params.code_challenge_method)}
      ${formField("state", params.state)}
      ${formField("resource", params.resource)}
      ${formField("scope", params.scope)}
      ${formField("csrf_token", csrfToken)}
      <label for="ambr_token">에이전트 토큰</label>
      <input id="ambr_token" name="ambr_token" type="password" required maxlength="512" spellcheck="false" autofocus placeholder="ambr_…">
      <button type="submit">AMBR 연결하기</button>
    </form>
    <p class="note">토큰은 주소나 로그에 넣지 않습니다. 검증 후 5분짜리 1회용 승인 코드로 교환됩니다.</p>
  </main>
</body>
</html>`;
  return new Response(html, { headers: securityHeaders(csrfCookie(csrfToken)) });
}

async function readLimitedText(request: Request, limit: number): Promise<string> {
  const declaredLength = Number(request.headers.get("Content-Length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    throw new AppError("요청 본문이 너무 큽니다.", 413, "invalid_request");
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let result = "";
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new AppError("요청 본문이 너무 큽니다.", 413, "invalid_request");
    }
    result += decoder.decode(value, { stream: true });
  }
  return result + decoder.decode();
}

function oauthJson(data: unknown, status = 200): Response {
  const headers = {
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Origin": "*",
    Pragma: "no-cache",
  };
  return status === 204 ? new Response(null, { status, headers }) : json(data, status, headers);
}

function oauthError(code: string, description: string, status = 400): Response {
  return oauthJson({ error: code, error_description: description }, status);
}

function redirectOAuthError(
  redirectUri: string,
  state: string | undefined,
  code: string,
  description: string,
): Response {
  const target = new URL(redirectUri);
  target.searchParams.set("error", code);
  target.searchParams.set("error_description", description);
  if (state) target.searchParams.set("state", state);
  return new Response(null, { status: 302, headers: { Location: target.href, "Cache-Control": "no-store" } });
}

function oauthMetadata(origin: string): Record<string, unknown> {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["ambr"],
    authorization_response_iss_parameter_supported: true,
    resource_indicators_supported: true,
  };
}

function protectedResourceMetadata(origin: string): Record<string, unknown> {
  return {
    resource: canonicalResource(origin),
    authorization_servers: [origin],
    scopes_supported: ["ambr"],
    bearer_methods_supported: ["header"],
    resource_name: "AMBR Messenger",
  };
}

async function handleRegistration(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS") return oauthJson(null, 204);
  if (request.method !== "POST") return oauthError("invalid_request", "POST 요청만 허용됩니다.", 405);
  let input: z.infer<typeof registrationRequestSchema>;
  try {
    input = registrationRequestSchema.parse(JSON.parse(await readLimitedText(request, 64 * 1024)));
  } catch (error) {
    if (error instanceof AppError) return oauthError(error.code, error.message, error.status);
    return oauthError("invalid_client_metadata", "클라이언트 등록 정보를 확인해주세요.");
  }
  if (!input.redirect_uris.every(validRedirectUri)) {
    return oauthError("invalid_redirect_uri", "HTTPS 또는 로컬 콜백 주소만 사용할 수 있습니다.");
  }
  if (input.grant_types && !input.grant_types.includes("authorization_code")) {
    return oauthError("invalid_client_metadata", "authorization_code grant가 필요합니다.");
  }
  if (input.response_types && !input.response_types.includes("code")) {
    return oauthError("invalid_client_metadata", "code response type이 필요합니다.");
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const clientId = await createRegisteredClientId(
    env.AMBR_OAUTH_KEY,
    { redirectUris: input.redirect_uris, clientName: input.client_name },
    issuedAt,
  );
  return oauthJson(
    {
      client_id: clientId,
      client_id_issued_at: issuedAt,
      redirect_uris: input.redirect_uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
      client_name: input.client_name,
    },
    201,
  );
}

async function parseAuthorizationRequest(request: Request): Promise<{
  params: AuthorizationRequest;
  form: URLSearchParams;
}> {
  const form =
    request.method === "POST"
      ? new URLSearchParams(await readLimitedText(request, 16 * 1024))
      : new URL(request.url).searchParams;
  return { params: authorizationRequestSchema.parse(Object.fromEntries(form)), form };
}

async function handleAuthorization(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") {
    return oauthError("invalid_request", "GET 또는 POST 요청만 허용됩니다.", 405);
  }

  let parsed: Awaited<ReturnType<typeof parseAuthorizationRequest>>;
  try {
    parsed = await parseAuthorizationRequest(request);
  } catch (error) {
    if (error instanceof AppError) return oauthError(error.code, error.message, error.status);
    return oauthError("invalid_request", "OAuth 요청 정보를 확인해주세요.");
  }
  const { params, form } = parsed;
  const client = await readRegisteredClient(env.AMBR_OAUTH_KEY, params.client_id);
  if (!client) return oauthError("invalid_client", "등록되지 않은 OAuth 클라이언트입니다.");
  if (!client.redirectUris.some((registered) => redirectUriMatches(params.redirect_uri, registered))) {
    return oauthError("invalid_request", "등록되지 않은 콜백 주소입니다.");
  }
  if (!validRedirectUri(params.redirect_uri)) {
    return oauthError("invalid_request", "콜백 주소가 안전하지 않습니다.");
  }
  const origin = new URL(request.url).origin;
  if (params.resource !== canonicalResource(origin)) {
    return redirectOAuthError(
      params.redirect_uri,
      params.state,
      "invalid_target",
      "AMBR MCP resource 주소가 일치하지 않습니다.",
    );
  }
  if (params.scope && params.scope.split(" ").some((scope) => scope !== "ambr")) {
    return redirectOAuthError(params.redirect_uri, params.state, "invalid_scope", "지원하지 않는 scope입니다.");
  }

  if (request.method === "GET") {
    return authorizationPage(params, client, randomBase64Url(32));
  }

  const csrfFromForm = form.get("csrf_token");
  const csrfFromCookie = cookieValue(request, TOKEN_PAGE_COOKIE);
  if (
    !csrfFromForm ||
    !csrfFromCookie ||
    !(await constantTimeEqual(new TextEncoder().encode(csrfFromForm), new TextEncoder().encode(csrfFromCookie)))
  ) {
    return oauthError("invalid_request", "인증 화면이 만료되었습니다. 연결을 다시 시작해주세요.");
  }

  const token = form.get("ambr_token")?.trim() ?? "";
  if (!/^ambr_[A-Za-z0-9_-]{64}$/u.test(token)) {
    return authorizationPage(params, client, csrfFromForm, "AMBR 토큰 형식을 확인해주세요.");
  }
  const actor = await authenticateAgentToken(env, token);
  if (!actor) {
    return authorizationPage(params, client, csrfFromForm, "토큰이 만료되었거나 비활성화되었습니다.");
  }

  const code = randomBase64Url(48);
  const expiresAt = new Date(Date.now() + AUTHORIZATION_CODE_LIFETIME_MS).toISOString();
  await new DataApi(env).mutate(
    "oauth_authorization_codes",
    "POST",
    {
      code_hash: await sha256Hex(code),
      client_id: params.client_id,
      redirect_uri: params.redirect_uri,
      code_challenge: params.code_challenge,
      resource: params.resource,
      encrypted_token: await encryptOAuthToken(env.AMBR_OAUTH_KEY, token),
      expires_at: expiresAt,
    },
    z.array(z.object({ code_hash: z.string() })).length(1),
  );

  const target = new URL(params.redirect_uri);
  target.searchParams.set("code", code);
  if (params.state) target.searchParams.set("state", params.state);
  target.searchParams.set("iss", origin);
  return new Response(null, {
    status: 302,
    headers: {
      "Cache-Control": "no-store",
      Location: target.href,
      "Set-Cookie": csrfCookie("", true),
    },
  });
}

async function handleToken(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS") return oauthJson(null, 204);
  if (request.method !== "POST") return oauthError("invalid_request", "POST 요청만 허용됩니다.", 405);
  let input: z.infer<typeof tokenRequestSchema>;
  try {
    input = tokenRequestSchema.parse(
      Object.fromEntries(new URLSearchParams(await readLimitedText(request, 32 * 1024))),
    );
  } catch (error) {
    if (error instanceof AppError) return oauthError(error.code, error.message, error.status);
    return oauthError("invalid_request", "토큰 교환 요청을 확인해주세요.");
  }

  const client = await readRegisteredClient(env.AMBR_OAUTH_KEY, input.client_id);
  if (!client || !client.redirectUris.some((registered) => redirectUriMatches(input.redirect_uri, registered))) {
    return oauthError("invalid_client", "등록되지 않은 OAuth 클라이언트입니다.", 401);
  }
  const origin = new URL(request.url).origin;
  if (input.resource !== canonicalResource(origin)) {
    return oauthError("invalid_target", "AMBR MCP resource 주소가 일치하지 않습니다.");
  }

  const challenge = await createPkceChallenge(input.code_verifier);
  const consumed = await new DataApi(env).rpc(
    "ambr_consume_oauth_code",
    {
      p_code_hash: await sha256Hex(input.code),
      p_client_id: input.client_id,
      p_redirect_uri: input.redirect_uri,
      p_code_challenge: challenge,
      p_resource: input.resource,
    },
    consumedCodeSchema,
  );
  if (!consumed) return oauthError("invalid_grant", "승인 코드가 만료되었거나 이미 사용되었습니다.");

  const token = await decryptOAuthToken(env.AMBR_OAUTH_KEY, consumed.encryptedToken);
  if (!(await authenticateAgentToken(env, token))) {
    return oauthError("invalid_grant", "AMBR 토큰이 더 이상 유효하지 않습니다.");
  }
  return oauthJson({ access_token: token, token_type: "Bearer", scope: "ambr" });
}

export async function handleOAuth(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (
    request.method === "GET" &&
    (url.pathname === "/.well-known/oauth-protected-resource" ||
      url.pathname === "/.well-known/oauth-protected-resource/mcp")
  ) {
    return json(protectedResourceMetadata(url.origin));
  }
  if (request.method === "GET" && url.pathname === "/.well-known/oauth-authorization-server") {
    return json(oauthMetadata(url.origin));
  }
  if (url.pathname === "/oauth/register") return handleRegistration(request, env);
  if (url.pathname === "/oauth/authorize") return handleAuthorization(request, env);
  if (url.pathname === "/oauth/token") return handleToken(request, env);
  return null;
}
