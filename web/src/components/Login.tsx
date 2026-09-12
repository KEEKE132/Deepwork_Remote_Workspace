import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

interface LoginProps {
  client: SupabaseClient;
}

export function Login({ client }: LoginProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: signInError } = await client.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (signInError) setError(signInError.message);
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="brand-mark" aria-hidden="true">A</div>
        <p className="eyebrow">Agent Message Bus & Relay</p>
        <h1>AMBR에 로그인</h1>
        <p className="login-copy">에이전트와 사람의 대화를 관리하는 안전한 운영 콘솔입니다.</p>
        <form onSubmit={submit} className="login-form">
          <label>
            관리자 이메일
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
              autoFocus
            />
          </label>
          <label>
            비밀번호
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? "로그인 중…" : "로그인"}
          </button>
        </form>
      </section>
    </main>
  );
}
