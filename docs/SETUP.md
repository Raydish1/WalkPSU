# Setup

## 1. Supabase

1. Create a project at supabase.com.
2. Open **SQL Editor** and run each file in `supabase/migrations/` once, in filename order:
   - `20261024000000_init.sql`
   - `20261024010000_territory_and_qr.sql`
3. Fallback login: go to **Authentication → Sign In / Providers** and turn on **Allow anonymous sign-ins**.
4. Go to **Project Settings → API** and copy the Project URL and the anon (publishable) key into `web/.env`.

Make yourself an admin in fallback mode. Join the app first, then run this in the SQL editor:

```sql
update players set is_admin = true where display_name = 'Your Name';
```

## 2. Auth0 (optional until you need real logins)

1. Create a tenant. Make sure its signing algorithm is **RS256** (the default). Supabase rejects HS256 and PS256.
2. **Applications → Create Application → Single Page Application.**
   - Allowed Callback URLs, Logout URLs, and Web Origins: `http://localhost:5173, https://<your-vercel-domain>`
   - Copy the Domain and Client ID into `VITE_AUTH0_DOMAIN` and `VITE_AUTH0_CLIENT_ID`.
3. **User Management → Roles:** create an `admin` role and assign it to organizers.
4. **Actions → Library → Create Action** (trigger: Login / Post Login). Use the code below, then deploy it and add it to the Login flow.

   ```js
   exports.onExecutePostLogin = async (event, api) => {
     api.idToken.setCustomClaim('role', 'authenticated')
     const isAdmin = (event.authorization?.roles ?? []).includes('admin')
     api.idToken.setCustomClaim('app_role', isAdmin ? 'admin' : 'player')
   }
   ```

5. In Supabase, go to **Authentication → Third-Party Auth → Add provider → Auth0** and enter your tenant ID (plus region, if your domain has one).

Once `VITE_AUTH0_DOMAIN` and `VITE_AUTH0_CLIENT_ID` are set, the app switches to Auth0 login automatically.

## 3. Vercel

1. Import the GitHub repo and set **Root Directory** to `web`. The framework preset (Vite) is detected.
2. Add every non-empty variable from `web/.env` under **Settings → Environment Variables**.
3. Deploy. Add the deployed URL to the Auth0 app's callback, logout, and origin lists.
