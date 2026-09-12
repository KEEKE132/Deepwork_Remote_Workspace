create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists pg_cron;

create schema if not exists private;
revoke all on schema private from public, anon;

create table public.principals (
  id uuid primary key default gen_random_uuid(),
  handle extensions.citext not null unique,
  display_name text not null,
  kind text not null check (kind in ('human', 'agent')),
  auth_user_id uuid unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint principals_handle_format check (
    handle::text = lower(handle::text)
    and handle::text ~ '^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$'
  ),
  constraint principals_display_name_length check (char_length(display_name) between 1 and 100),
  constraint principals_auth_kind check (auth_user_id is null or kind = 'human')
);

create table public.admin_users (
  email extensions.citext primary key,
  auth_user_id uuid unique,
  principal_id uuid unique references public.principals(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_users_email_format check (position('@' in email::text) > 1)
);

create table public.agent_credentials (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references public.principals(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  constraint agent_credentials_hash_format check (token_hash ~ '^[0-9a-f]{64}$')
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('direct', 'group')),
  name text,
  direct_key text unique,
  created_by uuid not null references public.principals(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversations_shape check (
    (kind = 'direct' and name is null and direct_key is not null)
    or (kind = 'group' and name is not null and direct_key is null)
  ),
  constraint conversations_group_name_length check (name is null or char_length(name) between 1 and 100)
);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  principal_id uuid not null references public.principals(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (conversation_id, principal_id),
  constraint conversation_members_dates check (left_at is null or left_at >= joined_at)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.principals(id),
  body text,
  reply_to_message_id uuid references public.messages(id) on delete set null,
  task_id text,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  links jsonb not null default '[]'::jsonb,
  client_message_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  deleted_at timestamptz,
  deleted_by uuid references public.principals(id) on delete set null,
  unique (sender_id, client_message_id),
  constraint messages_body_state check (
    (deleted_at is null and body is not null and char_length(body) between 1 and 12000)
    or (deleted_at is not null and body is null)
  ),
  constraint messages_links_array check (jsonb_typeof(links) = 'array'),
  constraint messages_expiry check (expires_at > created_at),
  constraint messages_client_id_state check ((deleted_at is null) = (client_message_id is not null)),
  constraint messages_delete_state check ((deleted_at is null) = (deleted_by is null))
);

create table public.conversation_reads (
  conversation_id uuid not null,
  principal_id uuid not null,
  last_read_message_id uuid references public.messages(id) on delete set null,
  read_at timestamptz not null default now(),
  primary key (conversation_id, principal_id),
  foreign key (conversation_id, principal_id)
    references public.conversation_members(conversation_id, principal_id)
    on delete cascade
);

create index agent_credentials_principal_id_idx on public.agent_credentials(principal_id);
create index agent_credentials_active_hash_idx on public.agent_credentials(token_hash)
  where revoked_at is null;
create index principals_active_handle_idx on public.principals(handle)
  where is_active;
create index conversations_updated_idx on public.conversations(updated_at desc, id desc);
create index conversation_members_principal_active_idx
  on public.conversation_members(principal_id, conversation_id)
  where left_at is null;
create index messages_conversation_page_idx
  on public.messages(conversation_id, created_at desc, id desc);
create index messages_expiry_idx on public.messages(expires_at);
create index messages_reply_idx on public.messages(reply_to_message_id)
  where reply_to_message_id is not null;
create index conversation_reads_last_message_idx on public.conversation_reads(last_read_message_id)
  where last_read_message_id is not null;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_users a
    where a.is_active
      and lower(a.email::text) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
  );
$$;

create or replace function private.current_principal_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.principals p
  where p.auth_user_id = (select auth.uid())
    and p.is_active
  limit 1;
$$;

create or replace function private.is_conversation_member(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.conversation_members cm
    join public.principals p on p.id = cm.principal_id
    where cm.conversation_id = p_conversation_id
      and p.auth_user_id = (select auth.uid())
      and p.is_active
      and cm.left_at is null
  );
$$;

create or replace function private.shares_conversation_with(p_other_principal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.conversation_members mine
    join public.principals me on me.id = mine.principal_id
    join public.conversation_members theirs
      on theirs.conversation_id = mine.conversation_id
    where me.auth_user_id = (select auth.uid())
      and me.is_active
      and mine.left_at is null
      and theirs.principal_id = p_other_principal_id
      and theirs.left_at is null
  );
$$;

grant usage on schema private to authenticated;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.current_principal_id() to authenticated;
grant execute on function private.is_conversation_member(uuid) to authenticated;
grant execute on function private.shares_conversation_with(uuid) to authenticated;

alter table public.principals enable row level security;
alter table public.admin_users enable row level security;
alter table public.agent_credentials enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.conversation_reads enable row level security;

revoke all on all tables in schema public from anon, authenticated;
grant select on public.principals, public.admin_users, public.conversations,
  public.conversation_members, public.messages, public.conversation_reads to authenticated;

create policy principals_authenticated_read on public.principals
for select to authenticated
using (
  (select private.is_admin())
  or id = (select private.current_principal_id())
  or (select private.shares_conversation_with(principals.id))
);

create policy admin_users_self_read on public.admin_users
for select to authenticated
using (
  auth_user_id = (select auth.uid())
  or lower(email::text) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
);

create policy conversations_member_read on public.conversations
for select to authenticated
using (
  (select private.is_admin())
  or (select private.is_conversation_member(conversations.id))
);

create policy conversation_members_member_read on public.conversation_members
for select to authenticated
using (
  (select private.is_admin())
  or (select private.is_conversation_member(conversation_members.conversation_id))
);

create policy messages_member_read on public.messages
for select to authenticated
using (
  (select private.is_admin())
  or (select private.is_conversation_member(messages.conversation_id))
);

create policy conversation_reads_member_read on public.conversation_reads
for select to authenticated
using (
  (select private.is_admin())
  or (select private.is_conversation_member(conversation_reads.conversation_id))
);

create or replace function public.ambr_claim_admin(
  p_email text,
  p_auth_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_principal public.principals;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ambr_claim_admin', 0)
  );

  select * into v_principal
  from public.principals
  where auth_user_id = p_auth_user_id
  for update;

  if v_principal.id is not null and v_principal.kind <> 'human' then
    raise exception 'the authenticated user is not a human principal' using errcode = '22023';
  end if;

  if v_principal.id is null then
    insert into public.principals(handle, display_name, kind, auth_user_id)
    values ('admin', 'AMBR Admin', 'human', p_auth_user_id)
    on conflict (handle) do update
      set auth_user_id = excluded.auth_user_id,
          is_active = true,
          updated_at = now()
      where principals.kind = 'human'
    returning * into v_principal;
  else
    update public.principals
    set is_active = true,
        updated_at = now()
    where id = v_principal.id
    returning * into v_principal;
  end if;

  if v_principal.id is null then
    raise exception 'admin handle is already assigned to an agent' using errcode = '23505';
  end if;

  delete from public.admin_users
  where auth_user_id = p_auth_user_id
    and lower(email::text) <> lower(p_email);

  insert into public.admin_users(email, auth_user_id, principal_id)
  values (lower(p_email), p_auth_user_id, v_principal.id)
  on conflict (email) do update
    set auth_user_id = excluded.auth_user_id,
        principal_id = excluded.principal_id,
        is_active = true,
        updated_at = now();

  return jsonb_build_object(
    'id', v_principal.id,
    'handle', v_principal.handle,
    'displayName', v_principal.display_name,
    'kind', v_principal.kind
  );
end;
$$;

create or replace function public.ambr_send_message(
  p_actor_id uuid,
  p_to_handle text default null,
  p_conversation_id uuid default null,
  p_text text default null,
  p_reply_to_message_id uuid default null,
  p_task_id text default null,
  p_priority text default 'normal',
  p_links jsonb default '[]'::jsonb,
  p_client_message_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor public.principals;
  v_recipient public.principals;
  v_conversation public.conversations;
  v_message public.messages;
  v_direct_key text;
begin
  if (p_to_handle is null) = (p_conversation_id is null) then
    raise exception 'exactly one of to or conversationId is required' using errcode = '22023';
  end if;
  if p_text is null or char_length(btrim(p_text)) = 0 or char_length(p_text) > 12000 then
    raise exception 'text must contain 1 to 12000 characters' using errcode = '22023';
  end if;
  if p_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'invalid priority' using errcode = '22023';
  end if;
  if jsonb_typeof(p_links) <> 'array' or jsonb_array_length(p_links) > 20 then
    raise exception 'links must be an array with at most 20 items' using errcode = '22023';
  end if;

  select * into v_actor
  from public.principals
  where id = p_actor_id and is_active;
  if v_actor.id is null then
    raise exception 'sender is inactive or missing' using errcode = '42501';
  end if;

  if p_to_handle is not null then
    select * into v_recipient
    from public.principals
    where handle = lower(btrim(p_to_handle)) and is_active;
    if v_recipient.id is null then
      raise exception 'recipient is inactive or missing' using errcode = 'P0002';
    end if;
    if v_recipient.id = v_actor.id then
      raise exception 'cannot create a direct conversation with yourself' using errcode = '22023';
    end if;

    v_direct_key := least(v_actor.id::text, v_recipient.id::text)
      || ':' || greatest(v_actor.id::text, v_recipient.id::text);

    insert into public.conversations(kind, direct_key, created_by)
    values ('direct', v_direct_key, v_actor.id)
    on conflict (direct_key) do update set direct_key = excluded.direct_key
    returning * into v_conversation;

    insert into public.conversation_members(conversation_id, principal_id, role)
    values
      (v_conversation.id, v_actor.id, 'member'),
      (v_conversation.id, v_recipient.id, 'member')
    on conflict (conversation_id, principal_id) do update
      set left_at = null;
  else
    select * into v_conversation
    from public.conversations
    where id = p_conversation_id;
    if v_conversation.id is null then
      raise exception 'conversation not found' using errcode = 'P0002';
    end if;
    if not exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = v_conversation.id
        and cm.principal_id = v_actor.id
        and cm.left_at is null
    ) then
      raise exception 'sender is not an active conversation member' using errcode = '42501';
    end if;
  end if;

  if p_reply_to_message_id is not null and not exists (
    select 1 from public.messages r
    where r.id = p_reply_to_message_id
      and r.conversation_id = v_conversation.id
  ) then
    raise exception 'reply target is not in this conversation' using errcode = '22023';
  end if;

  insert into public.messages(
    conversation_id, sender_id, body, reply_to_message_id,
    task_id, priority, links, client_message_id
  )
  values (
    v_conversation.id, v_actor.id, p_text, p_reply_to_message_id,
    nullif(btrim(p_task_id), ''), p_priority, p_links, p_client_message_id
  )
  on conflict (sender_id, client_message_id) do update
    set sender_id = excluded.sender_id
  returning * into v_message;

  update public.conversations
  set updated_at = greatest(updated_at, v_message.created_at)
  where id = v_message.conversation_id;

  return jsonb_build_object(
    'id', v_message.id,
    'conversationId', v_message.conversation_id,
    'senderId', v_message.sender_id,
    'text', v_message.body,
    'replyToMessageId', v_message.reply_to_message_id,
    'taskId', v_message.task_id,
    'priority', v_message.priority,
    'links', v_message.links,
    'clientMessageId', v_message.client_message_id,
    'createdAt', v_message.created_at,
    'expiresAt', v_message.expires_at,
    'deduplicated', v_message.created_at < now() - interval '1 second'
  );
end;
$$;

create or replace function public.ambr_mark_read(
  p_actor_id uuid,
  p_conversation_id uuid,
  p_message_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_target public.messages;
  v_current public.messages;
begin
  if not exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = p_conversation_id
      and cm.principal_id = p_actor_id
      and cm.left_at is null
  ) then
    raise exception 'reader is not an active conversation member' using errcode = '42501';
  end if;

  select * into v_target from public.messages
  where id = p_message_id and conversation_id = p_conversation_id;
  if v_target.id is null then
    raise exception 'message not found in conversation' using errcode = 'P0002';
  end if;

  select m.* into v_current
  from public.conversation_reads cr
  join public.messages m on m.id = cr.last_read_message_id
  where cr.conversation_id = p_conversation_id
    and cr.principal_id = p_actor_id;

  if v_current.id is not null
    and (v_target.created_at, v_target.id) < (v_current.created_at, v_current.id) then
    raise exception 'read cursor cannot move backwards' using errcode = '22023';
  end if;

  insert into public.conversation_reads(
    conversation_id, principal_id, last_read_message_id, read_at
  ) values (p_conversation_id, p_actor_id, p_message_id, now())
  on conflict (conversation_id, principal_id) do update
    set last_read_message_id = excluded.last_read_message_id,
        read_at = excluded.read_at;

  return jsonb_build_object(
    'conversationId', p_conversation_id,
    'lastReadMessageId', p_message_id,
    'readAt', now()
  );
end;
$$;

create or replace function public.ambr_list_conversations(
  p_actor_id uuid,
  p_include_all boolean default false,
  p_before_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 30
)
returns table (
  conversation_id uuid,
  kind text,
  name text,
  sort_at timestamptz,
  unread_count bigint,
  members jsonb,
  last_message jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.id,
    c.kind,
    c.name,
    coalesce(last_m.created_at, c.created_at) as sort_at,
    count(unread_m.id) as unread_count,
    coalesce(member_list.members, '[]'::jsonb) as members,
    case when last_m.id is null then null else jsonb_build_object(
      'id', last_m.id,
      'senderHandle', last_sender.handle,
      'text', last_m.body,
      'deleted', last_m.deleted_at is not null,
      'priority', last_m.priority,
      'createdAt', last_m.created_at
    ) end as last_message
  from public.conversations c
  left join lateral (
    select m.* from public.messages m
    where m.conversation_id = c.id
    order by m.created_at desc, m.id desc
    limit 1
  ) last_m on true
  left join public.principals last_sender on last_sender.id = last_m.sender_id
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'id', p.id,
      'handle', p.handle,
      'displayName', p.display_name,
      'kind', p.kind,
      'role', cm.role
    ) order by p.handle) as members
    from public.conversation_members cm
    join public.principals p on p.id = cm.principal_id
    where cm.conversation_id = c.id and cm.left_at is null
  ) member_list on true
  left join public.conversation_reads cr
    on cr.conversation_id = c.id and cr.principal_id = p_actor_id
  left join public.messages read_m on read_m.id = cr.last_read_message_id
  left join public.messages unread_m
    on unread_m.conversation_id = c.id
    and unread_m.sender_id <> p_actor_id
    and (read_m.id is null or (unread_m.created_at, unread_m.id) > (read_m.created_at, read_m.id))
  where (
    p_include_all
    or exists (
      select 1 from public.conversation_members mine
      where mine.conversation_id = c.id
        and mine.principal_id = p_actor_id
        and mine.left_at is null
    )
  )
  and (
    p_before_at is null
    or (coalesce(last_m.created_at, c.created_at), c.id) < (p_before_at, p_before_id)
  )
  group by c.id, last_m.id, last_m.sender_id, last_m.body, last_m.deleted_at,
    last_m.priority, last_m.created_at, last_sender.handle, member_list.members
  order by sort_at desc, c.id desc
  limit least(greatest(p_limit, 1), 100);
$$;

create or replace function public.ambr_list_messages(
  p_actor_id uuid,
  p_conversation_id uuid,
  p_include_all boolean default false,
  p_before_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 50
)
returns table (
  message_id uuid,
  conversation_id uuid,
  sender_id uuid,
  sender_handle extensions.citext,
  sender_display_name text,
  body text,
  reply_to_message_id uuid,
  task_id text,
  priority text,
  links jsonb,
  client_message_id uuid,
  created_at timestamptz,
  expires_at timestamptz,
  deleted_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    m.id, m.conversation_id, m.sender_id, p.handle, p.display_name,
    m.body, m.reply_to_message_id, m.task_id, m.priority, m.links,
    m.client_message_id, m.created_at, m.expires_at, m.deleted_at
  from public.messages m
  join public.principals p on p.id = m.sender_id
  where m.conversation_id = p_conversation_id
    and (
      p_include_all
      or exists (
        select 1 from public.conversation_members cm
        where cm.conversation_id = m.conversation_id
          and cm.principal_id = p_actor_id
          and cm.left_at is null
      )
    )
    and (p_before_at is null or (m.created_at, m.id) < (p_before_at, p_before_id))
  order by m.created_at desc, m.id desc
  limit least(greatest(p_limit, 1), 100);
$$;

create or replace function public.ambr_get_message_status(
  p_actor_id uuid,
  p_message_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_message public.messages;
  v_reads jsonb;
begin
  select * into v_message from public.messages where id = p_message_id;
  if v_message.id is null then
    raise exception 'message not found' using errcode = 'P0002';
  end if;
  if v_message.sender_id <> p_actor_id and not exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = v_message.conversation_id
      and cm.principal_id = p_actor_id and cm.left_at is null
  ) then
    raise exception 'message is not visible to actor' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'principalId', p.id,
    'handle', p.handle,
    'displayName', p.display_name,
    'read', read_m.id is not null and (read_m.created_at, read_m.id) >= (v_message.created_at, v_message.id),
    'readAt', case when read_m.id is not null and (read_m.created_at, read_m.id) >= (v_message.created_at, v_message.id)
      then cr.read_at else null end
  ) order by p.handle), '[]'::jsonb)
  into v_reads
  from public.conversation_members cm
  join public.principals p on p.id = cm.principal_id
  left join public.conversation_reads cr
    on cr.conversation_id = cm.conversation_id and cr.principal_id = cm.principal_id
  left join public.messages read_m on read_m.id = cr.last_read_message_id
  where cm.conversation_id = v_message.conversation_id
    and cm.left_at is null;

  return jsonb_build_object(
    'messageId', v_message.id,
    'conversationId', v_message.conversation_id,
    'delivered', true,
    'participants', v_reads
  );
end;
$$;

create or replace function public.ambr_admin_create_agent(
  p_handle text,
  p_display_name text,
  p_token_hash text,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_principal public.principals;
  v_credential public.agent_credentials;
begin
  insert into public.principals(handle, display_name, kind)
  values (lower(btrim(p_handle)), btrim(p_display_name), 'agent')
  returning * into v_principal;

  insert into public.agent_credentials(principal_id, token_hash, expires_at)
  values (v_principal.id, p_token_hash, p_expires_at)
  returning * into v_credential;

  return jsonb_build_object(
    'id', v_principal.id,
    'handle', v_principal.handle,
    'displayName', v_principal.display_name,
    'credentialId', v_credential.id,
    'expiresAt', v_credential.expires_at,
    'createdAt', v_credential.created_at
  );
end;
$$;

create or replace function public.ambr_admin_save_group(
  p_actor_id uuid,
  p_name text,
  p_member_ids uuid[],
  p_group_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_group public.conversations;
  v_member_id uuid;
begin
  if char_length(btrim(p_name)) not between 1 and 100 then
    raise exception 'group name must contain 1 to 100 characters' using errcode = '22023';
  end if;
  if p_group_id is null then
    insert into public.conversations(kind, name, created_by)
    values ('group', btrim(p_name), p_actor_id)
    returning * into v_group;
  else
    update public.conversations
    set name = btrim(p_name), updated_at = now()
    where id = p_group_id and kind = 'group'
    returning * into v_group;
    if v_group.id is null then
      raise exception 'group not found' using errcode = 'P0002';
    end if;
  end if;

  update public.conversation_members
  set left_at = now()
  where conversation_id = v_group.id
    and principal_id <> p_actor_id
    and not (principal_id = any(coalesce(p_member_ids, '{}'::uuid[])))
    and left_at is null;

  foreach v_member_id in array array_append(coalesce(p_member_ids, '{}'::uuid[]), p_actor_id)
  loop
    if not exists (select 1 from public.principals where id = v_member_id and is_active) then
      raise exception 'group member is inactive or missing' using errcode = 'P0002';
    end if;
    insert into public.conversation_members(conversation_id, principal_id, role)
    values (v_group.id, v_member_id, case when v_member_id = p_actor_id then 'owner' else 'member' end)
    on conflict (conversation_id, principal_id) do update
      set left_at = null,
          role = excluded.role;
  end loop;

  return jsonb_build_object('id', v_group.id, 'name', v_group.name, 'kind', v_group.kind);
end;
$$;

create or replace function public.ambr_admin_issue_token(
  p_principal_id uuid,
  p_token_hash text,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_principal public.principals;
  v_credential public.agent_credentials;
begin
  select * into v_principal
  from public.principals
  where id = p_principal_id and kind = 'agent' and is_active;
  if v_principal.id is null then
    raise exception 'active agent not found' using errcode = 'P0002';
  end if;
  insert into public.agent_credentials(principal_id, token_hash, expires_at)
  values (v_principal.id, p_token_hash, p_expires_at)
  returning * into v_credential;
  return jsonb_build_object(
    'credentialId', v_credential.id,
    'principalId', v_principal.id,
    'handle', v_principal.handle,
    'expiresAt', v_credential.expires_at,
    'createdAt', v_credential.created_at
  );
end;
$$;

create or replace function public.ambr_admin_delete_message(
  p_actor_id uuid,
  p_message_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_message public.messages;
begin
  update public.messages
  set body = null,
      reply_to_message_id = null,
      task_id = null,
      priority = 'normal',
      links = '[]'::jsonb,
      client_message_id = null,
      deleted_at = coalesce(deleted_at, now()),
      deleted_by = coalesce(deleted_by, p_actor_id)
  where id = p_message_id
  returning * into v_message;
  if v_message.id is null then
    raise exception 'message not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'id', v_message.id,
    'conversationId', v_message.conversation_id,
    'deletedAt', v_message.deleted_at,
    'expiresAt', v_message.expires_at
  );
end;
$$;

create or replace function private.ambr_cleanup_expired()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted bigint;
begin
  delete from public.messages where expires_at <= now();
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.ambr_claim_admin(text, uuid) to service_role;
grant execute on function public.ambr_send_message(uuid, text, uuid, text, uuid, text, text, jsonb, uuid) to service_role;
grant execute on function public.ambr_mark_read(uuid, uuid, uuid) to service_role;
grant execute on function public.ambr_list_conversations(uuid, boolean, timestamptz, uuid, integer) to service_role;
grant execute on function public.ambr_list_messages(uuid, uuid, boolean, timestamptz, uuid, integer) to service_role;
grant execute on function public.ambr_get_message_status(uuid, uuid) to service_role;
grant execute on function public.ambr_admin_create_agent(text, text, text, timestamptz) to service_role;
grant execute on function public.ambr_admin_save_group(uuid, text, uuid[], uuid) to service_role;
grant execute on function public.ambr_admin_issue_token(uuid, text, timestamptz) to service_role;
grant execute on function public.ambr_admin_delete_message(uuid, uuid) to service_role;
revoke execute on function private.ambr_cleanup_expired() from public, anon, authenticated;

alter publication supabase_realtime add table public.conversations;
alter publication supabase_realtime add table public.conversation_members;
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.conversation_reads;

select cron.schedule(
  'ambr-retention-cleanup',
  '17 3 * * *',
  'select private.ambr_cleanup_expired();'
);
