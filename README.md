# Site Khojo — Site scouting & network planning CRM

A HubSpot-style CRM for battery-swap site scouting: field teams capture sites ("deals") with GPS,
move them through a pipeline, and admins get one dashboard across every city and team member.

**Stack:** React + Vite (frontend) · Supabase free plan (Postgres database + login) · Vercel (hosting + one server function) · Leaflet/OpenStreetMap (maps)
**Running cost:** ₹0 on free tiers.

---

## What's inside

| Area | What it does |
|---|---|
| **Home** (`/`) | Public landing page with a login button |
| **Login** (`/login`) | Email + password, forgot-password, change password from the sidebar |
| **Dashboard** (admin) | Total / this week / this month, live · approved · dropped, stage-wise pipeline, city-wise split, pending per stage, avg days in stage, avg TAT per stage, lead→live cycle time, sites beyond SLA, drop reasons, team performance. Filters: city, stage, team member, date |
| **Deals** | Table or board (Kanban) view, search, filters, "My deals", Excel/CSV export, Excel/CSV import (admin) |
| **Create deal** | GPS "use my location", tap-to-pin map, paste lat/long or a Google Maps link, site/landlord/rent/power fields, live network-feasibility check and duplicate warning |
| **Deal page** | HubSpot-style stage path, change stage (with note; drop reason required), days in stage vs SLA, full stage history with time spent, comments, map + Google Maps link, owner reassignment (admin), edit, delete (admin) |
| **Map** | Every deal as a pin coloured by stage, click for details, filter by city/stage/member/SLA, map ↔ list toggle, optional network layers |
| **Network Planning** | Enter any lat/long → Feasible / Needs review / Not feasible with a score, based on distance to own stations, competition, demand hotspots, restricted zones and duplicate deals. "Create deal here" button |
| **Users** (admin) | Add users with a password, change role, deactivate, reset password, last login |
| **Settings** (admin) | Stages (name, order, colour, SLA days, admin-only, active), cities, drop reasons, feasibility rules, upload network data (own stations, competitors, demand hotspots, restricted zones) |

### Who can do what (enforced inside the database, not just the screen)

| | Admin | Team |
|---|---|---|
| See all deals, map, planning | ✅ | ✅ (avoids duplicate scouting) |
| Dashboard, Users, Settings | ✅ | ❌ |
| Create deals | ✅ | ✅ (auto-assigned to themselves) |
| Edit deal details | all | deals they created or own |
| Change stage | all | deals they own; not into admin-only stages (Approved, Live) |
| Reassign owner, delete, import | ✅ | ❌ |

Date, time and user of every submission and stage change are stamped by the database and can't be faked.

---

## One-time setup (≈20 minutes)

### 1. Supabase — database and login
1. Create a project at [supabase.com](https://supabase.com) → region **Mumbai (ap-south-1)**. Save the database password somewhere safe.
2. Open **SQL Editor → New query**, paste the whole of `supabase/setup_all_in_one.sql`, click **Run**. It's safe to run again.
3. **Project Settings → API**: copy the **Project URL**, the **anon / publishable key** and the **service_role / secret key**.
4. **Authentication → URL Configuration**: Site URL = `https://sitekojo.in`, and add `https://sitekojo.in/**` to Redirect URLs.
5. Leave sign-ups enabled for now (you'll create the first account in step 4).

### 2. GitHub
Create an empty repository (e.g. `sitekhojo`) and push this folder to it.

### 3. Vercel
1. **Add New → Project** → import the `sitekhojo` repo. Framework preset **Vite** is detected automatically.
2. **Environment Variables** (add all four, for Production + Preview):

   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | Project URL |
   | `VITE_SUPABASE_ANON_KEY` | anon / publishable key |
   | `SUPABASE_URL` | Project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role / secret key — **server only**, never put it in a `VITE_` variable |

3. **Deploy.**
4. **Settings → Domains** → add `sitekojo.in` (and `www.sitekojo.in`). Add the DNS records Vercel shows you at your domain registrar. HTTPS is automatic.

### 4. First login
1. Supabase → **Authentication → Users → Add user → Create new user** with your email and a password (tick *Auto confirm*).
   The **first user automatically becomes Admin**.
2. Supabase → **Authentication → Sign In / Providers → Email** → turn **off** "Allow new users to sign up". From now on only admins add people.
3. Log in at `https://sitekojo.in/login` → **Users → Add user** for each team member. Share the login details shown.
4. **Settings → Network data** → upload your existing stations (and competitors / demand hotspots if you have them) so Network Planning has a reference.

---

## Day-to-day changes
- **Code change** → push to GitHub → Vercel redeploys in about a minute. Data is never touched.
- **Database change** (new field/table) → add a new file in `supabase/migrations/` and run it once in the SQL Editor.
- **Backups:** the free plan has no automatic backups. Export Deals to Excel weekly from the app, or upgrade to Supabase Pro ($25/mo) for daily backups once this is in production.

## Local development
```bash
npm install
cp .env.example .env.local   # fill in your Supabase values
npm run dev                  # http://localhost:5173
```

## Project layout
```
api/admin-users.js        Vercel server function: create users / reset passwords (admin only)
src/main.jsx              routes + role guards
src/lib/                  supabase client, auth, config, deals helpers, feasibility engine (geo.js), Excel/CSV
src/components/           layout, filters, maps, deal form, stage dialog, import dialog, UI kit
src/pages/                Home, Login, Dashboard, Deals, DealNew, DealDetail, MapPage, Planning, Users, Settings
supabase/migrations/      schema + triggers + views, security rules, default stages/cities/rules
```

## Limits to know
- **Vercel Hobby** is for non-commercial use; company use strictly needs Vercel Pro ($20/user/mo). Cloudflare Pages or Netlify (free, commercial OK) work with the same code — set the same env vars there and port `api/admin-users.js` to their functions.
- **Supabase free** pauses a project after 7 days with no activity (daily use prevents this). 500 MB database ≈ hundreds of thousands of deals.
- **Map tiles** come from OpenStreetMap's public servers — fine for an internal team. For heavy use or satellite view, switch the tile URL in `src/components/maps.jsx` to MapTiler (free key).
- **Supabase's built-in email** (password reset) is rate-limited; connect a free SMTP (Brevo/Resend) in Supabase if resets are frequent. Admins can always reset passwords from the Users page.

## Ideas for the next iterations
Feasibility rules from your own parameters (catchment demand, rent caps by city, power load thresholds) · heatmap of scouting coverage · photo capture · WhatsApp/email alerts for SLA breaches · per-city targets vs actuals · scheduled backup to Google Drive.
