begin;

-- Forward-only repair for the two production failures exposed by the 0050
-- verifier. This migration does not rewrite display frames or watchlist rows.
-- It removes legacy display-table grants, proves the already-installed 0049
-- constraints exactly, and corrects a verifier normalization typo.
do $phase1_repair_preflight$
declare
  health_oid oid;
  display_oid oid := pg_catalog.to_regclass('public.ht_stock_display_frames');
  watchlist_oid oid := pg_catalog.to_regclass('public.ht_labs_watchlist');
  auth_users_oid oid := pg_catalog.to_regclass('auth.users');
  user_id_attnum smallint;
  symbol_attnum smallint;
  auth_user_id_attnum smallint;
  current_health jsonb;
  symbol_expression text;
begin
  select p.oid
  into health_oid
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'ht_phase1_workspace_infrastructure_health'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) = '';

  if health_oid is null then
    raise exception '0051 preflight: the 0050 Phase 1 verifier is not installed';
  end if;
  if display_oid is null or watchlist_oid is null or auth_users_oid is null then
    raise exception '0051 preflight: a required 0048/0049 relation is missing';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_class c
    where c.oid = display_oid and c.relkind = 'r'
  ) or not exists (
    select 1
    from pg_catalog.pg_class c
    where c.oid = watchlist_oid and c.relkind = 'r'
  ) then
    raise exception '0051 preflight: Phase 1 relations must be ordinary tables';
  end if;
  if (
    select count(*)
    from pg_catalog.pg_roles
    where rolname in ('anon', 'authenticated', 'service_role')
  ) <> 3 then
    raise exception '0051 preflight: standard Supabase roles are missing';
  end if;

  current_health := public.ht_phase1_workspace_infrastructure_health();
  if coalesce((current_health #>> '{migration0048,tableReady}')::boolean, false) is not true
    or coalesce((current_health #>> '{migration0048,publicationRpcReady}')::boolean, false) is not true
    or coalesce((current_health #>> '{migration0049,tableReady}')::boolean, false) is not true
    or coalesce((current_health #>> '{migration0049,policiesReady}')::boolean, false) is not true
    or coalesce((current_health #>> '{migration0049,accessBoundaryReady}')::boolean, false) is not true
    or coalesce((current_health #>> '{migration0049,roleBoundaryReady}')::boolean, false) is not true
  then
    raise exception '0051 preflight: production has failures outside the approved repair scope: %',
      current_health;
  end if;

  select a.attnum into user_id_attnum
  from pg_catalog.pg_attribute a
  where a.attrelid = watchlist_oid
    and a.attname = 'user_id'
    and a.attnum > 0
    and not a.attisdropped;
  select a.attnum into symbol_attnum
  from pg_catalog.pg_attribute a
  where a.attrelid = watchlist_oid
    and a.attname = 'symbol'
    and a.attnum > 0
    and not a.attisdropped;
  select a.attnum into auth_user_id_attnum
  from pg_catalog.pg_attribute a
  where a.attrelid = auth_users_oid
    and a.attname = 'id'
    and a.attnum > 0
    and not a.attisdropped;

  if user_id_attnum is null or symbol_attnum is null or auth_user_id_attnum is null then
    raise exception '0051 preflight: governing watchlist columns are missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = watchlist_oid
      and c.conname = 'ht_labs_watchlist_user_id_symbol_key'
      and c.contype = 'u'
      and c.conkey = array[user_id_attnum, symbol_attnum]::smallint[]
      and c.convalidated
      and not c.condeferrable
      and not c.condeferred
  ) then
    raise exception '0051 preflight: exact watchlist owner+symbol constraint is missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = watchlist_oid
      and c.conname = 'ht_labs_watchlist_user_id_fkey'
      and c.contype = 'f'
      and c.conkey = array[user_id_attnum]::smallint[]
      and c.confrelid = auth_users_oid
      and c.confkey = array[auth_user_id_attnum]::smallint[]
      and c.confdeltype = 'c'
      and c.confupdtype = 'a'
      and c.confmatchtype = 's'
      and c.convalidated
      and not c.condeferrable
      and not c.condeferred
  ) then
    raise exception '0051 preflight: exact watchlist auth.users foreign key is missing';
  end if;

  select pg_catalog.regexp_replace(
    pg_catalog.lower(pg_catalog.pg_get_expr(c.conbin, c.conrelid, true)),
    '[[:space:]()]', '', 'g'
  )
  into symbol_expression
  from pg_catalog.pg_constraint c
  where c.conrelid = watchlist_oid
    and c.conname = 'ht_labs_watchlist_symbol_format_check'
    and c.contype = 'c'
    and c.convalidated
    and not c.connoinherit;

  if symbol_expression is null or symbol_expression not in (
    'symbol=uppersymbolandsymbol~''^[a-z0-9][a-z0-9./^-]{0,31}$''::text',
    'symbol=pg_catalog.uppersymbolandsymbol~''^[a-z0-9][a-z0-9./^-]{0,31}$''::text'
  ) then
    raise exception '0051 preflight: exact watchlist ticker-format constraint is missing';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_constraint c
    where c.conrelid = watchlist_oid
      and c.contype in ('u', 'f', 'c')
      and c.conkey && array[user_id_attnum, symbol_attnum]::smallint[]
  ) <> 3 then
    raise exception '0051 preflight: unexpected watchlist constraints govern user_id or symbol';
  end if;
end
$phase1_repair_preflight$;

-- 0048 intended service_role to have SELECT only. A table can retain grants
-- from a pre-existing object or at column level, so revoke every explicit
-- non-owner grant at both levels before restoring the one intended grant.
do $display_acl_repair$
declare
  display_oid oid := 'public.ht_stock_display_frames'::pg_catalog.regclass;
  display_owner_oid oid;
  grant_record record;
  grantee_sql text;
begin
  select c.relowner into display_owner_oid
  from pg_catalog.pg_class c
  where c.oid = display_oid;

  for grant_record in
    select distinct acl.grantee
    from pg_catalog.pg_class c
    cross join lateral pg_catalog.aclexplode(c.relacl) acl
    where c.oid = display_oid
      and acl.grantee <> display_owner_oid
  loop
    if grant_record.grantee = 0 then
      grantee_sql := 'public';
    else
      select pg_catalog.quote_ident(r.rolname)
      into grantee_sql
      from pg_catalog.pg_roles r
      where r.oid = grant_record.grantee;
      if grantee_sql is null then
        raise exception '0051 ACL repair: unknown table grantee oid %',
          grant_record.grantee;
      end if;
    end if;

    execute 'revoke all privileges on table public.ht_stock_display_frames from '
      || grantee_sql || ' cascade';
  end loop;

  for grant_record in
    select distinct acl.grantee, a.attname
    from pg_catalog.pg_attribute a
    cross join lateral pg_catalog.aclexplode(a.attacl) acl
    where a.attrelid = display_oid
      and a.attnum > 0
      and not a.attisdropped
      and acl.grantee <> display_owner_oid
  loop
    if grant_record.grantee = 0 then
      grantee_sql := 'public';
    else
      select pg_catalog.quote_ident(r.rolname)
      into grantee_sql
      from pg_catalog.pg_roles r
      where r.oid = grant_record.grantee;
      if grantee_sql is null then
        raise exception '0051 ACL repair: unknown column grantee oid %',
          grant_record.grantee;
      end if;
    end if;

    execute pg_catalog.format(
      'revoke all privileges (%I) on table public.ht_stock_display_frames from %s cascade',
      grant_record.attname,
      grantee_sql
    );
  end loop;
end
$display_acl_repair$;

revoke all privileges on table public.ht_stock_display_frames
  from public, anon, authenticated, service_role cascade;
grant select on table public.ht_stock_display_frames to service_role;

-- 0050 removes parentheses while normalizing the installed CHECK expression,
-- but its two accepted strings retained parentheses around upper(symbol).
-- Patch only those two impossible expected strings in the installed verifier.
do $repair_phase1_verifier$
declare
  health_oid oid;
  verifier_definition text;
  repaired_definition text;
  bad_fragment_count integer;
begin
  select p.oid, pg_catalog.pg_get_functiondef(p.oid)
  into health_oid, verifier_definition
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'ht_phase1_workspace_infrastructure_health'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) = '';

  bad_fragment_count := (
    pg_catalog.length(verifier_definition)
    - pg_catalog.length(pg_catalog.replace(verifier_definition, 'upper(symbol)', ''))
  ) / pg_catalog.length('upper(symbol)');

  if health_oid is null or bad_fragment_count <> 2 then
    raise exception '0051 verifier repair: expected exactly two normalization typos; found %',
      coalesce(bad_fragment_count, 0);
  end if;

  repaired_definition := pg_catalog.replace(
    verifier_definition,
    'upper(symbol)',
    'uppersymbol'
  );
  execute repaired_definition;
end
$repair_phase1_verifier$;

-- CREATE OR REPLACE retains ACLs. Restate the service-only boundary explicitly.
revoke all on function public.ht_phase1_workspace_infrastructure_health()
  from public, anon, authenticated, service_role;
grant execute on function public.ht_phase1_workspace_infrastructure_health()
  to service_role;

-- Refuse to commit a partial repair. The same service-only verifier consumed by
-- /api/system-health must prove both migrations after the catalog changes.
do $phase1_repair_postflight$
declare
  repaired_health jsonb;
begin
  repaired_health := public.ht_phase1_workspace_infrastructure_health();

  if coalesce((repaired_health #>> '{migration0048,verified}')::boolean, false) is not true
    or coalesce((repaired_health #>> '{migration0049,verified}')::boolean, false) is not true
  then
    raise exception '0051 postflight: Phase 1 infrastructure remains unverified: %',
      repaired_health;
  end if;
end
$phase1_repair_postflight$;

notify pgrst, 'reload schema';
commit;
