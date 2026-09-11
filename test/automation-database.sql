-- Run as a database administrator. Every synthetic record is rolled back.
begin;
do $$
declare u uuid; lid text:=gen_random_uuid()::text; eid uuid:=gen_random_uuid(); out_json jsonb; l jsonb; stale jsonb; caught boolean;
begin
 select id into u from auth.users order by created_at limit 1;
 if u is null then raise exception 'A workspace is required for this rolled-back test'; end if;
 l:=jsonb_build_object('id',lid,'name','Synthetic test only','stage','Qualified','qualification_status','Qualified','compliance_status','CLEARED','notes','Original note');
 insert into public.crm_leads(user_id,record_id,payload) values(u,lid,l);
 out_json:=public.crm_automation_commit(u,jsonb_build_array(jsonb_build_object('table','calendar_events','row',jsonb_build_object('id',eid,'lead_record_id',lid,'payload',jsonb_build_object('title','Synthetic appointment','kind','appointment','status','scheduled','start_at','2099-01-01T10:00:00Z','end_at','2099-01-01T10:30:00Z','timezone','UTC')))),lid,l,null,null,false,null);
 if jsonb_array_length(out_json->'items')<>1 then raise exception 'Calendar insert failed'; end if;
 caught:=false;
 begin
  perform public.crm_automation_commit(u,jsonb_build_array(jsonb_build_object('table','calendar_events','row',jsonb_build_object('id',gen_random_uuid(),'lead_record_id',lid,'payload',jsonb_build_object('title','Conflict','kind','appointment','status','scheduled','start_at','2099-01-01T10:15:00Z','end_at','2099-01-01T10:45:00Z','timezone','UTC')))),lid,l,null,null,false,null);
 exception when others then caught:=true; end;
 if not caught then raise exception 'Overlapping booking was permitted'; end if;
 out_json:=public.crm_automation_commit(u,'[]',lid,l,'{"nextAction":"Synthetic next step"}','New call note',true,null);
 stale:=l;l:=out_json->'lead';
 if l->>'notes'<>E'Original note\n\nNew call note' then raise exception 'Notes append failed'; end if;
 if l->>'_automation_revision'<>'1' then raise exception 'Revision was not incremented'; end if;
 caught:=false;begin perform public.crm_automation_commit(u,'[]',lid,stale,'{"nextAction":"stale"}',null,true,null);exception when others then caught:=true;end;
 if not caught then raise exception 'Stale automation overwrite allowed';end if;
 perform set_config('crm.automation_write','',true);
 caught:=false;begin update public.crm_leads set payload=stale where user_id=u and record_id=lid;exception when others then caught:=true;end;
 if not caught then raise exception 'Legacy upload overwrote automation revision';end if;
 caught:=false;begin perform public.crm_automation_commit(u,'[]',lid,l,'{"stage":"Signed Contract"}',null,true,null);exception when others then caught:=true;end;
 if not caught then raise exception 'Signed stage accepted without evidence';end if;
 perform public.crm_automation_commit(u,jsonb_build_array(jsonb_build_object('table','contract_evidence','row',jsonb_build_object('id',gen_random_uuid(),'lead_record_id',lid,'payload',jsonb_build_object('kind','executed_agreement','reference','synthetic-reference','verified_by',u)))),lid,l,null,null,false,null);
 out_json:=public.crm_automation_commit(u,'[]',lid,l,'{"stage":"Signed Contract"}',null,true,null);l:=out_json->'lead';
 if l->>'stage'<>'Signed Contract' then raise exception 'Verified signing failed';end if;
 caught:=false;begin perform public.crm_automation_commit(u,'[]',lid,l,null,null,true,'+15555550100');exception when others then caught:=true;end;
 if not caught then raise exception 'SMS accepted without consent';end if;
 out_json:=public.crm_automation_commit(u,jsonb_build_array(jsonb_build_object('table','tasks','row',jsonb_build_object('id',gen_random_uuid(),'lead_record_id',lid,'title','Synthetic follow-up','status','open','priority','normal'))),lid,l,null,null,true,null);
 if jsonb_array_length(out_json->'items')<>1 then raise exception 'Task write failed';end if;
 if not exists(select 1 from public.crm_audit_events where user_id=u and entity_id=eid::text) then raise exception 'Audit not written';end if;
 if has_function_privilege('authenticated','public.crm_automation_commit(uuid,jsonb,text,jsonb,jsonb,text,boolean,text)','execute') then raise exception 'Browser can invoke privileged workflow';end if;
 if has_table_privilege('anon','public.crm_call_transcripts','select') then raise exception 'Anonymous transcripts readable';end if;
end $$;
rollback;
select 'Calendar, conflict prevention, notes append, evidence, stale writes, consent, tasks, audit and access checks passed; synthetic data rolled back.' as result;
