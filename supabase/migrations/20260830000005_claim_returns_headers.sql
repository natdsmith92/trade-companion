-- claim_pending_email() must hand the sweep the headers it now needs for DKIM
-- verification. Return-type change, so the old signature is dropped first.
drop function if exists claim_pending_email(integer);

create or replace function claim_pending_email(max_attempts integer default 3)
returns table (
  id uuid, user_id uuid, subject text, body text,
  from_email text, envelope_sender text, headers jsonb, attempts integer
)
language plpgsql
as $$
begin
  return query
  with candidate as (
    select cand.id from emails cand
    where cand.status = 'pending' and cand.attempts < claim_pending_email.max_attempts
    order by cand.received_at asc
    for update skip locked limit 1
  )
  update emails tgt
     set attempts = tgt.attempts + 1, last_attempt_at = now()
    from candidate c
   where tgt.id = c.id
  returning tgt.id, tgt.user_id, tgt.subject, tgt.body,
            tgt.from_email, tgt.envelope_sender, tgt.headers, tgt.attempts;
end;
$$;
