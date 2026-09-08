begin;

-- Fail before taking a table lock or changing schema when the production
-- object does not satisfy the required-column contract the application relies on.
do $watchlist_schema_preflight$
declare
  watchlist_oid oid;
  watchlist_kind "char";
  user_id_type oid;
  symbol_type oid;
  auth_users_oid oid;
  auth_user_id_type oid;
  service_role_bypasses_rls boolean;
  authenticated_bypasses_rls boolean;
  anon_bypasses_rls boolean;
begin
  select c.oid, c.relkind
  into watchlist_oid, watchlist_kind
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'ht_labs_watchlist';

  if watchlist_oid is null then
    raise exception '0049 preflight: public.ht_labs_watchlist does not exist';
  end if;
  if watchlist_kind <> 'r' then
    raise exception '0049 preflight: public.ht_labs_watchlist must be an ordinary table';
  end if;

  select a.atttypid
  into user_id_type
  from pg_catalog.pg_attribute a
  where a.attrelid = watchlist_oid
    and a.attname = 'user_id'
    and a.attnum > 0
    and not a.attisdropped;

  select a.atttypid
  into symbol_type
  from pg_catalog.pg_attribute a
  where a.attrelid = watchlist_oid
    and a.attname = 'symbol'
    and a.attnum > 0
    and not a.attisdropped;

  if user_id_type is null then
    raise exception '0049 preflight: public.ht_labs_watchlist.user_id is missing';
  end if;
  if user_id_type <> 'pg_catalog.uuid'::pg_catalog.regtype then
    raise exception '0049 preflight: user_id must already be uuid; found %',
      pg_catalog.format_type(user_id_type, null);
  end if;
  if symbol_type is null then
    raise exception '0049 preflight: public.ht_labs_watchlist.symbol is missing';
  end if;
  if symbol_type <> 'pg_catalog.text'::pg_catalog.regtype then
    raise exception '0049 preflight: symbol must already be text; found %',
      pg_catalog.format_type(symbol_type, null);
  end if;

  select c.oid
  into auth_users_oid
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'auth'
    and c.relname = 'users'
    and c.relkind = 'r';
  if auth_users_oid is null then
    raise exception '0049 preflight: auth.users does not exist as an ordinary table';
  end if;

  select a.atttypid
  into auth_user_id_type
  from pg_catalog.pg_attribute a
  where a.attrelid = auth_users_oid
    and a.attname = 'id'
    and a.attnum > 0
    and not a.attisdropped;
  if auth_user_id_type is null then
    raise exception '0049 preflight: auth.users.id is missing';
  end if;
  if auth_user_id_type <> 'pg_catalog.uuid'::pg_catalog.regtype then
    raise exception '0049 preflight: auth.users.id must be uuid';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth'
      and p.proname = 'uid'
      and p.pronargs = 0
      and p.prorettype = 'pg_catalog.uuid'::pg_catalog.regtype
  ) then
    raise exception '0049 preflight: auth.uid() returning uuid is required';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_roles
    where rolname in ('anon', 'authenticated', 'service_role')
  ) <> 3 then
    raise exception '0049 preflight: anon, authenticated, and service_role roles are required';
  end if;

  select rolbypassrls into service_role_bypasses_rls
  from pg_catalog.pg_roles where rolname = 'service_role';
  select rolbypassrls into authenticated_bypasses_rls
  from pg_catalog.pg_roles where rolname = 'authenticated';
  select rolbypassrls into anon_bypasses_rls
  from pg_catalog.pg_roles where rolname = 'anon';
  if service_role_bypasses_rls is not true then
    raise exception '0049 preflight: service_role must retain BYPASSRLS behavior';
  end if;
  if authenticated_bypasses_rls is not false then
    raise exception '0049 preflight: authenticated must not bypass row-level security';
  end if;
  if anon_bypasses_rls is not false then
    raise exception '0049 preflight: anon must not bypass row-level security';
  end if;
end
$watchlist_schema_preflight$;

-- Prevent a concurrent insert from invalidating the data checks before the
-- constraints are installed.
lock table public.ht_labs_watchlist in access exclusive mode;

do $watchlist_data_preflight$
declare
  violation_count bigint;
begin
  select count(*) into violation_count
  from public.ht_labs_watchlist
  where user_id is null;
  if violation_count > 0 then
    raise exception '0049 preflight: % watchlist rows have NULL user_id', violation_count;
  end if;

  select count(*) into violation_count
  from public.ht_labs_watchlist
  where symbol is null;
  if violation_count > 0 then
    raise exception '0049 preflight: % watchlist rows have NULL symbol', violation_count;
  end if;

  select count(*) into violation_count
  from public.ht_labs_watchlist
  where symbol is not null
    and (
      symbol <> pg_catalog.upper(symbol)
      or symbol !~ '^[A-Z0-9][A-Z0-9./^-]{0,31}$'
    );
  if violation_count > 0 then
    raise exception '0049 preflight: % watchlist rows have invalid or non-uppercase symbols',
      violation_count;
  end if;

  select count(*) into violation_count
  from (
    select user_id, symbol
    from public.ht_labs_watchlist
    group by user_id, symbol
    having count(*) > 1
  ) duplicate_memberships;
  if violation_count > 0 then
    raise exception '0049 preflight: % duplicate (user_id, symbol) memberships exist',
      violation_count;
  end if;

  select count(*) into violation_count
  from public.ht_labs_watchlist w
  left join auth.users u on u.id = w.user_id
  where w.user_id is not null
    and u.id is null;
  if violation_count > 0 then
    raise exception '0049 preflight: % watchlist rows reference missing auth.users',
      violation_count;
  end if;
end
$watchlist_data_preflight$;

-- Replace only constraints that govern the contract columns. No row is
-- deleted, normalized, reassigned, or otherwise rewritten by this migration.
do $watchlist_drop_legacy_constraints$
declare
  watchlist_oid oid := 'public.ht_labs_watchlist'::pg_catalog.regclass;
  user_id_attnum smallint;
  symbol_attnum smallint;
  legacy_constraint record;
begin
  select attnum into user_id_attnum
  from pg_catalog.pg_attribute
  where attrelid = watchlist_oid and attname = 'user_id' and not attisdropped;
  select attnum into symbol_attnum
  from pg_catalog.pg_attribute
  where attrelid = watchlist_oid and attname = 'symbol' and not attisdropped;

  for legacy_constraint in
    select con.conname
    from pg_catalog.pg_constraint con
    where con.conrelid = watchlist_oid
      and (
        (con.contype = 'f' and user_id_attnum = any(con.conkey))
        or (con.contype = 'c' and symbol_attnum = any(con.conkey))
        or (
          con.contype = 'u'
          and pg_catalog.cardinality(con.conkey) = 2
          and con.conkey @> array[user_id_attnum, symbol_attnum]::smallint[]
        )
      )
  loop
    execute pg_catalog.format(
      'alter table public.ht_labs_watchlist drop constraint %I',
      legacy_constraint.conname
    );
  end loop;
end
$watchlist_drop_legacy_constraints$;

alter table public.ht_labs_watchlist
  alter column user_id set not null,
  alter column symbol set not null;

alter table public.ht_labs_watchlist
  add constraint ht_labs_watchlist_symbol_format_check
  check (
    symbol = pg_catalog.upper(symbol)
    and symbol ~ '^[A-Z0-9][A-Z0-9./^-]{0,31}$'
  ),
  add constraint ht_labs_watchlist_user_id_symbol_key
  unique (user_id, symbol),
  add constraint ht_labs_watchlist_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.ht_labs_watchlist enable row level security;
alter table public.ht_labs_watchlist force row level security;

-- Remove every prior policy, regardless of its name, before installing the
-- exact four owner policies below.
do $watchlist_drop_legacy_policies$
declare
  legacy_policy record;
begin
  for legacy_policy in
    select pol.polname
    from pg_catalog.pg_policy pol
    where pol.polrelid = 'public.ht_labs_watchlist'::pg_catalog.regclass
  loop
    execute pg_catalog.format(
      'drop policy %I on public.ht_labs_watchlist',
      legacy_policy.polname
    );
  end loop;
end
$watchlist_drop_legacy_policies$;

-- Discover grantees from both table and column ACLs, then revoke at table level
-- with CASCADE (PostgreSQL also removes the corresponding column grants).
-- Standard Supabase roles are revoked explicitly too, then only the intended
-- grants are restored.
do $watchlist_revoke_legacy_grants$
declare
  table_oid oid := 'public.ht_labs_watchlist'::pg_catalog.regclass;
  table_owner oid;
  grant_record record;
  grantee_sql text;
begin
  select relowner into table_owner
  from pg_catalog.pg_class where oid = table_oid;

  for grant_record in
    select distinct grants.grantee
    from (
      select expanded.grantee
      from pg_catalog.pg_class c
      cross join lateral pg_catalog.aclexplode(
        coalesce(c.relacl, '{}'::pg_catalog.aclitem[])
      ) expanded
      where c.oid = table_oid
      union
      select expanded.grantee
      from pg_catalog.pg_attribute a
      cross join lateral pg_catalog.aclexplode(
        coalesce(a.attacl, '{}'::pg_catalog.aclitem[])
      ) expanded
      where a.attrelid = table_oid
        and a.attnum > 0
        and not a.attisdropped
    ) grants
    where grants.grantee <> table_owner
  loop
    if grant_record.grantee = 0 then
      grantee_sql := 'public';
    else
      select pg_catalog.quote_ident(r.rolname)
      into grantee_sql
      from pg_catalog.pg_roles r
      where r.oid = grant_record.grantee;
      if grantee_sql is null then
        raise exception '0049 grants: table ACL references unknown role oid %',
          grant_record.grantee;
      end if;
    end if;

    execute 'revoke all privileges on table public.ht_labs_watchlist from '
      || grantee_sql || ' cascade';
  end loop;
end
$watchlist_revoke_legacy_grants$;

revoke all privileges on table public.ht_labs_watchlist
  from public, anon, authenticated, service_role cascade;
grant select, insert, update, delete on table public.ht_labs_watchlist
  to authenticated;
grant all privileges on table public.ht_labs_watchlist
  to service_role;

create policy ht_labs_watchlist_owner_select
  on public.ht_labs_watchlist
  as permissive
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy ht_labs_watchlist_owner_insert
  on public.ht_labs_watchlist
  as permissive
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy ht_labs_watchlist_owner_update
  on public.ht_labs_watchlist
  as permissive
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy ht_labs_watchlist_owner_delete
  on public.ht_labs_watchlist
  as permissive
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- Assert the installed contract before committing. Any mismatch rolls the
-- whole transaction back, including every policy, grant, and constraint change.
do $watchlist_contract_postflight$
declare
  watchlist_oid oid := 'public.ht_labs_watchlist'::pg_catalog.regclass;
  user_id_attnum smallint;
  symbol_attnum smallint;
  authenticated_oid oid;
  service_role_oid oid;
  table_owner_oid oid;
  rls_contract_installed boolean;
begin
  select attnum into user_id_attnum
  from pg_catalog.pg_attribute
  where attrelid = watchlist_oid and attname = 'user_id' and not attisdropped;
  select attnum into symbol_attnum
  from pg_catalog.pg_attribute
  where attrelid = watchlist_oid and attname = 'symbol' and not attisdropped;
  select oid into authenticated_oid
  from pg_catalog.pg_roles where rolname = 'authenticated';
  select oid into service_role_oid
  from pg_catalog.pg_roles where rolname = 'service_role';
  select relowner into table_owner_oid
  from pg_catalog.pg_class where oid = watchlist_oid;

  select relrowsecurity and relforcerowsecurity
  into rls_contract_installed
  from pg_catalog.pg_class where oid = watchlist_oid;
  if rls_contract_installed is not true then
    raise exception '0049 postflight: enable+force RLS contract was not installed';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_attribute
    where attrelid = watchlist_oid
      and attname in ('user_id', 'symbol')
      and not attnotnull
  ) then
    raise exception '0049 postflight: contract columns must be NOT NULL';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint con
    where con.conrelid = watchlist_oid
      and con.conname = 'ht_labs_watchlist_user_id_symbol_key'
      and con.contype = 'u'
      and con.conkey = array[user_id_attnum, symbol_attnum]::smallint[]
  ) then
    raise exception '0049 postflight: named owner+symbol unique constraint is missing';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint con
    where con.conrelid = watchlist_oid
      and con.conname = 'ht_labs_watchlist_user_id_fkey'
      and con.contype = 'f'
      and con.conkey = array[user_id_attnum]::smallint[]
      and con.confrelid = 'auth.users'::pg_catalog.regclass
      and con.confdeltype = 'c'
  ) then
    raise exception '0049 postflight: auth.users ON DELETE CASCADE foreign key is missing';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint con
    where con.conrelid = watchlist_oid
      and con.conname = 'ht_labs_watchlist_symbol_format_check'
      and con.contype = 'c'
  ) then
    raise exception '0049 postflight: uppercase ticker check is missing';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_policy pol
    where pol.polrelid = watchlist_oid
  ) <> 4 then
    raise exception '0049 postflight: watchlist must have exactly four policies';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policy pol
    where pol.polrelid = watchlist_oid
      and (
        pol.polname not in (
          'ht_labs_watchlist_owner_select',
          'ht_labs_watchlist_owner_insert',
          'ht_labs_watchlist_owner_update',
          'ht_labs_watchlist_owner_delete'
        )
        or pol.polpermissive is not true
        or pol.polroles <> array[authenticated_oid]::oid[]
        or (
          pol.polname = 'ht_labs_watchlist_owner_select' and pol.polcmd <> 'r'
        )
        or (
          pol.polname = 'ht_labs_watchlist_owner_insert' and pol.polcmd <> 'a'
        )
        or (
          pol.polname = 'ht_labs_watchlist_owner_update' and pol.polcmd <> 'w'
        )
        or (
          pol.polname = 'ht_labs_watchlist_owner_delete' and pol.polcmd <> 'd'
        )
      )
  ) then
    raise exception '0049 postflight: a non-owner or unexpected policy remains';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class c
    cross join lateral pg_catalog.aclexplode(
      coalesce(c.relacl, '{}'::pg_catalog.aclitem[])
    ) expanded
    where c.oid = watchlist_oid
      and expanded.grantee not in (
        table_owner_oid,
        authenticated_oid,
        service_role_oid
      )
  ) then
    raise exception '0049 postflight: a legacy table grant remains';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_attribute a
    cross join lateral pg_catalog.aclexplode(
      coalesce(a.attacl, '{}'::pg_catalog.aclitem[])
    ) expanded
    where a.attrelid = watchlist_oid
      and a.attnum > 0
      and not a.attisdropped
      and expanded.grantee <> table_owner_oid
  ) then
    raise exception '0049 postflight: a legacy column grant remains';
  end if;

  if not pg_catalog.has_table_privilege(
    'authenticated', 'public.ht_labs_watchlist', 'SELECT'
  ) or not pg_catalog.has_table_privilege(
    'authenticated', 'public.ht_labs_watchlist', 'INSERT'
  ) or not pg_catalog.has_table_privilege(
    'authenticated', 'public.ht_labs_watchlist', 'UPDATE'
  ) or not pg_catalog.has_table_privilege(
    'authenticated', 'public.ht_labs_watchlist', 'DELETE'
  ) or pg_catalog.has_table_privilege(
    'authenticated', 'public.ht_labs_watchlist', 'TRUNCATE'
  ) or pg_catalog.has_table_privilege(
    'authenticated', 'public.ht_labs_watchlist', 'REFERENCES'
  ) or pg_catalog.has_table_privilege(
    'authenticated', 'public.ht_labs_watchlist', 'TRIGGER'
  ) then
    raise exception '0049 postflight: authenticated grants are not exact CRUD';
  end if;

  if pg_catalog.has_table_privilege(
    'anon', 'public.ht_labs_watchlist', 'SELECT'
  ) or pg_catalog.has_table_privilege(
    'anon', 'public.ht_labs_watchlist', 'INSERT'
  ) or pg_catalog.has_table_privilege(
    'anon', 'public.ht_labs_watchlist', 'UPDATE'
  ) or pg_catalog.has_table_privilege(
    'anon', 'public.ht_labs_watchlist', 'DELETE'
  ) or pg_catalog.has_table_privilege(
    'anon', 'public.ht_labs_watchlist', 'TRUNCATE'
  ) or pg_catalog.has_table_privilege(
    'anon', 'public.ht_labs_watchlist', 'REFERENCES'
  ) or pg_catalog.has_table_privilege(
    'anon', 'public.ht_labs_watchlist', 'TRIGGER'
  ) then
    raise exception '0049 postflight: anon retains a table privilege';
  end if;

  if not pg_catalog.has_table_privilege(
    'service_role', 'public.ht_labs_watchlist', 'SELECT'
  ) or not pg_catalog.has_table_privilege(
    'service_role', 'public.ht_labs_watchlist', 'INSERT'
  ) or not pg_catalog.has_table_privilege(
    'service_role', 'public.ht_labs_watchlist', 'UPDATE'
  ) or not pg_catalog.has_table_privilege(
    'service_role', 'public.ht_labs_watchlist', 'DELETE'
  ) or not pg_catalog.has_table_privilege(
    'service_role', 'public.ht_labs_watchlist', 'TRUNCATE'
  ) or not pg_catalog.has_table_privilege(
    'service_role', 'public.ht_labs_watchlist', 'REFERENCES'
  ) or not pg_catalog.has_table_privilege(
    'service_role', 'public.ht_labs_watchlist', 'TRIGGER'
  ) then
    raise exception '0049 postflight: service_role behavior was not preserved';
  end if;
end
$watchlist_contract_postflight$;

commit;
