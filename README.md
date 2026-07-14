# PitchLab — Petpooja Sales Training Portal

This is the real, deployable web app. It has secure login, and an Admin area
that can create and remove employee accounts. Courses and roleplay come next.

Follow these steps in order. Take your time.

---

## STEP 1 — Create your first admin (in Supabase)

1. Open your Supabase project → left sidebar → **Authentication** → **Users**.
2. Click **Add user** → **Create new user**.
3. Enter your email + a password. **Turn ON "Auto Confirm User".** Click Create.
4. Left sidebar → **SQL Editor** → New query.
5. Open `create-first-admin.sql`, change the email to the one you just used,
   paste it, and click **Run**.

You are now the admin.

---

## STEP 2 — Put this project on GitHub

1. Go to **github.com** → click **New repository**.
2. Name it `pitchlab`, choose **Private**, click **Create repository**.
3. On the new empty repo page, click the link **"uploading an existing file"**.
4. Unzip the project, then **drag all the files and folders into the browser**
   (everything except `node_modules`, which isn't included — that's correct).
5. Scroll down and click **Commit changes**.

> Easier alternative: install **GitHub Desktop** (a free app, no command line),
> and drag the folder in, then click Publish.

---

## STEP 3 — Deploy to Vercel

1. Go to **vercel.com** → **Add New…** → **Project**.
2. Find your `pitchlab` repo and click **Import**.
3. Before clicking Deploy, open **Environment Variables** and add these three:

   | Name | Value |
   |------|-------|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://warspximxmklanzmddhp.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your `sb_publishable_…` key |
   | `SUPABASE_SECRET_KEY` | your `sb_secret_…` key (Supabase → Settings → API Keys → Secret keys) |

4. Click **Deploy**. Wait ~1–2 minutes.
5. Vercel gives you a permanent URL like `https://pitchlab-xxxx.vercel.app`.

That URL is your portal. Every time the app is updated on GitHub, Vercel
rebuilds the **same** URL automatically.

---

## STEP 4 — Test it

1. Open your Vercel URL → you'll see the **Sign in** page.
2. Log in with your admin email + password → you land on the **Admin** console.
3. Go to **Team** → **Add a new employee** → fill the form → Create.
4. Log out, and log in as that employee (their email + the password you set)
   → they land on the **Employee** dashboard.
5. Back as admin, use **Remove** to delete a test employee.

If anything fails, note the exact error message and send it over.

---

## Notes
- The `sb_secret_…` key is powerful — it only lives in Vercel's Environment
  Variables, never in the code. Never share it.
- To stop random public sign-ups, in Supabase → Authentication → Providers/
  Settings, you can turn **off** "Allow new users to sign up". Employees are
  created by the admin, so this is safe to disable.
