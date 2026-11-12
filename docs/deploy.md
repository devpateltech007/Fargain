# Render deployment

## Blueprint

The repository's `render.yaml` defines the production web service, a persistent disk for SQLite, and the `/api/health` check. Connect the repository in Render and create the service from the blueprint.

During the initial Blueprint setup, Render asks for the required provider credentials. Enter:

1. `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` for AI features.
2. `CHANNEL3_API_KEY` for live price comparisons and scheduled watches.
3. PayPal sandbox client ID and secret. Do not add production PayPal credentials.

The Blueprint derives `PUBLIC_BASE_URL` from Render's assigned service URL. Render generates `FARGAIN_API_TOKEN`; copy it into the dashboard and extension settings. Never put it in source control or a frontend build variable.

Instagram and PayPal webhook credentials are optional. Add them later on the service's Environment page when the Meta app or PayPal webhook is ready. For Instagram, add the app secret, verify token, page-linked access token, account ID, and graph version together.

The service binds to `0.0.0.0`, stores SQLite at `/var/data/fargain.db`, and keeps development routes disabled. The persistent disk is necessary because an ephemeral filesystem loses the database on redeploy.

## Verify the deployment

- Open `https://YOUR-SERVICE.onrender.com/api/health`. It should report `ok: true` and `paypal_env: "sandbox"`.
- Open the service root and connect the dashboard with the API token.
- Check that wishlist changes survive a service restart before relying on the demo.
- Import the Postman collection and set the hosted `baseUrl` and API token in its local variables.
- Set Meta's webhook callback to `https://YOUR-SERVICE.onrender.com/webhooks/instagram` and configure the same verify token in both places. Subscribe to the Instagram messaging fields needed for Reel shares and accompanying text. Link the buyer account from the dashboard before trying DM intake.
- For the Chrome extension, build it separately with `VITE_BACKEND_URL=https://YOUR-SERVICE.onrender.com`. The build adds that exact origin to the generated extension host permissions. Reload the unpacked extension after rebuilding; the backend does not serve the extension bundle.

## Operational limits

- This is a single-user demo backend. API token holders act as the same default user. It is not a multi-tenant account system.
- PayPal remains sandbox-only and requires buyer approval.
- SQLite is stored on one persistent disk. Do not scale the web service horizontally without replacing this storage design.
- Facebook Marketplace page markup is unstable and the adapter is best-effort. The user reviews and sends every message.
- Instagram messaging needs a Page-linked access token with the correct Meta permissions. A token that can see no Pages cannot receive or send those messages.
- Do not enable demo/dev routes on the public deployment.
