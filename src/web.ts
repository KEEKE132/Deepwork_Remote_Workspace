import type { Env } from "./env";
import { createToken, listDocs, listTokens, revokeTokenByHash } from "./store";

const ok = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
const fail = (message: string, status = 400) => ok({ error: message }, status);

/** /admin 페이지 및 JSON API (관리자 키 Bearer 인증) */
export async function handleWeb(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  // 관리자 키 확인
  const adminKey = env.ADMIN_KEY;
  const authz = request.headers.get("Authorization");
  if (!adminKey || authz !== `Bearer ${adminKey}`) {
    if (request.method === "GET" && (url.pathname === "/admin" || url.pathname === "/admin/")) {
      // 암호 없이 접근 시 HTML 로그인 폼 제공
      return html(loginPage(url.origin));
    }
    return new Response("Unauthorized", { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  }

  // --- JSON API 경로 ---
  if (url.pathname === "/admin/api/tokens") {
    if (request.method === "GET") {
      const records = (await listTokens(env)).map((r) => ({
        hash: r.hash,
        label: r.label,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt ?? null,
        lastUsedAt: r.lastUsedAt ?? null,
        revoked: r.revoked ?? false,
        expired: r.revoked || (r.expiresAt ? new Date(r.expiresAt).getTime() <= Date.now() : false),
      }));
      return ok({ tokens: records });
    }
    if (request.method === "POST") {
      try {
        const raw: unknown = await request.json();
        const body = (raw && typeof raw === "object" ? raw : {}) as { label?: unknown; expiresInDays?: unknown };
        const label = typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 100) : "anonymous";
        const days = typeof body.expiresInDays === "number" ? body.expiresInDays : undefined;
        if (days !== undefined && (days <= 0 || days > 3650)) return fail("expiresInDays는 1~3650 사이여야 합니다.");
        const { token, record } = await createToken(env, label, days);
        return ok(
          {
            token, // 원문 토큰 — 이 요청에서만 노출 (다시 조회 불가)
            record: {
              hash: record.hash,
              label: record.label,
              createdAt: record.createdAt,
              expiresAt: record.expiresAt ?? null,
            },
          },
          201
        );
      } catch {
        return fail("잘못된 요청 본문입니다.", 400);
      }
    }
    return fail("Method Not Allowed", 405);
  }

  if (url.pathname === "/admin/api/tokens/revoke" && request.method === "POST") {
    try {
      const raw: unknown = await request.json();
      const body = (raw && typeof raw === "object" ? raw : {}) as { hash?: unknown };
      if (typeof body.hash !== "string" || !body.hash) return fail("hash가 필요합니다.");
      const okRevoke = await revokeTokenByHash(env, body.hash);
      return ok({ revoked: okRevoke });
    } catch {
      return fail("잘못된 요청 본문입니다.", 400);
    }
  }

  if (url.pathname === "/admin/api/docs" && request.method === "GET") {
    const docs = await listDocs(env);
    return ok({ docs });
  }

  // --- HTML 페이지 ---
  if (url.pathname === "/admin" || url.pathname === "/admin/") {
    return html(adminPage(url.origin));
  }

  return new Response("Not Found", { status: 404 });
}

const html = (body: string, status = 200) =>
  new Response("<!doctype html>" + body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

function loginPage(origin: string): string {
  return `<html lang="ko"><head><meta charset="utf-8"><title>Deepwork Remote Workspace - Admin</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:light dark}
body{font-family:system-ui,sans-serif;max-width:560px;margin:80px auto;padding:0 16px}
h1{margin:0 0 4px}p{color:#666;margin:0 0 24px}
form{display:flex;flex-direction:column;gap:8px}
input{padding:10px 12px;border:1px solid #999;border-radius:8px}
button{padding:10px 14px;background:#0b6;color:#fff;border:none;border-radius:8px;cursor:pointer}
</style></head><body>
<h1>Deepwork Remote Workspace</h1>
<p>MCP 토큰 관리 페이지입니다. 관리자 키를 입력하세요.</p>
<form method="post" action="${origin}/admin">
<input type="password" name="admin_key" placeholder="관리자 키" autofocus required>
<button type="submit">로그인</button>
</form>
</body></html>`;
}

function adminPage(origin: string): string {
  return `<html lang="ko"><head><meta charset="utf-8"><title>Deepwork Remote Workspace - Admin</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:light dark}
body{font-family:system-ui,sans-serif;margin:32px auto;max-width:900px;padding:0 16px}
h1{margin:0 0 8px}p.sub{color:#666;margin:0 0 24px}
button,select,input{padding:8px 12px;border-radius:8px;border:1px solid #999;background:transparent}
button.primary{background:#0b6;color:#fff;border:none;cursor:pointer}
pre{background:#f5f5f5;border:1px solid #ddd;border-radius:8px;padding:12px;overflow-x:auto;white-space:pre-wrap}
.token{font-family:ui-monospace,monospace}
.muted{color:#888;font-size:13px}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid #ddd;padding:8px 12px;text-align:left;font-size:14px}
.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:12px}
.badge.ok{background:#1a6;color:#fff}.badge.revoked{background:#a55;color:#fff}
</style></head><body>
<h1>Deepwork Remote Workspace — 관리자</h1>
<p class="sub"><span class="muted">MCP 서버:</span> <code>${origin}/mcp</code></p>

<section><h2>MCP 토큰 발급</h2>
<p class="muted">발급된 원문 토큰은 <strong>이 화면에서 한 번만 표시</strong>됩니다. 복사해 두세요. (토큰은 해시로만 저장됩니다)</p>
<form id="create">
  <label>라벨(용도) <input name="label" placeholder="예: hackathon-agent / Dev-Mac" required maxlength="100"></label>
  <label>만료 <select name="expiresInDays">
    <option value="7">7일 후</option>
    <option value="30" selected>30일 후</option>
    <option value="90">90일 후</option>
    <option value="">만료 없음</option>
  </select></label>
  <button type="submit" class="primary">발급</button>
</form>
<pre id="created" class="token" hidden></pre>
</section>

<section><h2>발급된 토큰</h2>
<table id="tokens"><thead><tr><th>라벨</th><th>상태</th><th>생성</th><th>만료</th><th>마지막 사용</th><th>작업</th></tr></thead><tbody></tbody></table>
</section>

<script>
const api = async (path, init) => {
  const r = await fetch(path, {...init, headers: {'Content-Type':'application/json'}});
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || '요청 실패');
  return j;
};
const statusOf = (t) => t.revoked ? '<span class="badge revoked">폐기됨</span>' :
  (t.expired ? '<span class="badge revoked">만료</span>' : '<span class="badge ok">활성</span>');
async function refresh() {
  const { tokens } = await api('/admin/api/tokens');
  const tb = document.querySelector('#tokens tbody');
  tb.innerHTML = '';
  for (const t of tokens) {
    const tr = document.createElement('tr');
    const revokeBtn = t.revoked ? '' : \`<button data-hash="\${t.hash}">폐기</button>\`;
    tr.innerHTML = \`
      <td>\${escapeHtml(t.label)}</td>
      <td>\${statusOf(t)}</td>
      <td class="muted">\${fmt(t.createdAt)}</td>
      <td class="muted">\${t.expiresAt ? fmt(t.expiresAt) : '—'}</td>
      <td class="muted">\${t.lastUsedAt ? fmt(t.lastUsedAt) : '—'}</td>
      <td>\${revokeBtn}</td>\`;
    tb.appendChild(tr);
  }
  document.querySelectorAll('button[data-hash]').forEach(b => b.onclick = async () => {
    if (!confirm('토큰을 폐기하시겠습니까?')) return;
    await api('/admin/api/tokens/revoke', {method:'POST', body: JSON.stringify({hash: b.dataset.hash})});
    refresh();
  });
}
const fmt = (iso) => new Date(iso).toLocaleString('ko-KR', {dateStyle:'short', timeStyle:'short'});
const escapeHtml = (s) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
document.querySelector('#create').onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(document.querySelector('#create'));
  const label = f.get('label'); const days = f.get('expiresInDays');
  const body = {label}; if (days) body.expiresInDays = Number(days);
  try {
    const j = await api('/admin/api/tokens', {method:'POST', body: JSON.stringify(body)});
    const pre = document.querySelector('#created');
    pre.hidden = false;
    pre.textContent = \`발급 완료! 이 토큰은 다시 볼 수 없습니다:\n\n\${j.token}\`;
    document.querySelector('#create label input[name=label]').value = '';
    refresh();
  } catch(err) { alert(err.message); }
};
refresh();
</script>
</body></html>`;
}