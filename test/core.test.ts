import { describe, expect, it } from "vitest";
import {
  decodeCursor,
  encodeCursor,
  generateToken,
  parseBearerToken,
  sendMessageSchema,
  sha256Hex,
} from "../src/core";
import {
  createPkceChallenge,
  createRegisteredClientId,
  decryptOAuthToken,
  encryptOAuthToken,
  readRegisteredClient,
} from "../src/oauth";

describe("AMBR bearer authentication", () => {
  it("accepts only an Authorization Bearer token", () => {
    expect(parseBearerToken(new Request("https://ambr.test/mcp", {
      headers: { Authorization: "Bearer ambr_secret" },
    }))).toBe("ambr_secret");
    expect(parseBearerToken(new Request("https://ambr.test/mcp?token=legacy"))).toBeNull();
    expect(parseBearerToken(new Request("https://ambr.test/mcp", {
      headers: { Authorization: "Basic legacy" },
    }))).toBeNull();
  });

  it("hashes credentials deterministically without storing raw values", async () => {
    expect(await sha256Hex("ambr-secret")).toBe(
      "1cf42340f6b9685d5366c302a72824d5a158979686ef29bad8ade02ae373fefa",
    );
  });

  it("creates high-entropy prefixed tokens", () => {
    const first = generateToken();
    const second = generateToken();
    expect(first).toMatch(/^ambr_[A-Za-z0-9_-]{64}$/u);
    expect(second).not.toBe(first);
  });
});

describe("AMBR cursor and message validation", () => {
  it("round-trips an opaque cursor and rejects tampering", () => {
    const value = { at: "2026-09-12T00:00:00.000Z", id: "b7e59417-c570-4dce-9a0a-a5590796da16" };
    expect(decodeCursor(encodeCursor(value))).toEqual(value);
    expect(() => decodeCursor("not-a-cursor")).toThrow("유효하지 않은 페이지 커서");
  });

  it("requires exactly one message target", () => {
    const valid = {
      to: "research-agent",
      text: "진행 상황을 알려줘",
      clientMessageId: "b7e59417-c570-4dce-9a0a-a5590796da16",
    };
    expect(sendMessageSchema.parse(valid).to).toBe("research-agent");
    expect(() => sendMessageSchema.parse({ text: "대상 없음" })).toThrow();
    expect(() => sendMessageSchema.parse({
      ...valid,
      conversationId: "e12a8292-3ac4-4a9c-89d0-31d89f0b20dc",
    })).toThrow();
  });
});

describe("AMBR browser OAuth", () => {
  const oauthKey = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY";

  it("signs stateless dynamic client registrations and detects tampering", async () => {
    const clientId = await createRegisteredClientId(oauthKey, {
      redirectUris: ["http://127.0.0.1:43210/callback/ambr"],
      clientName: "Codex",
    });
    await expect(readRegisteredClient(oauthKey, clientId)).resolves.toMatchObject({
      redirectUris: ["http://127.0.0.1:43210/callback/ambr"],
      clientName: "Codex",
    });
    await expect(readRegisteredClient(oauthKey, `${clientId}x`)).resolves.toBeNull();
  });

  it("encrypts a raw AMBR token inside a short-lived authorization code record", async () => {
    const token = `ambr_${"a".repeat(64)}`;
    const encrypted = await encryptOAuthToken(oauthKey, token);
    expect(encrypted).not.toContain(token);
    await expect(decryptOAuthToken(oauthKey, encrypted)).resolves.toBe(token);
  });

  it("derives an OAuth S256 PKCE challenge", async () => {
    await expect(
      createPkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    ).resolves.toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});
