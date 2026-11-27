# BIPS Website – Bingwa Institute of Professional Studies

Static site (HTML/CSS/JS) + Supabase. Host on GitHub Pages, Netlify or any static host.

## 1. Supabase setup (10 minutes)
1. Create a project at supabase.com.
2. **SQL Editor** → paste all of `supabase/schema.sql` → Run. This creates tables, security rules (RLS), storage buckets, realtime and seed data (all your courses from the flyers, placeholder contacts).
3. **Authentication → Users → Add user**: create your admin login (email + password, tick "Auto confirm").
4. Make that user a super admin (SQL Editor, change the email):
   ```sql
   insert into public.admin_users (user_id, full_name, role)
   select id, 'Main Admin', 'super_admin' from auth.users where email = 'you@example.com';
   ```
5. **Project Settings → API**: copy the Project URL and the `anon public` key into `js/config.js`. Never use the service_role key in the website.
6. **Authentication → URL Configuration**: set Site URL to your live website address (needed for student sign-up/password-reset emails). For testing, you can turn off "Confirm email" under Providers → Email.

## 2. Emails (confirmation + approve/reject notices)
1. Create a free account at resend.com and verify your domain (or use the test sender for testing).
2. Install the Supabase CLI, then from this folder:
   ```
   supabase login
   supabase link --project-ref YOUR-PROJECT-REF
   supabase secrets set RESEND_API_KEY=re_xxx MAIL_FROM="BIPS <admissions@yourdomain.com>"
   supabase functions deploy send-email
   ```
The site works without this; emails are simply skipped (the admin sees a note).

## 3. Publish
Upload the folder contents to GitHub Pages (or any host). Admin dashboard: `/admin.html`.

## 4. First things to do in the admin
- **Settings & Contacts**: phone, WhatsApp, email, address, office hours, map, social links. These update the whole website instantly.
- **Courses**: set real fees, durations and entry requirements (currently placeholders).
- **Announcements**: post news. **Admin Users**: add staff (Super Admin or Admissions Officer).

## Roles
- Admissions Officer: view/process applications, manage courses, news, settings, messages.
- Super Admin: all of the above + delete applications + manage admin users.

## Security notes
- Applicants' documents are in a private bucket; only admins can open them (signed links that expire in 5 minutes).
- The public can only submit applications through a validated database function; they cannot read anyone's data. Status checks need reference number + email.
- Export is a CSV with Excel-friendly encoding (open directly in Excel).
