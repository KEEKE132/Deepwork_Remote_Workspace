import { z } from "zod";

export class AppError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "bad_request",
  ) {
    super(message);
  }
}

export const idSchema = z.string().uuid();
export const cursorSchema = z.string().min(1).max(512);
export const handleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/);
export const prioritySchema = z.enum(["low", "normal", "high", "urgent"]);
export const linkSchema = z.object({
  url: z.string().url().max(2048),
  label: z.string().trim().min(1).max(120).optional(),
});
export const linksSchema = z.array(linkSchema).max(20);

export const sendMessageSchema = z
  .object({
    to: handleSchema.optional(),
    conversationId: idSchema.optional(),
    text: z.string().trim().min(1).max(12000),
    replyToMessageId: idSchema.optional(),
    taskId: z.string().trim().min(1).max(200).optional(),
    priority: prioritySchema.default("normal"),
    links: linksSchema.default([]),
    clientMessageId: idSchema.optional(),
  })
  .superRefine((value, context) => {
    if ((value.to === undefined) === (value.conversationId === undefined)) {
      context.addIssue({
        code: "custom",
        message: "to와 conversationId 중 정확히 하나만 지정해야 합니다.",
      });
    }
  });

export interface PageCursor {
  at: string;
  id: string;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function encodeCursor(cursor: PageCursor): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(cursor)));
}

export function decodeCursor(cursor?: string): PageCursor | null {
  if (!cursor) return null;
  try {
    return z
      .object({ at: z.string().datetime({ offset: true }), id: idSchema })
      .parse(JSON.parse(new TextDecoder().decode(base64UrlToBytes(cursor))));
  } catch {
    throw new AppError("유효하지 않은 페이지 커서입니다.", 400, "invalid_cursor");
  }
}

export function parseBearerToken(request: Request): string | null {
  const authorization = request.headers.get("Authorization");
  if (!authorization) return null;
  const match = /^Bearer ([^\s]+)$/u.exec(authorization);
  return match?.[1] ?? null;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function generateToken(): string {
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  return `ambr_${bytesToBase64Url(bytes)}`;
}

export function json(data: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return Response.json(data, { status, headers });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof z.ZodError) {
    return json(
      { error: "invalid_input", message: "입력값을 확인해주세요.", issues: error.issues },
      400,
    );
  }
  if (error instanceof AppError) {
    return json({ error: error.code, message: error.message }, error.status);
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(JSON.stringify({ event: "request_error", message }));
  return json({ error: "internal_error", message: "요청을 처리하지 못했습니다." }, 500);
}

export function nextCursor<T>(
  items: readonly T[],
  limit: number,
  getCursor: (item: T) => PageCursor,
): string | null {
  if (items.length < limit) return null;
  const last = items.at(-1);
  return last ? encodeCursor(getCursor(last)) : null;
}
