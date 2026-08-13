-- Matchmaking retry-storm remediation.
--
-- The affected routines used SQLSTATE 40001 (serialization_failure) for
-- deterministic lifecycle conflicts. PostgREST clients and infrastructure may
-- retry 40001, so a persistent conflict could become an unbounded rollback
-- loop. Every branch below is a business conflict, not a database
-- serialization failure. Replace only the audited definitions with PT409,
-- which PostgREST maps to HTTP 409 Conflict.

begin;

do $remediation$
declare
  function_spec jsonb;
  target_oid oid;
  current_definition text;
  updated_definition text;
  current_body text;
  replacement_count integer;
  total_replacements integer := 0;
  before_owner oid;
  before_security_definer boolean;
  before_config text[];
  before_acl aclitem[];
  after_owner oid;
  after_security_definer boolean;
  after_config text[];
  after_acl aclitem[];
begin
  for function_spec in
    select value
    from jsonb_array_elements(
      jsonb_build_array(
        jsonb_build_object(
          'signature', 'public.claim_matchmaking_video_room(bigint)',
          'body_md5', '780116b91c9c4de3748f01f70110238a',
          'occurrences', 2
        ),
        jsonb_build_object(
          'signature', 'public.complete_matchmaking_video_room(bigint,text,text,text,text,timestamp with time zone)',
          'body_md5', '11cec0f62e90a51d127f44cfd9cdbb53',
          'occurrences', 2
        ),
        jsonb_build_object(
          'signature', 'public.fail_matchmaking_video_room(bigint,text)',
          'body_md5', '847c793a597b93e771db0a2764387997',
          'occurrences', 1
        ),
        jsonb_build_object(
          'signature', 'public.mm_begin_idempotent_operation(uuid,text,uuid,jsonb)',
          'body_md5', 'c4411a4ddf995d6d8cd0ae7b87243ed0',
          'occurrences', 1
        ),
        jsonb_build_object(
          'signature', 'public.request_business_connection_v2(uuid,text,uuid)',
          'body_md5', '40abe0023305dca08b78904255d42e64',
          'occurrences', 1
        ),
        jsonb_build_object(
          'signature', 'public.respond_business_connection_v2(bigint,text,integer,uuid)',
          'body_md5', '1cad5b19c6c2c87f9280f7c9f055ac7d',
          'occurrences', 2
        ),
        jsonb_build_object(
          'signature', 'public.respond_matchmaking_meeting(bigint,text,integer,uuid,bigint,jsonb,text,text)',
          'body_md5', '97fda794a317dc33493ee6c094e22b7b',
          'occurrences', 7
        ),
        jsonb_build_object(
          'signature', 'public.revise_matchmaking_meeting_proposal(bigint,integer,text,text,text,text,jsonb,uuid)',
          'body_md5', '274e9b214703c0178ab595b091502e53',
          'occurrences', 2
        ),
        jsonb_build_object(
          'signature', 'public.submit_matchmaking_meeting_outcome(bigint,text,text,text,timestamp with time zone,uuid)',
          'body_md5', 'a6a29d706d83e9699c5a1de256711a9c',
          'occurrences', 1
        ),
        jsonb_build_object(
          'signature', 'public.update_matchmaking_meeting_draft(bigint,integer,text,text,text,text,jsonb,uuid)',
          'body_md5', '44364b82c143e48eb4cac905e68c20a5',
          'occurrences', 1
        )
      )
    )
  loop
    target_oid := to_regprocedure(function_spec ->> 'signature');
    if target_oid is null then
      raise exception 'Required matchmaking routine is missing: %',
        function_spec ->> 'signature';
    end if;

    select
      p.prosrc,
      p.proowner,
      p.prosecdef,
      p.proconfig,
      p.proacl
    into
      current_body,
      before_owner,
      before_security_definer,
      before_config,
      before_acl
    from pg_proc p
    where p.oid = target_oid;

    if md5(current_body) <> function_spec ->> 'body_md5' then
      raise exception 'Unexpected definition for %; remediation stopped',
        function_spec ->> 'signature';
    end if;

    current_definition := pg_get_functiondef(target_oid);
    replacement_count := (
      length(current_definition) -
      length(replace(current_definition, 'errcode = ''40001''', ''))
    ) / length('errcode = ''40001''');

    if replacement_count <> (function_spec ->> 'occurrences')::integer then
      raise exception 'Expected % audited 40001 branches in %, found %',
        function_spec ->> 'occurrences',
        function_spec ->> 'signature',
        replacement_count;
    end if;

    updated_definition := replace(
      current_definition,
      'errcode = ''40001''',
      'errcode = ''PT409'''
    );
    execute updated_definition;
    total_replacements := total_replacements + replacement_count;

    select
      p.proowner,
      p.prosecdef,
      p.proconfig,
      p.proacl,
      p.prosrc
    into
      after_owner,
      after_security_definer,
      after_config,
      after_acl,
      current_body
    from pg_proc p
    where p.oid = target_oid;

    if after_owner is distinct from before_owner
       or after_security_definer is distinct from before_security_definer
       or after_config is distinct from before_config
       or after_acl is distinct from before_acl then
      raise exception 'Security metadata changed unexpectedly for %',
        function_spec ->> 'signature';
    end if;
    if current_body like '%errcode = ''40001''%'
       or current_body not like '%errcode = ''PT409''%' then
      raise exception 'Conflict contract replacement failed for %',
        function_spec ->> 'signature';
    end if;
  end loop;

  if total_replacements <> 20 then
    raise exception 'Expected 20 audited conflict replacements, applied %',
      total_replacements;
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosrc like '%errcode = ''40001''%'
  ) then
    raise exception 'An unaudited public 40001 branch remains';
  end if;
end
$remediation$;

notify pgrst, 'reload schema';

commit;
