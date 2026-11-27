-- =====================================================================
-- BIPS (Bingwa Institute of Professional Studies) - Supabase schema
-- Run ONCE on a fresh project: Supabase Dashboard > SQL Editor > New query
-- =====================================================================
create extension if not exists pgcrypto;

-- ---------- TABLES ----------
create table public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  description text,
  sort_order int default 0,
  created_at timestamptz default now()
);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  department_id uuid references public.departments(id) on delete restrict,
  subcategory text,
  name text not null,
  description text,
  duration text,
  level text not null default 'Certificate'
    check (level in ('Short Course','Certificate','Diploma','Higher Diploma')),
  entry_requirements text,
  fee numeric(12,2),
  is_featured boolean default false,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'admissions_officer'
    check (role in ('super_admin','admissions_officer')),
  created_at timestamptz default now()
);

create sequence public.application_seq start 1;

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  reference_number text unique,
  user_id uuid references auth.users(id) on delete set null,
  full_name text not null,
  gender text,
  date_of_birth date,
  email text not null,
  phone text not null,
  nationality text,
  id_number text,
  county text,
  address text,
  course_id uuid references public.courses(id) on delete set null,
  course_name text,
  study_mode text,
  highest_qualification text,
  kcse_grade text,
  previous_institution text,
  next_of_kin_name text,
  next_of_kin_phone text,
  heard_about text,
  status text not null default 'Pending'
    check (status in ('Pending','Under Review','Approved','Rejected')),
  admin_comments text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  confirmation_sent boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index on public.applications (status);
create index on public.applications (course_id);
create index on public.applications (lower(email));
create index on public.applications (created_at desc);

create table public.application_documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  doc_type text not null,
  file_path text not null,
  file_name text,
  file_size bigint,
  mime_type text,
  created_at timestamptz default now()
);

create table public.application_status_history (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  old_status text,
  new_status text,
  comment text,
  changed_by uuid,
  created_at timestamptz default now()
);

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text,
  image_url text,
  published boolean default true,
  created_at timestamptz default now()
);

create table public.site_settings (
  key text primary key,
  value text,
  updated_at timestamptz default now()
);

create table public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) <= 120),
  email text not null check (char_length(email) <= 200),
  phone text check (char_length(phone) <= 40),
  message text not null check (char_length(message) <= 4000),
  is_read boolean default false,
  created_at timestamptz default now()
);

-- ---------- HELPER FUNCTIONS ----------
create or replace function public.is_admin() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

create or replace function public.is_super_admin() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid() and role = 'super_admin');
$$;

-- reference number: BIPS-2026-00001
create or replace function public.set_reference_number() returns trigger
language plpgsql as $$
begin
  if new.reference_number is null then
    new.reference_number := 'BIPS-' || to_char(now(), 'YYYY') || '-' ||
                            lpad(nextval('public.application_seq')::text, 5, '0');
  end if;
  return new;
end $$;
create trigger trg_reference before insert on public.applications
  for each row execute function public.set_reference_number();

-- log status changes + stamp reviewer
create or replace function public.log_status_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status
     or new.admin_comments is distinct from old.admin_comments then
    insert into public.application_status_history(application_id, old_status, new_status, comment, changed_by)
    values (new.id, old.status, new.status, new.admin_comments, auth.uid());
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger trg_status before update on public.applications
  for each row execute function public.log_status_change();

-- ---------- PUBLIC RPCs ----------
-- Submit an application (the only way the public can create one)
create or replace function public.submit_application(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := (p->>'id')::uuid;
  v_course uuid := (p->>'course_id')::uuid;
  v_cname text;
  v_ref text;
  d jsonb;
begin
  select name into v_cname from public.courses where id = v_course and is_active;
  if v_cname is null then raise exception 'The selected course is not available.'; end if;

  if coalesce(trim(p->>'full_name'),'') = '' or coalesce(trim(p->>'phone'),'') = ''
     or (p->>'email') !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Please fill in your name, a valid email and phone number.';
  end if;

  if exists (select 1 from public.applications
             where lower(email) = lower(p->>'email') and course_id = v_course
               and status in ('Pending','Under Review','Approved')) then
    raise exception 'DUPLICATE: You have already applied for this course with this email address.';
  end if;

  insert into public.applications(
    id, user_id, full_name, gender, date_of_birth, email, phone, nationality, id_number,
    county, address, course_id, course_name, study_mode, highest_qualification, kcse_grade,
    previous_institution, next_of_kin_name, next_of_kin_phone, heard_about)
  values (
    v_id, auth.uid(), left(p->>'full_name',150), left(p->>'gender',30),
    nullif(p->>'date_of_birth','')::date, lower(left(p->>'email',200)), left(p->>'phone',40),
    left(p->>'nationality',80), left(p->>'id_number',40), left(p->>'county',80),
    left(p->>'address',300), v_course, v_cname, left(p->>'study_mode',40),
    left(p->>'highest_qualification',100), left(p->>'kcse_grade',20),
    left(p->>'previous_institution',200), left(p->>'next_of_kin_name',150),
    left(p->>'next_of_kin_phone',40), left(p->>'heard_about',100))
  returning reference_number into v_ref;

  for d in select * from jsonb_array_elements(coalesce(p->'documents','[]'::jsonb)) loop
    if (d->>'file_path') like v_id::text || '/%' then
      insert into public.application_documents(application_id, doc_type, file_path, file_name, file_size, mime_type)
      values (v_id, left(d->>'doc_type',40), d->>'file_path', left(d->>'file_name',200),
              nullif(d->>'file_size','')::bigint, left(d->>'mime_type',80));
    end if;
  end loop;

  return jsonb_build_object('id', v_id, 'reference_number', v_ref);
end $$;
grant execute on function public.submit_application(jsonb) to anon, authenticated;

-- Duplicate check before uploading documents
create or replace function public.application_exists(p_email text, p_course uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.applications
                 where lower(email) = lower(trim(p_email)) and course_id = p_course
                   and status in ('Pending','Under Review','Approved'));
$$;
grant execute on function public.application_exists(text, uuid) to anon, authenticated;

-- Status check by reference number + email (no login)
create or replace function public.check_application_status(p_ref text, p_email text)
returns table(reference_number text, full_name text, course_name text, status text,
              admin_comments text, created_at timestamptz, updated_at timestamptz)
language sql security definer set search_path = public as $$
  select a.reference_number, a.full_name, a.course_name, a.status, a.admin_comments, a.created_at, a.updated_at
  from public.applications a
  where upper(a.reference_number) = upper(trim(p_ref)) and lower(a.email) = lower(trim(p_email))
  limit 1;
$$;
grant execute on function public.check_application_status(text, text) to anon, authenticated;

-- ---------- ADMIN USER MANAGEMENT (super admin only) ----------
create or replace function public.list_admins()
returns table(user_id uuid, email text, full_name text, role text, created_at timestamptz)
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_super_admin() then raise exception 'Not allowed'; end if;
  return query select a.user_id, u.email::text, a.full_name, a.role, a.created_at
               from public.admin_users a join auth.users u on u.id = a.user_id order by a.created_at;
end $$;

create or replace function public.grant_admin(p_email text, p_name text, p_role text) returns void
language plpgsql security definer set search_path = public, auth as $$
declare v uuid;
begin
  if not public.is_super_admin() then raise exception 'Not allowed'; end if;
  if p_role not in ('super_admin','admissions_officer') then raise exception 'Invalid role'; end if;
  select id into v from auth.users where lower(email) = lower(trim(p_email));
  if v is null then
    raise exception 'No account found for that email. Ask the person to create an account first (Status page > Student Login > Create account), then add them here.';
  end if;
  insert into public.admin_users(user_id, full_name, role) values (v, p_name, p_role)
  on conflict (user_id) do update set full_name = excluded.full_name, role = excluded.role;
end $$;

create or replace function public.revoke_admin(p_user_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_super_admin() then raise exception 'Not allowed'; end if;
  if p_user_id = auth.uid() then raise exception 'You cannot remove your own admin access.'; end if;
  delete from public.admin_users where user_id = p_user_id;
end $$;

-- ---------- ROW LEVEL SECURITY ----------
alter table public.departments enable row level security;
alter table public.courses enable row level security;
alter table public.admin_users enable row level security;
alter table public.applications enable row level security;
alter table public.application_documents enable row level security;
alter table public.application_status_history enable row level security;
alter table public.announcements enable row level security;
alter table public.site_settings enable row level security;
alter table public.contact_messages enable row level security;

-- departments
create policy "departments_public_read" on public.departments for select using (true);
create policy "departments_admin_write" on public.departments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
-- courses
create policy "courses_public_read" on public.courses for select using (is_active or public.is_admin());
create policy "courses_admin_write" on public.courses for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
-- announcements
create policy "announcements_public_read" on public.announcements for select using (published or public.is_admin());
create policy "announcements_admin_write" on public.announcements for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
-- settings
create policy "settings_public_read" on public.site_settings for select using (true);
create policy "settings_admin_write" on public.site_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
-- admin users (read-only for admins; changes go through RPCs)
create policy "admin_users_read" on public.admin_users for select to authenticated using (public.is_admin());
-- applications: students see only their own; admins see/manage all; delete = super admin
create policy "applications_select" on public.applications for select to authenticated
  using (public.is_admin() or user_id = auth.uid());
create policy "applications_admin_update" on public.applications for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "applications_super_delete" on public.applications for delete to authenticated
  using (public.is_super_admin());
-- documents
create policy "documents_select" on public.application_documents for select to authenticated
  using (public.is_admin() or exists (select 1 from public.applications a
         where a.id = application_id and a.user_id = auth.uid()));
-- history
create policy "history_admin_read" on public.application_status_history for select to authenticated
  using (public.is_admin());
-- contact messages
create policy "contact_insert" on public.contact_messages for insert to anon, authenticated with check (true);
create policy "contact_admin_read" on public.contact_messages for select to authenticated using (public.is_admin());
create policy "contact_admin_update" on public.contact_messages for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "contact_admin_delete" on public.contact_messages for delete to authenticated using (public.is_admin());

-- Realtime: new applications appear instantly in the admin dashboard
alter publication supabase_realtime add table public.applications;

-- ---------- STORAGE ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('documents', 'documents', false, 5242880, array['application/pdf','image/jpeg','image/png']),
  ('site-images', 'site-images', true, 3145728, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- applicants may upload (not read) documents into a UUID-named folder
create policy "docs_public_insert" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$');
create policy "docs_admin_read" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and public.is_admin());
create policy "docs_admin_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and public.is_admin());
create policy "images_admin_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'site-images' and public.is_admin());
create policy "images_admin_update" on storage.objects for update to authenticated
  using (bucket_id = 'site-images' and public.is_admin());
create policy "images_admin_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'site-images' and public.is_admin());

-- ---------- SEED DATA ----------
insert into public.departments (name, slug, description, sort_order) values
 ('Mass Communication, Journalism and Media Studies','mass-communication','Tell, inform and inspire. Practical training in radio, television, print, digital media, production and public relations.',1),
 ('Information Technology (ICT and Computer Studies)','information-technology','Be digitally empowered. Computer packages, graphic design, digital content creation, web design and more.',2),
 ('Business Management','business-management','Build your business skills. Entrepreneurship, bookkeeping, office administration, marketing and customer service.',3),
 ('Professional Short Courses','professional-short-courses','Learn a skill in 2 weeks to 3 months: beauty, hospitality, fashion, events and professional skills.',4);

insert into public.courses (department_id, subcategory, name, description, duration, level, entry_requirements, is_featured)
select d.id, v.sub, v.name,
  'Practical, hands-on training in ' || v.name || ' delivered by experienced trainers in a modern learning environment.',
  v.dur, v.lvl,
  'Open to school leavers, students, job seekers and anyone who wants to learn.', v.feat
from (values
 -- Mass Communication
 ('mass-communication',null,'Radio Presenting and Journalism','Certificate',null,true),
 ('mass-communication',null,'News Reporting and Writing','Certificate',null,false),
 ('mass-communication',null,'Sports Journalism and Commentary','Certificate',null,false),
 ('mass-communication',null,'TV Presenting','Certificate',null,false),
 ('mass-communication',null,'Podcast Production','Certificate',null,false),
 ('mass-communication',null,'Audio and Video Production','Certificate',null,false),
 ('mass-communication',null,'Video Production and Editing','Certificate',null,true),
 ('mass-communication',null,'Digital Journalism and Social Media Management','Certificate',null,false),
 ('mass-communication',null,'Public Relations','Certificate',null,false),
 -- Information Technology
 ('information-technology',null,'Computer Packages (Word, Excel, PowerPoint)','Certificate',null,true),
 ('information-technology',null,'Basic ICT and Digital Literacy','Certificate',null,false),
 ('information-technology',null,'Graphic Design and Digital Content Creation','Certificate',null,true),
 ('information-technology',null,'Computer Maintenance (Basic)','Certificate',null,false),
 ('information-technology',null,'Website Design','Certificate',null,false),
 ('information-technology',null,'Video Editing','Certificate',null,false),
 ('information-technology',null,'Microsoft Office','Certificate',null,false),
 -- Business Management
 ('business-management',null,'Entrepreneurship and Business Management','Certificate',null,true),
 ('business-management',null,'Bookkeeping and Basic Accounting','Certificate',null,false),
 ('business-management',null,'Office Administration','Certificate',null,false),
 ('business-management',null,'Business Communication','Certificate',null,false),
 ('business-management',null,'Marketing and Customer Service','Certificate',null,false),
 ('business-management',null,'Digital Marketing','Certificate',null,false),
 ('business-management',null,'Sales and Marketing','Certificate',null,false),
 ('business-management',null,'Social Media Management','Certificate',null,false),
 -- Short courses: Beauty
 ('professional-short-courses','Beauty, Hairdressing and Personal Care','Hairdressing and Barbering','Short Course','2 weeks – 3 months',false),
 ('professional-short-courses','Beauty, Hairdressing and Personal Care','Beauty Therapy','Short Course','2 weeks – 3 months',false),
 ('professional-short-courses','Beauty, Hairdressing and Personal Care','Makeup Artistry','Short Course','2 weeks – 3 months',false),
 ('professional-short-courses','Beauty, Hairdressing and Personal Care','Nail Technology and Manicure','Short Course','2 weeks – 3 months',false),
 ('professional-short-courses','Beauty, Hairdressing and Personal Care','Pedicure and Braiding','Short Course','2 weeks – 3 months',false),
 ('professional-short-courses','Beauty, Hairdressing and Personal Care','Wig Making and Skincare','Short Course','2 weeks – 3 months',false),
 -- Short courses: Hospitality
 ('professional-short-courses','Hospitality, Catering and Food Production','Catering and Cookery','Short Course','2 weeks – 3 months',false),
 ('professional-short-courses','Hospitality, Catering and Food Production','Barista Training','Short Course','2 weeks – 3 months',false),
 ('professional-short-courses','Hospitality, Catering and Food Production','Baking and Pastry','Short Course','2 weeks – 3 months',false),
 ('professional-short-courses','Hospitality, Catering and Food Production','Cake Making and Decoration','Short Course','2 weeks – 3 months',false),
 ('professional-short-courses','Hospitality, Catering and Food Production','Food and Beverage Service','Short Course','2 weeks – 3 months',false),
 ('professional-short-courses','Hospitality, Catering and Food Production','Restaurant Service','Short Course','2 weeks – 3 months',false),
 ('professional-short-courses','Hospitality, Catering and Food Production','Housekeeping','Short Course','2 weeks – 3 months',false),
 -- Short courses: Fashion
 ('professional-short-courses','Fashion and Creative Skills','Tailoring and Dressmaking','Short Course','2 weeks – 3 months',false),
 ('professional-short-courses','Fashion and Creative Skills','Fashion Design','Short Course','2 weeks – 3 months',false),
 ('professional-short-courses','Fashion and Creative Skills','Garment Making','Short Course','2 weeks – 3 months',false),
 ('professional-short-courses','Fashion and Creative Skills','Fashion Accessories','Short Course','2 weeks – 3 months',false),
 ('professional-short-courses','Fashion and Creative Skills','Photography','Short Course','2 weeks – 3 months',false),
 ('professional-short-courses','Fashion and Creative Skills','Videography','Short Course','2 weeks – 3 months',false),
 ('professional-short-courses','Fashion and Creative Skills','Graphic Design (Short Course)','Short Course','2 weeks – 3 months',false),
 -- Short courses: Events
 ('professional-short-courses','Events and Professional Skills','Event Planning and Management','Short Course','2 weeks – 3 months',false),
 ('professional-short-courses','Events and Professional Skills','Wedding Planning','Short Course','2 weeks – 3 months',false),
 ('professional-short-courses','Events and Professional Skills','Public Relations (Short Course)','Short Course','2 weeks – 3 months',false),
 ('professional-short-courses','Events and Professional Skills','Professional Communication','Short Course','2 weeks – 3 months',false),
 ('professional-short-courses','Events and Professional Skills','Front Office Operations','Short Course','2 weeks – 3 months',false),
 ('professional-short-courses','Events and Professional Skills','Hospitality Management','Short Course','2 weeks – 3 months',false)
) as v(dept, sub, name, lvl, dur, feat)
join public.departments d on d.slug = v.dept;

insert into public.site_settings (key, value) values
 ('phone','+254 7XX XXX XXX'),
 ('whatsapp',''),
 ('email','info@yourdomain.com'),
 ('address','Update your physical address in Admin > Settings'),
 ('office_hours','Monday – Friday: 8:00 AM – 5:00 PM'),
 ('map_embed_url',''),
 ('facebook',''),('instagram',''),('twitter',''),('tiktok',''),('youtube',''),
 ('fees_note','Fees shown are per course. Contact the institute for payment options and any applicable registration or examination fees.'),
 ('admission_requirements',E'Complete the online application form\nUpload a copy of your national ID or passport\nUpload your academic certificates or results slip\nUpload a recent passport-size photo\nProvide next-of-kin contact details'),
 ('entry_qualifications',E'Secondary school leavers\nUniversity and college students\nJob seekers\nAspiring journalists\nSmall-business owners\nAnyone who wants to acquire practical skills')
on conflict (key) do nothing;

insert into public.announcements (title, body) values
 ('Enrolment is now open','Applications are now open for our initial intake. Choose a course, apply online and track your application using your reference number. Flexible weekday, weekend and evening classes available.');

-- ---------- FIRST ADMIN ----------
-- 1) Supabase Dashboard > Authentication > Users > Add user (email + password)
-- 2) Run this, replacing the email:
-- insert into public.admin_users (user_id, full_name, role)
-- select id, 'Main Admin', 'super_admin' from auth.users where email = 'you@example.com';
