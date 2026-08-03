# Survivor Pool

Real accounts, up to 5 entries per account, straight-up weekly picks, and the
week 6 (spread ≥10) / week 10 (spread ≥7) game exclusions — running on a real
database instead of browser storage.

## 1. Create a Supabase project (free)

1. Go to supabase.com, sign up, and create a new project.
2. In the project, go to **SQL Editor -> New query**, paste in the entire
   contents of `supabase/schema.sql`, and click **Run**. This creates all
   tables, security rules, and the auto-profile trigger.
3. Go to **Project Settings -> API**. You'll need two values from this page:
   - **Project URL**
   - **anon public** key

## 2. Configure the app

1. Copy `.env.local.example` to a new file named `.env.local`.
2. Paste in your Project URL and anon public key from step 1.3.
3. Never commit `.env.local` — it's already in `.gitignore`.

## 3. Run it locally (optional, to test)

```bash
npm install
npm run dev
```

Open http://localhost:3000, sign up for an account, and try it out.

## 4. Make yourself an admin

1. Sign up for an account in the app first (so your profile row exists).
2. In Supabase, go to **Table Editor -> profiles**.
3. Find your row (matched by email) and set `is_admin` to `true`.
4. Reload the app — you'll now see an **Admin** link in the nav bar.

## 5. Put games in for each week

In **Admin**, pick a week, click **+ Add game** for each matchup, set the
teams and the spread, and set the **current week** so participants know what
they're picking. After games finish, come back, set the **Winner** on each
game, and check **Mark week final** — that's what locks in eliminations for
anyone who didn't pick or picked a loser.

## 6. Set up email (Admin > Email tab)

This sends from your own Gmail account (`scheuerfootball@gmail.com`), so no
domain or paid service needed. Two things to do once:

1. **Turn on 2-Step Verification** on that Gmail account, if it isn't already
   (Google requires this before it'll issue an App Password):
   myaccount.google.com/security
2. **Generate an App Password**: myaccount.google.com/apppasswords — choose
   "Mail" as the app, generate it, and copy the 16-character password.
3. Add it to your **local** `.env.local`:
   ```
   GMAIL_USER=scheuerfootball@gmail.com
   GMAIL_APP_PASSWORD=the16characterpassword
   ```
4. When you deploy (step 7 below), add the same two variables (plus
   `GMAIL_FROM_NAME` if you want) under Vercel's Environment Variables — the
   local file alone won't carry over to the live site.

**Honest limits worth knowing:** this is your personal Gmail account sending
the mail, not a dedicated email service. Google caps personal accounts at
roughly 500 recipients per rolling 24 hours (counted across everything you
send that day), and a sudden blast to hundreds of BCC recipients can
occasionally get throttled or flagged by Google's spam/abuse systems in ways
a real transactional email service wouldn't be. Fine for occasional
reminders to a few hundred people; not something to rely on for anything
time-critical or frequent.

## 7. Deploy it for real (Vercel, free)

1. Create a free account at github.com if you don't have one, and a new
   empty repository (e.g. `survivor-pool`).
2. From this project folder:
   ```bash
   git init
   git add .
   git commit -m "Survivor pool app"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/survivor-pool.git
   git push -u origin main
   ```
3. Go to vercel.com, sign up (you can use your GitHub account), click
   **Add New -> Project**, and import the repo you just pushed.
4. Before deploying, add your environment variables under
   **Environment Variables**:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `GMAIL_FROM_NAME` (for email)
   - `CRON_SECRET` (for the automated reminder below)
   - `NEXT_PUBLIC_SITE_URL` — set this to your real Vercel URL once you know
     it (e.g. `https://survivor-pool.vercel.app`). It's fine to deploy once
     first to get that URL, then come back and add/update this variable and
     redeploy — it's only used for the link inside reminder emails.
5. Click **Deploy**. Vercel gives you a live URL
   (e.g. `survivor-pool.vercel.app`) you can share with your ~360 participants.

## 8. Automatic Saturday reminder emails (only works once deployed)

The Admin > Email tab's "Remind missing picks" button works locally, but a
*scheduled, automatic* reminder needs something that runs even when your
computer is off — that's what Vercel Cron provides, and it only exists once
the app is deployed to Vercel (step 7 above).

What's already wired up: `vercel.json` schedules a call to
`/api/cron/remind-missing-picks` every Saturday at 10:00 AM Central — split
into two entries so it stays correct across the daylight-saving change
partway through the season (one entry for Sept/Oct, one for Nov–Feb). It
checks whichever week is set as "current week" in Admin, finds every entry
that's still alive with no pick in yet, and emails them the same way the
manual button does.

Vercel automatically sends your `CRON_SECRET` back as an `Authorization`
header when it triggers the cron — that's how the route confirms the request
is really from Vercel and not a random visitor hitting the URL. As long as
you added `CRON_SECRET` in step 7's environment variables, this works
automatically after your next deploy; you'll see it listed under your
Vercel project's **Cron Jobs** tab once it's live.

Things worth knowing:
- **Vercel's free (Hobby) tier caps cron jobs at running no more than once a
  day** — a weekly Saturday run is well within that, so no upgrade needed.
- It goes off whichever week is set as **current week** in Admin. If you
  forget to advance that after finalizing a week, the reminder would nag
  people about the wrong week — worth keeping that field current.
- If literally everyone already has a pick in when it fires, it just skips
  sending anything (you can check the result in Vercel's Cron Jobs logs).

## Keeping the database in sync

Instead of tracking individual migration files, run **`supabase/sync_schema.sql`**
any time you're not sure whether your database matches the current app —
it's always safe to re-run, no matter what you've already applied. Paste it
into a blank SQL Editor query and run it. (The individual `migration_*.sql`
files are kept for reference but you shouldn't need them going forward.)

## Notes

- The "max 5 entries" limit is enforced both in the UI and by a database
  trigger, so it holds even if someone finds a clever way around the UI.
- Standings and picks are visible to any signed-in visitor by design (so
  people can check the pool) — only game/week editing is admin-only.
- If you ever want a custom domain (e.g. `mypool.com` instead of the vercel.app
  one), you can add that under Vercel's project settings once you own the
  domain — that part costs whatever your domain registrar charges, separate
  from Vercel/Supabase hosting itself.
