# Fargain demo runbook

For the hackathon's timed video, spoken script, and submission copy, use [Hackathon demo script](hackathon-demo-script.md).

The scripted dashboard journey simulates Instagram intake and creates a prepared Marketplace match. The extension can negotiate on the real prepared listing when it is accessible, or use the mock seller for a repeatable local run. PayPal remains sandbox-only.

## Prepare

1. Set up `.env` from `.env.example`. For the full AI demo configure Anthropic. For price comparison configure Channel3. For checkout configure PayPal sandbox credentials. Keep `PAYPAL_ENV=sandbox`.
2. Optionally seed local sample data.

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

## Show the scripted Reel-to-Marketplace flow

1. Connect the dashboard to the deployed or local API.
2. On Overview, click **Simulate Reel DM · $130 budget**. The API creates the Sony WH-1000XM5 wishlist item with a $120 target and $130 max, then stores Channel3 results when they fit the above-budget story or clearly labeled fixture prices otherwise. The button does not send or fetch an Instagram DM.
3. Follow the dashboard timeline and click **Open listing in Marketplace** when the match appears. The link is a prepared demo listing, not a live Marketplace search.
4. Open the extension side panel. It should select the Sony item and show its $120 target and private $130 max. Click **Start autopilot** to send the opening AI offer. The extension then reacts to seller replies, up to three messages, and pauses on agreement or safety concerns.
5. Review and confirm the accepted price before creating the PayPal sandbox order. Approve with a sandbox buyer account and refresh the payment state.

## Show the local mock seller flow

1. Build the extension with `VITE_BACKEND_URL=http://localhost:3000` and load `extension/dist` as an unpacked Chrome extension.
2. Open `http://localhost:3000/mock-seller/` and open the extension side panel.
3. Add a Sony WH-1000XM5 item with a $145 target and a $160 max. This fits the mock seller's $180 asking price and $140 floor.
4. Open the extension, select the saved Sony wishlist item, and click **Start autopilot**. Fargain sends its opening offer and responds to the mock seller's scripted replies. Keep the side panel open. Autopilot pauses on safety flags, uncertainty, an unverified send control, seller acceptance, or the message cap.
5. Review the seller's accepted price and full terms. Click **Confirm deal & open PayPal**; Fargain creates the PayPal sandbox order and opens checkout.
6. Approve with a sandbox buyer account. Return to Fargain and refresh the payment state.

Autopilot is an opt-in negotiation capability. It does not search Marketplace, and it cannot skip the buyer's price confirmation or PayPal approval. The PayPal sandbox flow demonstrates Fargain's order lifecycle; it does not pay out to the Marketplace seller. On Facebook Marketplace the send adapter is best-effort and must be checked on the exact page before recording; use the included mock seller for repeatable tests.

If a provider is not configured, demonstrate the dashboard and mock seller without that feature. Do not substitute a fake provider response for a missing live integration in a provider smoke test.

## Show price watch and alerts

With Channel3 configured, run the price refresh from the dashboard or call `POST /api/pricing/refresh`. The service checks linked products, saves snapshots, and records eligible price-drop alerts. The seed creates a visible example alert so the dashboard layout can be shown before a live refresh.

## Show Instagram Reel Mode

Paste a public Instagram Reel or post URL into the dashboard. Identification requires Anthropic. If the model returns multiple candidates, choose one explicitly. Link an Instagram professional account only when the Meta app, permissions, webhook URL, and test account are configured. Fargain uses the link, caption, thumbnail supplied by the webhook, or a screenshot; it does not download video.

## Cleanup

For local demo data, stop the backend and remove the local `data/fargain.db` file only if you no longer need its contents. Do not run cleanup against a hosted persistent disk or a database with user data.
