import type { Env } from "./env";
import {
  createToken,
  deleteDoc,
  getDoc,
  listDocs,
  listTokens,
  normalizeSlug,
  putDoc,
  revokeTokenByHash,
  updateDoc,
} from "./store";

const ok = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
const fail = (message: string, status = 400) => ok({ error: message }, status);

/** /admin 페이지 및 JSON API (관리자 키 Bearer 인증) */
export async function handleWeb(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  const adminKey = env.ADMIN_KEY;
  // 인증 자격: Authorization: Bearer 헤더 또는 admin_key 쿠키 (로그인 폼 발급)
  const authed = (() => {
    if (!adminKey) return false;
    const authz = request.headers.get("Authorization");
    if (authz === `Bearer ${adminKey}`) return true;
    const cookies = (request.headers.get("Cookie") || "").split(";").map((c) => c.trim());
    const cookieKey = cookies.find((c) => c.startsWith("admin_key="));
    return cookieKey !== undefined && cookieKey.slice("admin_key=".length) === adminKey;
  })();

  if (!authed) {
    // 로그인 폼 POST: 관리자 키 확인 후 세션 쿠키 발급
    if (request.method === "POST" && (url.pathname === "/admin" || url.pathname === "/admin/")) {
      try {
        const form = await request.formData();
        const submitted = String(form.get("admin_key") || "");
        if (adminKey && submitted === adminKey) {
          const secure = url.protocol === "https:" ? "; Secure" : "";
          return new Response(null, {
            status: 302,
            headers: {
              Location: `${url.origin}/admin`,
              "Set-Cookie": `admin_key=${adminKey}; Path=/; HttpOnly; SameSite=Strict${secure}`,
            },
          });
        }
      } catch {
        /* 잘못된 폼 본문 — 아래에서 오류 페이지 표시 */
      }
      return html(loginPage(url.origin, true));
    }
    if (request.method === "GET" && (url.pathname === "/admin" || url.pathname === "/admin/")) {
      // 암호 없이 접근 시 HTML 로그인 폼 제공
      return html(loginPage(url.origin));
    }
    return new Response("Unauthorized", { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  }

  // 로그아웃: 쿠키 삭제 후 로그인 페이지로
  if (request.method === "GET" && url.pathname === "/admin/logout") {
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${url.origin}/admin`,
        "Set-Cookie": `admin_key=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`,
      },
    });
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

  if (url.pathname === "/admin/api/docs" && request.method === "POST") {
    try {
      const raw: unknown = await request.json();
      const body = (raw && typeof raw === "object" ? raw : {}) as { title?: unknown; content?: unknown; slug?: unknown };
      if (typeof body.title !== "string" || !body.title.trim()) return fail("title이 필요합니다.");
      if (typeof body.content !== "string") return fail("content가 필요합니다.");
      const finalSlug = typeof body.slug === "string" && body.slug.trim() ? normalizeSlug(body.slug) : normalizeSlug(body.title);
      const record = await putDoc(env, finalSlug, body.title, body.content);
      return ok({ doc: record }, 201);
    } catch {
      return fail("잘못된 요청 본문입니다.", 400);
    }
  }

  const docPrefix = "/admin/api/docs/";
  if (url.pathname.startsWith(docPrefix)) {
    const slugRaw = decodeURIComponent(url.pathname.slice(docPrefix.length));
    if (!slugRaw || slugRaw.includes("/")) return fail("잘못된 slug입니다.", 400);
    const slug = normalizeSlug(slugRaw);
    if (request.method === "PUT") {
      try {
        const raw: unknown = await request.json();
        const body = (raw && typeof raw === "object" ? raw : {}) as { title?: unknown; content?: unknown };
        if (typeof body.title !== "string" || !body.title.trim()) return fail("title이 필요합니다.");
        if (typeof body.content !== "string") return fail("content가 필요합니다.");
        const updated = await updateDoc(env, slug, body.title, body.content);
        if (!updated) return fail("문서를 찾을 수 없습니다.", 404);
        return ok({ doc: updated, updated: true });
      } catch {
        return fail("잘못된 요청 본문입니다.", 400);
      }
    }
    if (request.method === "DELETE") {
      const deleted = await deleteDoc(env, slug);
      if (!deleted) return fail("문서를 찾을 수 없습니다.", 404);
      return ok({ deleted: true, slug });
    }
    if (request.method === "GET") {
      const doc = await getDoc(env, slug);
      if (!doc) return fail("문서를 찾을 수 없습니다.", 404);
      return ok({ doc });
    }
    return fail("Method Not Allowed", 405);
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

function loginPage(origin: string, error = false): string {
  return `<html lang="ko"><head><meta charset="utf-8"><title>Deepwork Remote Workspace - Admin</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:light dark}
body{font-family:system-ui,sans-serif;max-width:560px;margin:80px auto;padding:0 16px}
h1{margin:0 0 4px}p{color:#666;margin:0 0 24px}
form{display:flex;flex-direction:column;gap:8px}
input{padding:10px 12px;border:1px solid #999;border-radius:8px}
button{padding:10px 14px;background:#0b6;color:#fff;border:none;border-radius:8px;cursor:pointer}
.error{color:#a33;margin:0 0 16px}
</style></head><body>
<h1>Deepwork Remote Workspace</h1>
<p>MCP 토큰 관리 페이지입니다. 관리자 키를 입력하세요.</p>
${error ? '<p class="error">관리자 키가 올바르지 않습니다. 다시 입력하세요.</p>' : ''}
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
button,select,input,textarea{padding:8px 12px;border-radius:8px;border:1px solid #999;background:transparent}
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
<p class="sub"><span class="muted">MCP 서버:</span> <code>${origin}/mcp</code> · <a href="${origin}/admin/logout">로그아웃</a></p>

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

<section><h2>문서 관리</h2>
<p class="muted">지식 문서를 새로 만들거나 기존 문서를 수정·삭제합니다. (MCP 도구와 동일한 저장소를 공유합니다)</p>
<form id="docForm">
  <label>제목 <input name="title" required maxlength="200" placeholder="문서 제목"></label>
  <label>슬러그 <input name="slug" maxlength="200" placeholder="비우면 제목에서 자동 생성 (수정 시에는 사용)"></label>
  <label>본문 <textarea name="content" rows="8" placeholder="마크다운 본문"></textarea></label>
  <div>
    <button type="submit" class="primary" id="docSubmit">저장</button>
    <button type="button" id="docReset" hidden>새 문서 작성</button>
  </div>
</form>
<table id="docs"><thead><tr><th>슬러그</th><th>제목</th><th>수정 시각</th><th>작업</th></tr></thead><tbody></tbody></table>
</section>

<section><h2>에이전트 간 메시지 (A2A 메신저 허브)</h2>
<p class="muted">이 워크스페이스는 다른 사람·다른 컴퓨터의 에이전트가 <strong>카카오톡처럼 대화</strong>하는 중앙 허브로도 동작합니다. 발급된 MCP 토큰을 그대로 사용합니다.</p>
<ul>
  <li><strong>에이전트 카드</strong> (발견용, 인증 불필요): <code>${origin}/.well-known/agent-card.json</code></li>
  <li><strong>A2A 엔드포인트</strong> (JSON-RPC, Bearer): <code>${origin}/a2a</code></li>
  <li><strong>보내기</strong>: <code>sendMessage</code> 호출 시 메시지 <code>metadata.to</code>에 받을 에이전트 라벨을 지정. 대화 스레드는 <code>contextId</code>로 유지.</li>
  <li><strong>받기</strong>: <code>ListTasks</code> 폴링으로 내 사서함의 새 메시지를 확인·<code>GetTask</code>로 읽고, 읽은 뒤 삭제하면 소비(휘발)됩니다. 대화는 지식 문서(docs)에 저장되지 않습니다.</li>
</ul>
</section>

<script>
const api = async (path, init) => {
  const r = await fetch(path, {...init, credentials: 'same-origin', headers: {'Content-Type':'application/json'}});
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

// ---- 문서 관리 ----
let editingSlug = null;
const docForm = document.querySelector('#docForm');
const docSubmit = document.querySelector('#docSubmit');
const docReset = document.querySelector('#docReset');
async function refreshDocs() {
  const { docs } = await api('/admin/api/docs');
  const tb = document.querySelector('#docs tbody');
  tb.innerHTML = '';
  for (const d of docs) {
    const tr = document.createElement('tr');
    const slug = escapeHtml(d.slug);
    tr.innerHTML = '<td class="token">' + slug + '</td><td>' + escapeHtml(d.title) + '</td><td class="muted">' + (d.updatedAt ? fmt(d.updatedAt) : '—') + '</td><td><button data-edit="' + slug + '">수정</button> <button data-del="' + slug + '">삭제</button></td>';
    tb.appendChild(tr);
  }
  document.querySelectorAll('button[data-edit]').forEach(b => b.onclick = () => editDoc(b.dataset.edit));
  document.querySelectorAll('button[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('문서를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return;
    await api('/admin/api/docs/' + encodeURIComponent(b.dataset.del), {method:'DELETE'});
    if (editingSlug === b.dataset.del) resetDocForm();
    refreshDocs();
  });
}
function editDoc(slug) {
  editingSlug = slug;
  docForm.querySelector('input[name=slug]').value = slug;
  docForm.querySelector('input[name=slug]').disabled = true;
  docSubmit.textContent = '수정 저장';
  docReset.hidden = false;
  fetch('/admin/api/docs/' + encodeURIComponent(slug), {credentials: 'same-origin'})
    .then(r => { if (!r.ok) throw new Error('불러오기 실패'); return r.json(); })
    .then(j => { docForm.querySelector('input[name=title]').value = j.doc.title; docForm.querySelector('textarea[name=content]').value = j.doc.content; })
    .catch(err => alert(err.message));
}
function resetDocForm() {
  editingSlug = null;
  docForm.reset();
  docForm.querySelector('input[name=slug]').disabled = false;
  docSubmit.textContent = '저장';
  docReset.hidden = true;
}
docReset.onclick = resetDocForm;
docForm.onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(docForm);
  const title = f.get('title'); const content = f.get('content'); const slug = f.get('slug');
  const body = {title, content}; if (slug) body.slug = slug;
  try {
    if (editingSlug) {
      await api('/admin/api/docs/' + encodeURIComponent(editingSlug), {method:'PUT', body: JSON.stringify(body)});
    } else {
      await api('/admin/api/docs', {method:'POST', body: JSON.stringify(body)});
    }
    resetDocForm();
    refreshDocs();
  } catch(err) { alert(err.message); }
};
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
refreshDocs();
</script>
</body></html>`;
}