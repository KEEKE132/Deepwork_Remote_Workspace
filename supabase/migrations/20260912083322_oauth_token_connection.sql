create table public.oauth_authorization_codes (
  code_hash text primary key,
  client_id text not null,
  redirect_uri text not null,
  code_challenge text not null,
  resource text not null,
  encrypted_token text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  constraint oauth_authorization_codes_hash_format check (code_hash ~ '^[0-9a-f]{64}$'),
  constraint oauth_authorization_codes_client_length check (char_length(client_id) between 1 and 16384),
  constraint oauth_authorization_codes_redirect_length check (char_length(redirect_uri) between 1 and 2048),
  constraint oauth_authorization_codes_challenge_format check (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  constraint oauth_authorization_codes_resource_length check (char_length(resource) between 1 and 2048),
  constraint oauth_authorization_codes_token_length check (char_length(encrypted_token) between 1 and 2048),
  constraint oauth_authorization_codes_expiry check (expires_at > created_at)
);

create index oauth_authorization_codes_expiry_idx
  on public.oauth_authorization_codes(expires_at);

alter table public.oauth_authorization_codes enable row level security;
revoke all on public.oauth_authorization_codes from public, anon, authenticated;
grant select, insert, delete on public.oauth_authorization_codes to service_role;

create or replace function public.ambr_consume_oauth_code(
  p_code_hash text,
  p_client_id text,
  p_redirect_uri text,
  p_code_challenge text,
  p_resource text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_code public.oauth_authorization_codes%rowtype;
begin
  delete from public.oauth_authorization_codes
  where code_hash = p_code_hash
    and client_id = p_client_id
    and redirect_uri = p_redirect_uri
    and code_challenge = p_code_challenge
    and resource = p_resource
    and expires_at > now()
  returning * into v_code;

  if v_code.code_hash is null then
    return null;
  end if;

  return jsonb_build_object(
    'encryptedToken', v_code.encrypted_token,
    'expiresAt', v_code.expires_at
  );
end;
$$;

revoke execute on function public.ambr_consume_oauth_code(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.ambr_consume_oauth_code(text, text, text, text, text)
  to service_role;

create or replace function private.ambr_cleanup_expired()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted_messages bigint;
  v_deleted_codes bigint;
begin
  delete from public.messages where expires_at <= now();
  get diagnostics v_deleted_messages = row_count;

  delete from public.oauth_authorization_codes where expires_at <= now();
  get diagnostics v_deleted_codes = row_count;

  return v_deleted_messages + v_deleted_codes;
end;
$$;
