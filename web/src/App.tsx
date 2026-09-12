import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiClient, loadConfig } from "./api";
import { ConversationList } from "./components/ConversationList";
import { Login } from "./components/Login";
import { ManageDialog } from "./components/ManageDialog";
import { MessagePane } from "./components/MessagePane";
import type { Agent, Config, Conversation, Message, Principal } from "./types";

function Loading({ message }: { message: string }) {
  return <main className="loading-screen"><div className="loading-mark">A</div><p>{message}</p></main>;
}

function Console({ client, session }: { client: SupabaseClient; session: Session }) {
  const api = useMemo(() => new ApiClient(session.access_token), [session.access_token]);
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [contacts, setContacts] = useState<Principal[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [directTarget, setDirectTarget] = useState<Principal | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Conversation | null>(null);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId) ?? null,
    [conversations, selectedId],
  );

  const refreshConversations = useCallback(async () => {
    const result = await api.conversations();
    setConversations(result.conversations);
  }, [api]);

  const refreshContacts = useCallback(async () => {
    const result = await api.contacts();
    setContacts(result.contacts);
  }, [api]);

  const refreshAgents = useCallback(async () => {
    const result = await api.agents();
    setAgents(result.agents);
  }, [api]);

  const refreshMessages = useCallback(async (conversationId: string) => {
    const result = await api.messages(conversationId);
    setMessages(result.messages);
    const last = result.messages[0];
    const conversation = conversations.find((item) => item.id === conversationId);
    const canMark = conversation?.members.some((member) => member.id === principal?.id);
    if (last && canMark) await api.markRead(conversationId, last.id);
  }, [api, conversations, principal?.id]);

  useEffect(() => {
    let active = true;
    Promise.all([api.session(), api.contacts(), api.conversations(), api.agents()])
      .then(([sessionResult, contactsResult, conversationResult, agentResult]) => {
        if (!active) return;
        setPrincipal(sessionResult.principal);
        setContacts(contactsResult.contacts);
        setConversations(conversationResult.conversations);
        setAgents(agentResult.agents);
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "초기화에 실패했습니다."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [api]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    void refreshMessages(selectedId).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "메시지를 불러오지 못했습니다."));
  }, [refreshMessages, selectedId]);

  useEffect(() => {
    if (!principal) return;
    const channel = client
      .channel("ambr-admin")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => {
        void refreshConversations();
        if (selectedId) void refreshMessages(selectedId);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => void refreshConversations())
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_members" }, () => {
        void Promise.all([refreshConversations(), refreshContacts()]);
      })
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [client, principal, refreshContacts, refreshConversations, refreshMessages, selectedId]);

  async function send(input: { text: string; taskId?: string; priority: Message["priority"]; replyToMessageId?: string }) {
    setBusy(true);
    setError(null);
    try {
      const result = await api.sendMessage({
        ...(directTarget ? { to: directTarget.handle } : { conversationId: selectedId ?? undefined }),
        ...input,
        clientMessageId: crypto.randomUUID(),
      });
      setDirectTarget(null);
      setSelectedId(result.message.conversationId);
      await Promise.all([refreshConversations(), refreshMessages(result.message.conversationId)]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "메시지를 보내지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function removeMessage(messageId: string) {
    if (!window.confirm("메시지 본문과 메타데이터를 삭제할까요? Tombstone은 보관 만료일까지 남습니다.")) return;
    await api.deleteMessage(messageId);
    if (selectedId) await Promise.all([refreshMessages(selectedId), refreshConversations()]);
  }

  function openConversation(conversation: Conversation) {
    setDirectTarget(null);
    setSelectedId(conversation.id);
  }

  function openDirect(contact: Principal) {
    setSelectedId(null);
    setDirectTarget(contact);
    setMessages([]);
  }

  if (loading) return <Loading message="안전한 관리자 세션을 여는 중…" />;
  if (!principal) return <main className="fatal-screen"><h1>AMBR를 열지 못했습니다</h1><p>{error}</p><button onClick={() => void client.auth.signOut()}>로그아웃</button></main>;

  return (
    <main className={`app-shell ${selectedConversation || directTarget ? "chat-open" : ""}`}>
      <ConversationList
        conversations={conversations}
        contacts={contacts}
        currentPrincipalId={principal.id}
        selectedId={selectedId}
        onSelect={openConversation}
        onDirect={openDirect}
        onManage={() => { setEditingGroup(null); setManageOpen(true); }}
      />
      <MessagePane
        conversation={selectedConversation}
        directTarget={directTarget}
        currentPrincipalId={principal.id}
        messages={messages}
        busy={busy}
        onBack={() => { setSelectedId(null); setDirectTarget(null); }}
        onSend={send}
        onDelete={removeMessage}
        onEditGroup={() => { setEditingGroup(selectedConversation); setManageOpen(true); }}
      />
      <aside className="account-rail">
        <div className="brand-mark small">A</div>
        <div className="rail-spacer" />
        <button className="account-button" onClick={() => void client.auth.signOut()} title={`${session.user.email ?? "관리자"} 로그아웃`}>
          {principal.displayName.slice(0, 1)}
        </button>
      </aside>
      {error ? <div className="toast" role="alert"><span>{error}</span><button onClick={() => setError(null)}>×</button></div> : null}
      <ManageDialog
        open={manageOpen}
        agents={agents}
        contacts={contacts}
        editingGroup={editingGroup}
        onClose={() => { setManageOpen(false); setEditingGroup(null); }}
        onRefreshAgents={refreshAgents}
        onCreateAgent={async (input) => { const result = await api.createAgent(input); await Promise.all([refreshAgents(), refreshContacts()]); return result.token; }}
        onUpdateAgent={async (agentId, input) => { await api.updateAgent(agentId, input); await Promise.all([refreshAgents(), refreshContacts()]); }}
        onIssueToken={async (agentId, days) => { const result = await api.issueToken(agentId, days); await refreshAgents(); return result.token; }}
        onRevoke={async (credentialId) => { await api.revokeCredential(credentialId); await refreshAgents(); }}
        onToggleAgent={async (agent) => { await api.updateAgent(agent.id, { isActive: !agent.isActive }); await Promise.all([refreshAgents(), refreshContacts()]); }}
        onSaveGroup={async (input) => { await api.saveGroup(input); await refreshConversations(); }}
      />
    </main>
  );
}

export default function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const client = useMemo(
    () => config ? createClient(config.supabaseUrl, config.supabasePublishableKey) : null,
    [config],
  );

  useEffect(() => {
    void loadConfig().then(setConfig).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "설정 오류"));
  }, []);

  useEffect(() => {
    if (!client) return;
    void client.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = client.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, [client]);

  if (error) return <main className="fatal-screen"><h1>AMBR 설정 오류</h1><p>{error}</p></main>;
  if (!client || session === undefined) return <Loading message="AMBR를 준비하는 중…" />;
  if (!session) return <Login client={client} />;
  return <Console client={client} session={session} />;
}
