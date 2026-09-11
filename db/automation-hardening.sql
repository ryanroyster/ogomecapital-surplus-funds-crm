create unique index crm_provider_call_event on public.crm_call_sessions(user_id,(payload->>'provider_event_id')) where payload->>'provider_event_id' is not null;
-- Defense in depth for concurrent dispatchers and late backlog processing.
create function public.crm_message_send_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if new.payload->>'status'='sending' and old.payload->>'status' is distinct from 'sending' then
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,0));
  if new.payload->>'kind'='invitation' and exists(select 1 from public.crm_messages m where m.user_id=new.user_id and m.id<>new.id and m.payload->>'phone'=new.payload->>'phone' and m.payload->>'kind'='invitation' and (m.payload->>'attempted_at')::timestamptz>now()-interval '24 hours') then raise exception 'Invitation cadence requires 24 hours between attempts.'; end if;
 end if;
 return new;
end $$;
create trigger crm_message_send_guard before update on public.crm_messages for each row execute function public.crm_message_send_guard();
revoke all on function public.crm_message_send_guard() from public,anon,authenticated;
notify pgrst,'reload schema';
