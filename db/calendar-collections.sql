create table public.crm_calendars (like public.crm_calendar_events including defaults including constraints including indexes);
alter table public.crm_calendars add foreign key(user_id) references auth.users(id);
alter table public.crm_calendars enable row level security;
revoke all on public.crm_calendars from anon,authenticated;
grant select,insert,update on public.crm_calendars to service_role;
create index on public.crm_calendars(user_id,created_at,id);
do $$ declare f text; begin
 f:=pg_get_functiondef('public.crm_automation_commit(uuid,jsonb,text,jsonb,jsonb,text,boolean,text)'::regprocedure);
 if position('array[''calendar_events''' in f)=0 then raise exception 'Unexpected workflow function; review before changing.';end if;
 f:=replace(f,'array[''calendar_events''','array[''calendars'',''calendar_events''');
 execute f;
end $$;
notify pgrst,'reload schema';
