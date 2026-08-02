begin;

do $contract$
begin
  if to_regclass('public.company_follows') is null then
    raise exception 'company_follows table is missing';
  end if;
  if to_regprocedure('public.follow_company(bigint)') is null
     or to_regprocedure('public.unfollow_company(bigint)') is null
     or to_regprocedure('public.get_my_followed_company_ids()') is null then
    raise exception 'company-follow RPC contract is incomplete';
  end if;
  if has_table_privilege('anon', 'public.company_follows', 'SELECT')
     or has_table_privilege('anon', 'public.company_follows', 'INSERT')
     or has_table_privilege('anon', 'public.company_follows', 'UPDATE')
     or has_table_privilege('anon', 'public.company_follows', 'DELETE') then
    raise exception 'anonymous company-follow access is not denied';
  end if;
  if has_function_privilege(
    'anon', 'public.follow_company(bigint)', 'EXECUTE'
  ) or has_function_privilege(
    'anon', 'public.unfollow_company(bigint)', 'EXECUTE'
  ) or has_function_privilege(
    'anon', 'public.get_my_followed_company_ids()', 'EXECUTE'
  ) then
    raise exception 'anonymous company-follow RPC execution is not denied';
  end if;
  if has_table_privilege('anon', 'public.favorites', 'INSERT')
     or has_table_privilege('anon', 'public.favorites', 'UPDATE')
     or has_table_privilege('anon', 'public.favorites', 'DELETE') then
    raise exception 'anonymous favorite mutation is not denied';
  end if;
end
$contract$;

do $rls$
declare
  v_user_one uuid := '10000000-0000-0000-0000-000000000001';
  v_user_two uuid := '10000000-0000-0000-0000-000000000002';
  v_company_id bigint;
begin
  insert into auth.users(id, email)
  values
    (v_user_one, 'marketplace-one@example.invalid'),
    (v_user_two, 'marketplace-two@example.invalid')
  on conflict (id) do nothing;

  insert into public.companies(name, type, is_approved, is_active)
  values ('Marketplace Follow Contract QA', 'distributor', true, true)
  returning id into v_company_id;

  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_user_one, 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;

  perform public.follow_company(v_company_id);
  perform public.follow_company(v_company_id);
  if (select count(*) from public.company_follows) <> 1 then
    raise exception 'duplicate follow was not suppressed';
  end if;
  if (select count(*) from public.get_my_followed_company_ids()) <> 1 then
    raise exception 'followed-company RPC did not return the owner row';
  end if;

  reset role;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_user_two, 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;
  if exists (select 1 from public.company_follows) then
    raise exception 'cross-user follow visibility was not denied';
  end if;
  if exists (select 1 from public.get_my_followed_company_ids()) then
    raise exception 'followed-company RPC leaked cross-user state';
  end if;
  perform public.unfollow_company(v_company_id);

  reset role;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_user_one, 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;
  perform public.unfollow_company(v_company_id);
  if exists (select 1 from public.company_follows) then
    raise exception 'follow was not removed';
  end if;

  reset role;
end
$rls$;

rollback;
