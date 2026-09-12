begin;
select plan(35);

select has_table('public', 'principals', 'principals table exists');
select has_table('public', 'agent_credentials', 'agent_credentials table exists');
select has_table('public', 'conversations', 'conversations table exists');
select has_table('public', 'conversation_members', 'conversation_members table exists');
select has_table('public', 'messages', 'messages table exists');
select has_table('public', 'conversation_reads', 'conversation_reads table exists');
select has_column('public', 'principals', 'description', 'principals description exists');
select has_table('public', 'oauth_authorization_codes', 'OAuth authorization code table exists');

select ok(relrowsecurity, 'OAuth authorization code RLS is enabled')
from pg_class where oid = 'public.oauth_authorization_codes'::regclass;

select lives_ok($$
  insert into public.oauth_authorization_codes(
    code_hash, client_id, redirect_uri, code_challenge, resource, encrypted_token
  ) values (
    repeat('c', 64), 'signed-client', 'http://127.0.0.1/callback', repeat('d', 43),
    'http://127.0.0.1:8787/mcp', 'encrypted-test-token'
  )
$$, 'OAuth authorization code is stored');

select is(
  public.ambr_consume_oauth_code(
    repeat('c', 64), 'signed-client', 'http://127.0.0.1/callback', repeat('e', 43),
    'http://127.0.0.1:8787/mcp'
  ),
  null::jsonb,
  'wrong PKCE challenge does not consume an OAuth code'
);

select is(
  public.ambr_consume_oauth_code(
    repeat('c', 64), 'signed-client', 'http://127.0.0.1/callback', repeat('d', 43),
    'http://127.0.0.1:8787/mcp'
  ) ->> 'encryptedToken',
  'encrypted-test-token',
  'matching OAuth code is consumed once'
);

select is(
  public.ambr_consume_oauth_code(
    repeat('c', 64), 'signed-client', 'http://127.0.0.1/callback', repeat('d', 43),
    'http://127.0.0.1:8787/mcp'
  ),
  null::jsonb,
  'consumed OAuth code cannot be replayed'
);

select ok(relrowsecurity, 'messages RLS is enabled')
from pg_class where oid = 'public.messages'::regclass;
select ok(relrowsecurity, 'conversations RLS is enabled')
from pg_class where oid = 'public.conversations'::regclass;

insert into public.principals(id, handle, display_name, kind) values
  ('11111111-1111-4111-8111-111111111111', 'agent-one', 'Agent One', 'agent'),
  ('22222222-2222-4222-8222-222222222222', 'agent-two', 'Agent Two', 'agent'),
  ('33333333-3333-4333-8333-333333333333', 'test-admin-actor', 'Test Admin', 'human');

select lives_ok($$
  select public.ambr_admin_create_agent_with_description(
    'agent-described', 'Described Agent', 'Handles research and source verification.',
    repeat('a', 64), now() + interval '1 day'
  )
$$, 'admin creates an agent with a routing description');

select is(
  (select description from public.principals where handle = 'agent-described'),
  'Handles research and source verification.',
  'agent routing description is stored'
);

insert into public.principals(id, handle, display_name, kind, auth_user_id) values
  ('44444444-4444-4444-8444-444444444444', 'admin-owner', 'Existing Admin', 'human',
   '55555555-5555-4555-8555-555555555555'),
  ('66666666-6666-4666-8666-666666666666', 'regular-user', 'Regular User', 'human',
   '77777777-7777-4777-8777-777777777777');

select lives_ok($$
  select public.ambr_claim_admin('admin@example.com', '55555555-5555-4555-8555-555555555555')
$$, 'admin claim reuses an existing auth-linked human principal');

select is(
  (select principal_id from public.admin_users where email = 'admin@example.com'),
  '44444444-4444-4444-8444-444444444444'::uuid,
  'admin claim keeps the existing principal identity'
);

select lives_ok($$
  select public.ambr_send_message(
    '11111111-1111-4111-8111-111111111111', 'agent-two', null, 'hello', null,
    'task-1', 'high', '[{"url":"https://example.com"}]',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  )
$$, 'direct message is created');

select lives_ok($$
  select public.ambr_send_message(
    '11111111-1111-4111-8111-111111111111', 'agent-two', null, 'hello retry', null,
    'task-1', 'high', '[]', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  )
$$, 'idempotent retry returns the original message');

select is((select count(*) from public.messages), 1::bigint, 'idempotent retry does not duplicate');

select throws_ok($$
  select public.ambr_send_message(
    '11111111-1111-4111-8111-111111111111', 'agent-one', null, 'self', null,
    null, 'normal', '[]', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  )
$$, '22023', 'cannot create a direct conversation with yourself', 'self messaging is rejected');

select lives_ok($$
  select public.ambr_admin_save_group(
    '33333333-3333-4333-8333-333333333333', 'Test Group',
    array['22222222-2222-4222-8222-222222222222'::uuid], null
  )
$$, 'admin creates a group');

select is(
  (select count(*) from public.conversation_members cm
   join public.conversations c on c.id = cm.conversation_id
   where c.name = 'Test Group' and cm.left_at is null),
  2::bigint,
  'group contains the administrator and selected member'
);

select throws_ok($$
  select public.ambr_send_message(
    '11111111-1111-4111-8111-111111111111', null,
    (select id from public.conversations where name = 'Test Group'),
    'not a member', null, null, 'normal', '[]',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  )
$$, '42501', 'sender is not an active conversation member', 'group non-member send is rejected');

select throws_ok($$
  select public.ambr_send_message(
    '33333333-3333-4333-8333-333333333333', null,
    (select id from public.conversations where name = 'Test Group'),
    'wrong reply', (select id from public.messages limit 1), null, 'normal', '[]',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  )
$$, '22023', 'reply target is not in this conversation', 'cross-conversation reply is rejected');

select lives_ok($$
  select public.ambr_send_message(
    '11111111-1111-4111-8111-111111111111', 'agent-two', null, 'second', null,
    null, 'normal', '[]', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  )
$$, 'second direct message is created');

update public.messages
set created_at = case client_message_id
  when 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' then '2026-09-12 00:00:00+00'::timestamptz
  else '2026-09-12 00:01:00+00'::timestamptz
end
where client_message_id in (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
);

select lives_ok($$
  select public.ambr_mark_read(
    '22222222-2222-4222-8222-222222222222',
    (select conversation_id from public.messages where client_message_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
    (select id from public.messages where client_message_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd')
  )
$$, 'read cursor advances to the newest message');

select throws_ok($$
  select public.ambr_mark_read(
    '22222222-2222-4222-8222-222222222222',
    (select conversation_id from public.messages where client_message_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    (select id from public.messages where client_message_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  )
$$, '22023', 'read cursor cannot move backwards', 'read cursor cannot move backwards');

select lives_ok($$
  select public.ambr_send_message(
    '66666666-6666-4666-8666-666666666666', 'agent-one', null, 'member only', null,
    null, 'normal', '[]', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  )
$$, 'regular user creates a member-visible conversation');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"77777777-7777-4777-8777-777777777777","email":"user@example.com","role":"authenticated"}',
  true
);
select is(
  (select count(distinct conversation_id) from public.messages),
  1::bigint,
  'RLS restricts a regular user to member conversations'
);
reset role;

select lives_ok($$
  select public.ambr_admin_delete_message(
    '33333333-3333-4333-8333-333333333333',
    (select id from public.messages limit 1)
  )
$$, 'admin creates a tombstone');

select ok(
  (select body is null and task_id is null and links = '[]'::jsonb and client_message_id is null
   from public.messages where deleted_at is not null limit 1),
  'tombstone removes body and structured metadata'
);

insert into public.messages(
  conversation_id, sender_id, body, client_message_id, created_at, expires_at
) values (
  (select id from public.conversations where kind = 'direct' limit 1),
  '11111111-1111-4111-8111-111111111111',
  'expired',
  'ffffffff-ffff-4fff-8fff-ffffffffffff',
  now() - interval '40 days',
  now() - interval '10 days'
);

select is(private.ambr_cleanup_expired(), 1::bigint, 'retention cleanup removes expired messages');

select * from finish();
rollback;
