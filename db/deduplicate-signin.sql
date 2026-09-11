-- Archive only duplicate payloads differing in ID/checklist encoding. Never merge different case data.
create table public.crm_lead_duplicate_archive (
 user_id uuid not null, record_id text not null, canonical_id text not null,
 payload jsonb not null, updated_at timestamptz not null, archived_at timestamptz not null default now(), primary key(user_id,record_id)
);
alter table public.crm_lead_duplicate_archive enable row level security;
revoke all on public.crm_lead_duplicate_archive from anon,authenticated;
grant select on public.crm_lead_duplicate_archive to service_role;
-- Canonical IDs use the earliest audit record, then deterministic ID order.
do $$ declare g record; r record; keep_id text; merged jsonb; begin
 for g in select user_id,payload-'id'-'checks' identity from public.crm_leads group by user_id,payload-'id'-'checks' having count(*)>1 loop
  select l.record_id into keep_id from public.crm_leads l where l.user_id=g.user_id and l.payload-'id'-'checks'=g.identity
  order by (select min(a.created_at) from public.crm_audit_events a where a.user_id=l.user_id and a.entity_type='leads' and a.entity_id=l.record_id),l.record_id limit 1;
  select payload->'checks' into merged from public.crm_leads where user_id=g.user_id and record_id=keep_id;
  for r in select * from public.crm_leads where user_id=g.user_id and payload-'id'-'checks'=g.identity and record_id<>keep_id loop
   insert into public.crm_lead_duplicate_archive(user_id,record_id,canonical_id,payload,updated_at) values(r.user_id,r.record_id,keep_id,r.payload,r.updated_at);
   merged:=coalesce(r.payload->'checks','{}')||coalesce(merged,'{}');
   update public.crm_tasks set lead_record_id=keep_id where user_id=r.user_id and lead_record_id=r.record_id;
   update public.crm_claims set lead_record_id=keep_id where user_id=r.user_id and lead_record_id=r.record_id;
   update public.crm_payments set lead_record_id=keep_id where user_id=r.user_id and lead_record_id=r.record_id;
   insert into public.crm_audit_events(user_id,entity_type,entity_id,action,metadata) values(r.user_id,'leads',keep_id,'duplicate_archived',jsonb_build_object('archived_record_id',r.record_id,'reason','Identical claim payload recreated during sign-in'));
   delete from public.crm_leads where user_id=r.user_id and record_id=r.record_id;
  end loop;
  -- Correct known malformed legacy checkbox label; keep all other information.
  if merged ? 'Excess ��� $30K' then merged:=(merged-'Excess ��� $30K')||jsonb_build_object('Excess ≥ $30K',coalesce(merged->'Excess ≥ $30K',merged->'Excess ��� $30K')); end if;
  update public.crm_leads set payload=jsonb_set(payload,'{checks}',merged) where user_id=g.user_id and record_id=keep_id;
 end loop;
end $$;
create function public.crm_reject_archived_duplicate() returns trigger language plpgsql set search_path='' as $$
begin
 if exists(select 1 from public.crm_lead_duplicate_archive where user_id=new.user_id and record_id=new.record_id) then
 raise exception 'Duplicate ID retired. Refresh the CRM to download canonical cloud leads.' using errcode='23505';
 end if;
 return new;
end $$;
create trigger crm_reject_archived_duplicate before insert on public.crm_leads for each row execute function public.crm_reject_archived_duplicate();
revoke all on function public.crm_reject_archived_duplicate() from public,anon,authenticated;
