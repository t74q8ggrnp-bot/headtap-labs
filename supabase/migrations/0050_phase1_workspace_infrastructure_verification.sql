begin;

-- Read-only production proof for the two Phase 1 workspace migrations. The
-- application service role can call this through PostgREST; public clients
-- cannot. No product row, score, decision, order, or watchlist is modified.
create or replace function public.ht_phase1_workspace_infrastructure_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '1500ms'
as $phase1_health$
declare
  display_oid oid := pg_catalog.to_regclass('public.ht_stock_display_frames');
  watchlist_oid oid := pg_catalog.to_regclass('public.ht_labs_watchlist');
  publish_oid oid;
  authenticated_oid oid;
  anon_oid oid;
  service_role_oid oid;
  auth_users_oid oid;
  auth_user_id_attnum smallint;
  display_owner_oid oid;
  publish_owner_oid oid;
  publish_definition text;
  watchlist_owner_oid oid;
  watchlist_user_attnum smallint;
  watchlist_symbol_attnum smallint;
  display_table_ready boolean := false;
  display_rpc_ready boolean := false;
  display_access_ready boolean := false;
  watchlist_table_ready boolean := false;
  watchlist_constraints_ready boolean := false;
  watchlist_policies_ready boolean := false;
  watchlist_access_ready boolean := false;
  role_boundary_ready boolean := false;
begin
  select p.oid into publish_oid
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'ht_publish_stock_display_frames'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_candidates jsonb'
  limit 1;

  select r.oid into authenticated_oid
  from pg_catalog.pg_roles r
  where r.rolname = 'authenticated';
  select r.oid into anon_oid
  from pg_catalog.pg_roles r
  where r.rolname = 'anon';
  select r.oid into service_role_oid
  from pg_catalog.pg_roles r
  where r.rolname = 'service_role';
  select c.oid into auth_users_oid
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'auth' and c.relname = 'users' and c.relkind = 'r';
  if auth_users_oid is not null then
    select a.attnum into auth_user_id_attnum
    from pg_catalog.pg_attribute a
    where a.attrelid = auth_users_oid and a.attname = 'id'
      and a.attnum > 0 and not a.attisdropped;
  end if;

  role_boundary_ready :=
    coalesce(
      authenticated_oid is not null and anon_oid is not null and
      service_role_oid is not null and
      (select not r.rolbypassrls from pg_catalog.pg_roles r where r.oid = authenticated_oid) and
      (select not r.rolbypassrls from pg_catalog.pg_roles r where r.oid = anon_oid) and
      (select r.rolbypassrls from pg_catalog.pg_roles r where r.oid = service_role_oid),
      false
    );

  if display_oid is not null then
    select c.relkind = 'r' and c.relrowsecurity and not c.relforcerowsecurity
      and not exists (
        select 1
        from pg_catalog.pg_policy p
        where p.polrelid = display_oid
      )
      and (
        select count(*) = 8
        from pg_catalog.pg_attribute a
        where a.attrelid = display_oid
          and a.attnum > 0
          and not a.attisdropped
      )
      and (
        select count(*) = 8
        from pg_catalog.pg_attribute a
        where a.attrelid = display_oid
          and a.attnum > 0
          and not a.attisdropped
          and (
            (a.attname = 'symbol' and a.atttypid = 'pg_catalog.text'::pg_catalog.regtype and a.attnotnull)
            or (a.attname = 'frame_bucket' and a.atttypid = 'pg_catalog.int8'::pg_catalog.regtype and a.attnotnull)
            or (a.attname = 'price' and a.atttypid = 'pg_catalog.numeric'::pg_catalog.regtype and a.attnotnull)
            or (a.attname = 'provider_as_of' and a.atttypid = 'pg_catalog.timestamptz'::pg_catalog.regtype and a.attnotnull)
            or (a.attname = 'source' and a.atttypid = 'pg_catalog.text'::pg_catalog.regtype and a.attnotnull)
            or (a.attname = 'price_kind' and a.atttypid = 'pg_catalog.text'::pg_catalog.regtype and a.attnotnull)
            or (a.attname = 'trade_size' and a.atttypid = 'pg_catalog.numeric'::pg_catalog.regtype and not a.attnotnull)
            or (a.attname = 'updated_at' and a.atttypid = 'pg_catalog.timestamptz'::pg_catalog.regtype and a.attnotnull)
          )
      )
      and (
        select count(*) = 1 and pg_catalog.bool_and(
          a.attname = 'updated_at'
          and pg_catalog.regexp_replace(
            pg_catalog.lower(pg_catalog.pg_get_expr(d.adbin, d.adrelid, true)),
            '[[:space:]()]', '', 'g'
          ) = 'clock_timestamp'
        )
        from pg_catalog.pg_attrdef d
        join pg_catalog.pg_attribute a
          on a.attrelid = d.adrelid and a.attnum = d.adnum
        where d.adrelid = display_oid
      )
      and exists (
        select 1
        from pg_catalog.pg_constraint k
        join pg_catalog.pg_attribute a
          on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
        where k.conrelid = display_oid
          and k.contype = 'p'
          and pg_catalog.cardinality(k.conkey) = 1
          and a.attname = 'symbol'
          and k.convalidated
          and not k.condeferrable
          and not k.condeferred
      )
      and (
        select count(*) = 6 and pg_catalog.bool_and(
          k.convalidated
          and not k.connoinherit
          and case k.conname
            when 'ht_stock_display_frames_symbol_check' then
              constraint_expression.normalized = 'symbol~''^[a-z][a-z0-9.-]{0,9}$''::text'
              and pg_catalog.strpos(
                constraint_expression.original,
                '''^[A-Z][A-Z0-9.-]{0,9}$'''
              ) > 0
            when 'ht_stock_display_frames_frame_bucket_check' then
              constraint_expression.normalized = 'frame_bucket>0'
            when 'ht_stock_display_frames_price_check' then
              constraint_expression.normalized = 'price>0::numeric'
            when 'ht_stock_display_frames_source_check' then
              constraint_expression.normalized = 'source=anyarray[''massive_polygon_last_trade''::text,''massive_polygon_snapshot''::text]'
            when 'ht_stock_display_frames_price_kind_check' then
              constraint_expression.normalized = 'price_kind=anyarray[''trade''::text,''minute_aggregate''::text]'
            when 'ht_stock_display_frames_trade_size_check' then
              constraint_expression.normalized = 'trade_sizeisnullortrade_size>=0::numeric'
            else false
          end
        )
        from pg_catalog.pg_constraint k
        cross join lateral (
          select
            pg_catalog.pg_get_expr(k.conbin, k.conrelid, true) as original,
            pg_catalog.regexp_replace(
              pg_catalog.lower(
                pg_catalog.pg_get_expr(k.conbin, k.conrelid, true)
              ),
              '[[:space:]()]', '', 'g'
            ) as normalized
        ) constraint_expression
        where k.conrelid = display_oid and k.contype = 'c'
      )
    into display_table_ready
    from pg_catalog.pg_class c
    where c.oid = display_oid;

    select c.relowner into display_owner_oid
    from pg_catalog.pg_class c where c.oid = display_oid;

    display_access_ready :=
      pg_catalog.has_table_privilege(
        'service_role', 'public.ht_stock_display_frames', 'SELECT'
      )
      and not pg_catalog.has_table_privilege('service_role', 'public.ht_stock_display_frames', 'INSERT')
      and not pg_catalog.has_table_privilege('service_role', 'public.ht_stock_display_frames', 'UPDATE')
      and not pg_catalog.has_table_privilege('service_role', 'public.ht_stock_display_frames', 'DELETE')
      and not pg_catalog.has_table_privilege('service_role', 'public.ht_stock_display_frames', 'TRUNCATE')
      and not pg_catalog.has_table_privilege('service_role', 'public.ht_stock_display_frames', 'REFERENCES')
      and not pg_catalog.has_table_privilege('service_role', 'public.ht_stock_display_frames', 'TRIGGER')
      and not pg_catalog.has_table_privilege(
        'anon', 'public.ht_stock_display_frames', 'SELECT'
      )
      and not pg_catalog.has_table_privilege(
        'authenticated', 'public.ht_stock_display_frames', 'SELECT'
      )
      and not exists (
        select 1
        from pg_catalog.pg_class c
        cross join lateral pg_catalog.aclexplode(c.relacl) acl
        where c.oid = display_oid
          and acl.grantee not in (display_owner_oid, service_role_oid)
      )
      and not exists (
        select 1
        from pg_catalog.pg_attribute a
        cross join lateral pg_catalog.aclexplode(a.attacl) acl
        where a.attrelid = display_oid
          and a.attnum > 0
          and not a.attisdropped
          and acl.grantee <> display_owner_oid
      );
  end if;

  if publish_oid is not null then
    select p.proowner,
      pg_catalog.lower(
        pg_catalog.regexp_replace(
          pg_catalog.pg_get_functiondef(p.oid), '[[:space:]]', '', 'g'
        )
      )
    into publish_owner_oid, publish_definition
    from pg_catalog.pg_proc p
    where p.oid = publish_oid;

    display_rpc_ready :=
      exists (
        select 1
        from pg_catalog.pg_proc p
        where p.oid = publish_oid
          and p.prorettype = 'pg_catalog.jsonb'::pg_catalog.regtype
          and not p.proretset
          and p.prokind = 'f'
          and p.prosecdef
          and p.provolatile = 'v'
          and p.prolang = (
            select l.oid from pg_catalog.pg_language l
            where l.lanname = 'plpgsql'
          )
          and 'search_path=""' = any(coalesce(p.proconfig, array[]::text[]))
          and 'statement_timeout=1500ms' = any(coalesce(p.proconfig, array[]::text[]))
          and 'lock_timeout=500ms' = any(coalesce(p.proconfig, array[]::text[]))
          and pg_catalog.cardinality(p.proconfig) = 3
      )
      and publish_owner_oid = display_owner_oid
      and publish_definition is not null
      and pg_catalog.strpos(publish_definition, 'jsonb_typeof(p_candidates)<>''array''') > 0
      and pg_catalog.strpos(publish_definition, 'jsonb_array_length(p_candidates)notbetween1and250') > 0
      and pg_catalog.strpos(publish_definition, 'candidate_as_of>clock_timestamp()+interval''2seconds''') > 0
      and pg_catalog.strpos(publish_definition, 'candidate_sourcenotin(''massive_polygon_last_trade'',''massive_polygon_snapshot'')') > 0
      and pg_catalog.strpos(publish_definition, 'candidate_kindnotin(''trade'',''minute_aggregate'')') > 0
      and pg_catalog.strpos(publish_definition, 'onconflict(symbol)doupdateset') > 0
      and pg_catalog.strpos(publish_definition, 'excluded.provider_as_of>=ht_stock_display_frames.provider_as_of') > 0
      and pg_catalog.strpos(publish_definition, 'whereexcluded.frame_bucket>ht_stock_display_frames.frame_bucket') > 0
      and pg_catalog.strpos(publish_definition, 'select*intostrictselectedfrompublic.ht_stock_display_frameswheresymbol=candidate_symbol') > 0
      and pg_catalog.strpos(publish_definition, '''frameversion'',''stock-display-frame-v1''') > 0
      and pg_catalog.strpos(publish_definition, '''coordination'',''database''') > 0
      and pg_catalog.strpos(publish_definition, 'jsonb_to_recordset') = 0
      and
      pg_catalog.has_function_privilege('service_role', publish_oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('anon', publish_oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege(
        'authenticated', publish_oid, 'EXECUTE'
      )
      and not exists (
        select 1
        from pg_catalog.pg_proc p
        cross join lateral pg_catalog.aclexplode(p.proacl) acl
        where p.oid = publish_oid
          and acl.grantee not in (publish_owner_oid, service_role_oid)
      );
  end if;

  if watchlist_oid is not null and authenticated_oid is not null
      and auth_users_oid is not null and auth_user_id_attnum is not null then
    select a.attnum into watchlist_user_attnum
    from pg_catalog.pg_attribute a
    where a.attrelid = watchlist_oid and a.attname = 'user_id'
      and a.attnum > 0 and not a.attisdropped;
    select a.attnum into watchlist_symbol_attnum
    from pg_catalog.pg_attribute a
    where a.attrelid = watchlist_oid and a.attname = 'symbol'
      and a.attnum > 0 and not a.attisdropped;
    select c.relowner into watchlist_owner_oid
    from pg_catalog.pg_class c where c.oid = watchlist_oid;

    select c.relkind = 'r' and c.relrowsecurity and c.relforcerowsecurity
      and not exists (
        select 1
        from pg_catalog.pg_attribute a
        where a.attrelid = watchlist_oid
          and a.attnum > 0
          and not a.attisdropped
          and a.attname in ('user_id', 'symbol')
          and not a.attnotnull
      )
      and (
        select count(*) = 2
        from pg_catalog.pg_attribute a
        where a.attrelid = watchlist_oid
          and a.attnum > 0
          and not a.attisdropped
          and a.attname in ('user_id', 'symbol')
          and (
            (a.attname = 'user_id' and a.atttypid = 'pg_catalog.uuid'::pg_catalog.regtype)
            or (a.attname = 'symbol' and a.atttypid = 'pg_catalog.text'::pg_catalog.regtype)
          )
      )
    into watchlist_table_ready
    from pg_catalog.pg_class c
    where c.oid = watchlist_oid;

    watchlist_constraints_ready :=
      exists (
        select 1 from pg_catalog.pg_constraint c
        where c.conrelid = watchlist_oid
          and c.conname = 'ht_labs_watchlist_user_id_symbol_key'
          and c.contype = 'u'
          and c.conkey = array[watchlist_user_attnum, watchlist_symbol_attnum]::smallint[]
          and c.convalidated
          and not c.condeferrable
          and not c.condeferred
      )
      and exists (
        select 1 from pg_catalog.pg_constraint c
        where c.conrelid = watchlist_oid
          and c.conname = 'ht_labs_watchlist_user_id_fkey'
          and c.contype = 'f'
          and c.conkey = array[watchlist_user_attnum]::smallint[]
          and c.confrelid = auth_users_oid
          and c.confkey = array[auth_user_id_attnum]::smallint[]
          and c.confdeltype = 'c'
          and c.confupdtype = 'a'
          and c.confmatchtype = 's'
          and c.convalidated
          and not c.condeferrable
          and not c.condeferred
      )
      and exists (
        select 1 from pg_catalog.pg_constraint c
        where c.conrelid = watchlist_oid
          and c.conname = 'ht_labs_watchlist_symbol_format_check'
          and c.contype = 'c'
          and c.convalidated
          and not c.connoinherit
          and pg_catalog.strpos(
            pg_catalog.pg_get_expr(c.conbin, c.conrelid, true),
            '''^[A-Z0-9][A-Z0-9./^-]{0,31}$'''
          ) > 0
          and pg_catalog.regexp_replace(
            pg_catalog.lower(
              pg_catalog.pg_get_expr(c.conbin, c.conrelid, true)
            ),
            '[[:space:]()]', '', 'g'
          ) in (
            'symbol=upper(symbol)andsymbol~''^[a-z0-9][a-z0-9./^-]{0,31}$''::text',
            'symbol=pg_catalog.upper(symbol)andsymbol~''^[a-z0-9][a-z0-9./^-]{0,31}$''::text'
          )
      )
      and (
        select count(*) = 3
        from pg_catalog.pg_constraint c
        where c.conrelid = watchlist_oid
          and c.contype in ('u', 'f', 'c')
          and c.conkey && array[watchlist_user_attnum, watchlist_symbol_attnum]::smallint[]
      );

    watchlist_policies_ready :=
      (
        select count(*) = 4
        from pg_catalog.pg_policy p
        where p.polrelid = watchlist_oid
      )
      and not exists (
        select 1
        from pg_catalog.pg_policy p
        cross join lateral (
          select
            case when p.polqual is null then null else
              pg_catalog.replace(
                pg_catalog.replace(
                  pg_catalog.regexp_replace(
                    pg_catalog.lower(
                      pg_catalog.pg_get_expr(p.polqual, p.polrelid, true)
                    ),
                    '[[:space:]()]', '', 'g'
                  ),
                  'select', ''
                ),
                'asuid', ''
              )
            end as qual_normalized,
            case when p.polwithcheck is null then null else
              pg_catalog.replace(
                pg_catalog.replace(
                  pg_catalog.regexp_replace(
                    pg_catalog.lower(
                      pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid, true)
                    ),
                    '[[:space:]()]', '', 'g'
                  ),
                  'select', ''
                ),
                'asuid', ''
              )
            end as check_normalized
        ) policy_expression
        where p.polrelid = watchlist_oid
          and (
            p.polname not in (
              'ht_labs_watchlist_owner_select',
              'ht_labs_watchlist_owner_insert',
              'ht_labs_watchlist_owner_update',
              'ht_labs_watchlist_owner_delete'
            )
            or not p.polpermissive
            or p.polroles <> array[authenticated_oid]::oid[]
            or not coalesce(case p.polname
              when 'ht_labs_watchlist_owner_select' then (
                p.polcmd = 'r'
                and policy_expression.qual_normalized = 'auth.uid=user_id'
                and policy_expression.check_normalized is null
              )
              when 'ht_labs_watchlist_owner_insert' then (
                p.polcmd = 'a'
                and policy_expression.qual_normalized is null
                and policy_expression.check_normalized = 'auth.uid=user_id'
              )
              when 'ht_labs_watchlist_owner_update' then (
                p.polcmd = 'w'
                and policy_expression.qual_normalized = 'auth.uid=user_id'
                and policy_expression.check_normalized = 'auth.uid=user_id'
              )
              when 'ht_labs_watchlist_owner_delete' then (
                p.polcmd = 'd'
                and policy_expression.qual_normalized = 'auth.uid=user_id'
                and policy_expression.check_normalized is null
              )
              else false
            end, false)
          )
      );

    watchlist_access_ready :=
      pg_catalog.has_table_privilege('authenticated', 'public.ht_labs_watchlist', 'SELECT')
      and pg_catalog.has_table_privilege('authenticated', 'public.ht_labs_watchlist', 'INSERT')
      and pg_catalog.has_table_privilege('authenticated', 'public.ht_labs_watchlist', 'UPDATE')
      and pg_catalog.has_table_privilege('authenticated', 'public.ht_labs_watchlist', 'DELETE')
      and not pg_catalog.has_table_privilege('authenticated', 'public.ht_labs_watchlist', 'TRUNCATE')
      and not pg_catalog.has_table_privilege('authenticated', 'public.ht_labs_watchlist', 'REFERENCES')
      and not pg_catalog.has_table_privilege('authenticated', 'public.ht_labs_watchlist', 'TRIGGER')
      and not pg_catalog.has_table_privilege('anon', 'public.ht_labs_watchlist', 'SELECT')
      and not pg_catalog.has_table_privilege('anon', 'public.ht_labs_watchlist', 'INSERT')
      and not pg_catalog.has_table_privilege('anon', 'public.ht_labs_watchlist', 'UPDATE')
      and not pg_catalog.has_table_privilege('anon', 'public.ht_labs_watchlist', 'DELETE')
      and not pg_catalog.has_table_privilege('anon', 'public.ht_labs_watchlist', 'TRUNCATE')
      and not pg_catalog.has_table_privilege('anon', 'public.ht_labs_watchlist', 'REFERENCES')
      and not pg_catalog.has_table_privilege('anon', 'public.ht_labs_watchlist', 'TRIGGER')
      and pg_catalog.has_table_privilege('service_role', 'public.ht_labs_watchlist', 'SELECT')
      and pg_catalog.has_table_privilege('service_role', 'public.ht_labs_watchlist', 'INSERT')
      and pg_catalog.has_table_privilege('service_role', 'public.ht_labs_watchlist', 'UPDATE')
      and pg_catalog.has_table_privilege('service_role', 'public.ht_labs_watchlist', 'DELETE')
      and pg_catalog.has_table_privilege('service_role', 'public.ht_labs_watchlist', 'TRUNCATE')
      and pg_catalog.has_table_privilege('service_role', 'public.ht_labs_watchlist', 'REFERENCES')
      and pg_catalog.has_table_privilege('service_role', 'public.ht_labs_watchlist', 'TRIGGER')
      and not exists (
        select 1
        from pg_catalog.pg_class c
        cross join lateral pg_catalog.aclexplode(c.relacl) acl
        where c.oid = watchlist_oid
          and acl.grantee not in (watchlist_owner_oid, authenticated_oid, service_role_oid)
      )
      and not exists (
        select 1
        from pg_catalog.pg_attribute a
        cross join lateral pg_catalog.aclexplode(a.attacl) acl
        where a.attrelid = watchlist_oid
          and a.attnum > 0
          and not a.attisdropped
          and acl.grantee <> watchlist_owner_oid
      );
  end if;

  return pg_catalog.jsonb_build_object(
    'contractVersion', 'phase1-workspace-infrastructure-v1',
    'migration0048', pg_catalog.jsonb_build_object(
      'verified', coalesce(display_table_ready, false)
        and coalesce(display_rpc_ready, false)
        and coalesce(display_access_ready, false),
      'tableReady', coalesce(display_table_ready, false),
      'publicationRpcReady', coalesce(display_rpc_ready, false),
      'accessBoundaryReady', coalesce(display_access_ready, false)
    ),
    'migration0049', pg_catalog.jsonb_build_object(
      'verified', coalesce(watchlist_table_ready, false)
        and coalesce(watchlist_constraints_ready, false)
        and coalesce(watchlist_policies_ready, false)
        and coalesce(watchlist_access_ready, false)
        and coalesce(role_boundary_ready, false),
      'tableReady', coalesce(watchlist_table_ready, false),
      'constraintsReady', coalesce(watchlist_constraints_ready, false),
      'policiesReady', coalesce(watchlist_policies_ready, false),
      'accessBoundaryReady', coalesce(watchlist_access_ready, false),
      'roleBoundaryReady', coalesce(role_boundary_ready, false)
    ),
    'verifiedAt', pg_catalog.clock_timestamp()
  );
exception when others then
  return pg_catalog.jsonb_build_object(
    'contractVersion', 'phase1-workspace-infrastructure-v1',
    'migration0048', pg_catalog.jsonb_build_object('verified', false),
    'migration0049', pg_catalog.jsonb_build_object('verified', false),
    'errorCode', sqlstate,
    'verifiedAt', pg_catalog.clock_timestamp()
  );
end
$phase1_health$;

-- CREATE OR REPLACE retains prior ACLs. Remove any non-owner/non-service-role
-- grants as well as the default PUBLIC grant so this SECURITY DEFINER verifier
-- remains service-role-only even when the migration is safely re-run.
do $phase1_health_revoke_legacy_grants$
declare
  health_oid oid;
  health_owner_oid oid;
  service_oid oid;
  grant_record record;
  grantee_sql text;
begin
  select p.oid, p.proowner
  into health_oid, health_owner_oid
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'ht_phase1_workspace_infrastructure_health'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) = '';

  select r.oid into service_oid
  from pg_catalog.pg_roles r
  where r.rolname = 'service_role';

  if health_oid is null or service_oid is null then
    raise exception '0050 ACL postflight: health function or service_role is missing';
  end if;

  for grant_record in
    select distinct acl.grantee
    from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(p.proacl) acl
    where p.oid = health_oid
      and acl.grantee not in (health_owner_oid, service_oid)
  loop
    if grant_record.grantee = 0 then
      grantee_sql := 'public';
    else
      select pg_catalog.quote_ident(r.rolname)
      into grantee_sql
      from pg_catalog.pg_roles r
      where r.oid = grant_record.grantee;
      if grantee_sql is null then
        raise exception '0050 ACL postflight: function ACL references unknown role oid %',
          grant_record.grantee;
      end if;
    end if;

    execute 'revoke all privileges on function '
      || 'public.ht_phase1_workspace_infrastructure_health() from '
      || grantee_sql || ' cascade';
  end loop;
end
$phase1_health_revoke_legacy_grants$;

revoke all on function public.ht_phase1_workspace_infrastructure_health()
  from public, anon, authenticated, service_role;
grant execute on function public.ht_phase1_workspace_infrastructure_health()
  to service_role;

notify pgrst, 'reload schema';
commit;
