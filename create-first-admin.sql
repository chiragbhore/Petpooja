-- ============================================================
--  Create your FIRST admin (run once)
--  Do this AFTER you've added yourself as a user in
--  Supabase > Authentication > Users > Add user
--  (turn ON "Auto Confirm User" when adding).
--
--  Then change the email below to YOUR admin email and Run.
-- ============================================================

insert into public.profiles (id, full_name, email, role)
select id, 'Admin', email, 'admin'
from auth.users
where email = 'CHANGE-ME@petpooja.com'
on conflict (id) do update set role = 'admin';
