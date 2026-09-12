alter table public.principals
  add column description text not null default '',
  add constraint principals_description_length
    check (char_length(description) <= 500);

comment on column public.principals.description is
  'Role and routing guidance describing when this principal should receive messages.';

create or replace function public.ambr_admin_create_agent_with_description(
  p_handle text,
  p_display_name text,
  p_description text,
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
  insert into public.principals(handle, display_name, description, kind)
  values (
    lower(btrim(p_handle)),
    btrim(p_display_name),
    btrim(coalesce(p_description, '')),
    'agent'
  )
  returning * into v_principal;

  insert into public.agent_credentials(principal_id, token_hash, expires_at)
  values (v_principal.id, p_token_hash, p_expires_at)
  returning * into v_credential;

  return jsonb_build_object(
    'id', v_principal.id,
    'handle', v_principal.handle,
    'displayName', v_principal.display_name,
    'description', v_principal.description,
    'credentialId', v_credential.id,
    'expiresAt', v_credential.expires_at,
    'createdAt', v_credential.created_at
  );
end;
$$;

revoke execute on function public.ambr_admin_create_agent_with_description(
  text, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.ambr_admin_create_agent_with_description(
  text, text, text, text, timestamptz
) to service_role;
