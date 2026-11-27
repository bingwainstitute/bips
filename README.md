# BIPS Website – Bingwa Institute of Professional Studies

Website (HTML/CSS/JS in `public/`) + Node backend (`server.js`) + Supabase. Hosted on Render as a Web Service.

## 1. Supabase setup (10 minutes)
1. Create a project at supabase.com.
2. **SQL Editor** → paste all of `supabase/schema.sql` → Run. This creates tables, security rules (RLS), storage buckets, realtime and seed data (all your courses from the flyers, placeholder contacts).
3. **Authentication → Users → Add user**: create your admin login (email + password, tick "Auto confirm").
4. Make that user a super admin (SQL Editor, change the email):
   ```sql
   insert into public.admin_users (user_id, full_name, role)
   select id, 'Main Admin', 'super_admin' from auth.users where email = 'you@example.com';
   ```
5. **Project Settings → API**: copy the Project URL, `anon public` key and `service_role` key; you will add them as Render environment variables (section 2). Never put keys in the HTML/JS files.
6. **Authentication → URL Configuration**: set Site URL to your live website address (needed for student sign-up/password-reset emails). For testing, you can turn off "Confirm email" under Providers → Email.

## 2. Deploy on Render (Web Service)
This project has a small Node backend (`server.js`, no npm dependencies) that serves the website, injects your Supabase keys from environment variables, and sends emails through `POST /api/send-email`.

1. Push this folder to a GitHub repo (`server.js` and `package.json` at the repo root).
2. On render.com: **New → Web Service** → connect the repo (or **New → Blueprint** to use `render.yaml`).
3. Settings: **Runtime** Node, **Build Command** `echo "no build"`, **Start Command** `node server.js`, **Health Check Path** `/health`.
4. **Environment** variables:
   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | Project URL (Supabase → Settings → API) |
   | `SUPABASE_ANON_KEY` | `anon public` key |
   | `SUPABASE_SERVICE_ROLE_KEY` | `service_role` key. Server only; never put it in `public/` |
   | `RESEND_API_KEY` | from resend.com (optional; without it emails are skipped) |
   | `MAIL_FROM` | e.g. `BIPS <admissions@yourdomain.com>` (domain verified in Resend) |
5. Deploy. In Supabase → **Authentication → URL Configuration**, set **Site URL** to your Render URL (e.g. `https://bips-website.onrender.com`).
6. Admin dashboard: `/admin.html`.

Local run: copy `.env.example` values into your shell, then `node server.js` and open http://localhost:3000.
Note: free Render Web Services sleep after ~15 min idle (first visit takes ~30 s). The Supabase Edge Function in `supabase/functions/send-email` is no longer needed.

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
