import { z } from "zod";
import { AppError } from "./core";

const errorSchema = z.object({
  message: z.string().optional(),
  details: z.string().nullable().optional(),
  hint: z.string().nullable().optional(),
  code: z.string().optional(),
});

export class DataApi {
  constructor(private readonly env: Env) {}

  async request<T>(
    path: string,
    schema: z.ZodType<T>,
    init: RequestInit = {},
  ): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("apikey", this.env.SUPABASE_SECRET_KEY);
    headers.set("Content-Type", "application/json");
    headers.set("Accept", "application/json");

    const response = await fetch(`${this.env.SUPABASE_URL}${path}`, { ...init, headers });
    if (!response.ok) {
      const raw: unknown = await response.json().catch(() => ({}));
      const parsed = errorSchema.safeParse(raw);
      const message = parsed.success ? parsed.data.message ?? response.statusText : response.statusText;
      const code = parsed.success ? parsed.data.code ?? "database_error" : "database_error";
      const status = code === "P0002" ? 404 : code === "42501" ? 403 : code === "23505" ? 409 : 400;
      throw new AppError(message || "Database request failed", status, code);
    }
    if (response.status === 204) return schema.parse(undefined);
    return schema.parse(await response.json());
  }

  rpc<T>(name: string, body: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
    return this.request(`/rest/v1/rpc/${name}`, schema, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  select<T>(query: string, schema: z.ZodType<T>): Promise<T> {
    return this.request(`/rest/v1/${query}`, schema);
  }

  mutate<T>(
    query: string,
    method: "POST" | "PATCH" | "DELETE",
    body: unknown,
    schema: z.ZodType<T>,
    prefer = "return=representation",
  ): Promise<T> {
    return this.request(`/rest/v1/${query}`, schema, {
      method,
      headers: { Prefer: prefer },
      body: JSON.stringify(body),
    });
  }
}
