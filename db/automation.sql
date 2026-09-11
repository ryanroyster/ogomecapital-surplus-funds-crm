-- Additive automation schema. Applied through Supabase migration history.
-- All writes are server mediated; no new browser role grants.
create table public.crm_calendar_events (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
 lead_record_id text, payload jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(user_id,lead_record_id) references public.crm_leads(user_id,record_id)
);
do $$ declare t text; begin
 foreach t in array array['call_sessions','call_transcripts','ai_summaries','action_proposals','assistant_actions','messaging_campaigns','messages','messaging_consents','contract_evidence'] loop
 execute format('create table public.crm_%I (like public.crm_calendar_events including defaults including constraints including indexes)',t);
 execute format('alter table public.crm_%I add foreign key (user_id) references auth.users(id)',t);
 execute format('alter table public.crm_%I add foreign key (user_id,lead_record_id) references public.crm_leads(user_id,record_id)',t);
 end loop;
 foreach t in array array['calendar_events','call_sessions','call_transcripts','ai_summaries','action_proposals','assistant_actions','messaging_campaigns','messages','messaging_consents','contract_evidence'] loop
 execute format('alter table public.crm_%I enable row level security',t);
 execute format('revoke all on public.crm_%I from anon, authenticated',t);
 execute format('grant select,insert,update,delete on public.crm_%I to service_role',t);
 execute format('create index on public.crm_%I (user_id,created_at,id)',t);
 execute format('create index on public.crm_%I (user_id,lead_record_id)',t);
 end loop;
end $$;
create unique index crm_sms_phone_consent on public.crm_messaging_consents(user_id,(payload->>'phone'));
create unique index crm_provider_message on public.crm_messages(user_id,(payload->>'provider_id')) where payload->>'provider_id' is not null;
create unique index crm_call_transcript_once on public.crm_call_transcripts(user_id,(payload->>'session_id'));
create unique index crm_call_summary_once on public.crm_ai_summaries(user_id,(payload->>'session_id'));
create unique index crm_call_action_once on public.crm_action_proposals(user_id,(payload->>'session_id')) where payload->>'session_id' is not null;

-- Reject stale legacy lead uploads after automation, preserving the existing payload layout.
create function public.crm_guard_automation_revision() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' and coalesce(new.payload->>'_automation_revision','0') <> coalesce(old.payload->>'_automation_revision','0') and
    coalesce(current_setting('crm.automation_write',true),'') <> 'yes' then
   raise exception 'Lead changed through automation. Download cloud changes before saving.' using errcode='40001';
 end if;
 if new.payload->>'stage'='Signed Contract' and (tg_op='INSERT' or old.payload->>'stage' is distinct from 'Signed Contract') then
   if not exists(select 1 from public.crm_contract_evidence e where e.user_id=new.user_id and e.lead_record_id=new.record_id
    and e.payload->>'reference'<>'' and e.payload->>'verified_by'<>'' and
    (e.payload->>'kind' in ('executed_agreement','esign_confirmation') or
     (e.payload->>'kind'='counsel_approved_verbal' and e.payload->>'counsel_reference'<>''))) then
     raise exception 'Verified contract evidence is required for Signed Contract.';
   end if;
 end if;
 return new;
end $$;
create trigger crm_guard_automation_revision before insert or update on public.crm_leads for each row execute function public.crm_guard_automation_revision();

-- One transaction owns each workflow: row checks, writes, lead append and audit all succeed or roll back.
create function public.crm_automation_commit(p_user uuid,p_writes jsonb,p_lead text default null,p_expected jsonb default null,p_patch jsonb default null,p_note text default null,p_clearance boolean default false,p_sms_phone text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare w jsonb; t text; r jsonb; prior jsonb; lid uuid; l jsonb; out_rows jsonb:='[]'; stamp timestamptz:=clock_timestamp();
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 if p_lead is not null then
  select payload into l from public.crm_leads where user_id=p_user and record_id=p_lead for update;
  if l is null then raise exception 'Lead unavailable'; end if;
  if p_expected is not null and l<>p_expected then raise exception 'Lead changed. Refresh and review again.' using errcode='40001'; end if;
  if p_clearance and coalesce(l->>'compliance_status','')<>'CLEARED' then raise exception 'Compliance Clearance must be CLEARED.'; end if;
 end if;
 if p_sms_phone is not null then
  if coalesce(l->>'compliance_status','')<>'CLEARED' or not (coalesce(l->>'qualification_status','')='Qualified' or coalesce(l->>'stage','')='Qualified') or coalesce(l->>'dnc','false')='true' then raise exception 'Lead is not eligible for SMS.'; end if;
  if not exists(select 1 from public.crm_messaging_consents where user_id=p_user and lead_record_id=p_lead and payload->>'phone'=p_sms_phone and payload->>'status'='opted_in' and coalesce(payload->>'dnc','false')='false') then raise exception 'Valid SMS consent required.'; end if;
 end if;
 for w in select value from jsonb_array_elements(p_writes) loop
  t:=w->>'table';
  if not t=any(array['calendar_events','call_sessions','call_transcripts','ai_summaries','action_proposals','assistant_actions','messaging_campaigns','messages','messaging_consents','contract_evidence','tasks']) then raise exception 'Unsupported entity'; end if;
  lid:=(w->'row'->>'id')::uuid;
  execute format('select to_jsonb(x) from public.crm_%I x where id=$1 for update',t) into prior using lid;
  if prior is not null then
   if prior->>'user_id'<>p_user::text then raise exception 'Record unavailable'; end if;
   if w->>'expected_at' is null or (prior->>'updated_at')::timestamptz<>(w->>'expected_at')::timestamptz then raise exception 'Record changed. Refresh and review again.' using errcode='40001'; end if;
  elsif w->>'expected_at' is not null then raise exception 'Record unavailable'; end if;
  r:=coalesce(prior,'{}'::jsonb)||(w->'row')||jsonb_build_object('user_id',p_user,'updated_at',stamp,'created_at',coalesce(prior->'created_at',to_jsonb(stamp)));
  if r->>'lead_record_id' is not null and not exists(select 1 from public.crm_leads where user_id=p_user and record_id=r->>'lead_record_id') then raise exception 'Related lead unavailable'; end if;
  if t='calendar_events' and r->'payload'->>'status'='scheduled' and r->'payload'->>'kind' in ('appointment','callback','attorney_meeting') then
   if exists(select 1 from public.crm_calendar_events e where e.user_id=p_user and e.id<>lid and e.payload->>'status'='scheduled' and e.payload->>'kind' in ('appointment','callback','attorney_meeting') and (e.payload->>'start_at')::timestamptz < (r->'payload'->>'end_at')::timestamptz and (e.payload->>'end_at')::timestamptz > (r->'payload'->>'start_at')::timestamptz) then raise exception 'This time overlaps another appointment. Choose another slot.'; end if;
  end if;
  if prior is not null then
   if t='tasks' then
    execute 'update public.crm_tasks set title=$1,status=$2,priority=$3,due_at=$4,notes=$5,updated_at=$6 where id=$7' using r->>'title',r->>'status',r->>'priority',(r->>'due_at')::timestamptz,r->>'notes',stamp,lid;
   else
    execute format('update public.crm_%I set payload=$1,updated_at=$2 where id=$3',t) using r->'payload',stamp,lid;
   end if;
  else
   execute format('insert into public.crm_%I select * from jsonb_populate_record(null::public.crm_%I,$1)',t,t) using r;
  end if;
  insert into public.crm_audit_events(user_id,entity_type,entity_id,action,metadata) values(p_user,t,lid::text,coalesce(w->>'action',case when prior is null then 'created' else 'updated' end),jsonb_build_object('lead_record_id',r->>'lead_record_id','workflow','automation','fields',case when t='tasks' then '[]'::jsonb else (select jsonb_agg(key) from jsonb_object_keys(coalesce(r->'payload','{}')) key) end));
  out_rows:=out_rows||jsonb_build_array(r);
 end loop;
 if p_patch is not null or p_note is not null then
  if p_lead is null then raise exception 'Lead required'; end if;
  perform set_config('crm.automation_write','yes',true);
  l:=l||coalesce(p_patch,'{}');
  if p_note is not null then l:=l||jsonb_build_object('notes',concat_ws(E'\n\n',nullif(l->>'notes',''),p_note)); end if;
  l:=l||jsonb_build_object('_automation_revision',coalesce((l->>'_automation_revision')::int,0)+1);
  update public.crm_leads set payload=l,updated_at=stamp where user_id=p_user and record_id=p_lead;
  insert into public.crm_audit_events(user_id,entity_type,entity_id,action,metadata) values(p_user,'leads',p_lead,'automation_updated',jsonb_build_object('fields',(select jsonb_agg(key) from jsonb_object_keys(coalesce(p_patch,'{}')) key),'note_appended',p_note is not null));
 end if;
 return jsonb_build_object('items',out_rows,'lead',l);
end $$;
revoke all on function public.crm_automation_commit(uuid,jsonb,text,jsonb,jsonb,text,boolean,text) from public,anon,authenticated;
grant execute on function public.crm_automation_commit(uuid,jsonb,text,jsonb,jsonb,text,boolean,text) to service_role;
revoke all on function public.crm_guard_automation_revision() from public,anon,authenticated;
-- Recordings remain private. Access only through the authenticated server route.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('crm-call-recordings','crm-call-recordings',false,20971520,array['audio/mpeg','audio/mp4','audio/wav','audio/x-wav','audio/webm','audio/ogg']) on conflict(id) do nothing;
notify pgrst, 'reload schema';
