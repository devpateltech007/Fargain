# Fargain demo runbook

This runbook uses the mock seller and PayPal sandbox. It does not send messages to a real seller or create a live payment.

## Prepare

1. Set up `.env` from `.env.example`. For the full AI demo configure Anthropic. For price comparison configure Channel3. For checkout configure PayPal sandbox credentials. Keep `PAYPAL_ENV=sandbox`.
2. Seed local sample data.

   ```powershell
   npm run seed:demo
   ```

   Re-running the seed does not duplicate the sample products, snapshots, alert, or negotiation. It never creates PayPal orders.

3. Start the backend and dashboard in separate terminals.

   ```powershell
   npm run dev:backend
   npm run dev:dashboard
   ```

4. Open `http://localhost:5173` and enter the configured `FARGAIN_API_TOKEN`. Visit the Wishlist, Negotiations, Payments, Activity, Instagram, and Profile sections.

## Show the negotiation flow

1. Build the extension with `VITE_BACKEND_URL=http://localhost:3000` and load `extension/dist` as an unpacked Chrome extension.
2. Open `http://localhost:3000/mock-seller/` and open the extension side panel.
3. Select the seeded Nintendo Switch item or add a new item with a target and max price.
4. Ask the agent for a draft. Review the copy and risk flags. The extension fills the compose field; click Send yourself.
5. Use the mock seller's scripted reply. Record the seller reply, confirm a price at or below max, and create a sandbox payment.
6. Open the PayPal sandbox approval link and use a sandbox buyer account. Return to Fargain and refresh the payment state.

If a provider is not configured, demonstrate the dashboard and mock seller without that feature. Do not substitute a fake provider response for a missing live integration in a provider smoke test.

## Show price watch and alerts

With Channel3 configured, run the price refresh from the dashboard or call `POST /api/pricing/refresh`. The service checks linked products, saves snapshots, and records eligible price-drop alerts. The seed creates a visible example alert so the dashboard layout can be shown before a live refresh.

## Show Instagram Reel Mode

Paste a public Instagram Reel or post URL into the dashboard. Identification requires Anthropic. If the model returns multiple candidates, choose one explicitly. Link an Instagram professional account only when the Meta app, permissions, webhook URL, and test account are configured. Fargain uses the link, caption, thumbnail supplied by the webhook, or a screenshot; it does not download video.

## Cleanup

For local demo data, stop the backend and remove the local `data/fargain.db` file only if you no longer need its contents. Do not run cleanup against a hosted persistent disk or a database with user data.
