-- The staff to-do list (owner, 2026-11-07): each note is just a date, a bill note and an amount, with
-- several notes allowed on the same date. The task title is no longer asked for.
alter table public.diary_entries alter column title drop not null;
alter table public.diary_entries drop constraint diary_entries_title_check;
alter table public.diary_entries add constraint diary_entries_title_check
  check (title is null or length(trim(title)) between 1 and 200);
alter table public.diary_entries add constraint diary_entries_note_or_amount
  check (nullif(trim(coalesce(bill_note, '')), '') is not null or price_paise is not null);
