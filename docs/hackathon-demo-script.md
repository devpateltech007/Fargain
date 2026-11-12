# Fargain hackathon demo

## 2:45 video walkthrough

**Video title:** Fargain — an intuitive buying experience with AI and PayPal

**Format:** One continuous screen recording with a clear voiceover. Keep the live UI readable, show the buyer approving each important action, and finish before 3:00.

| Time      | Show                                                                                                                                                                                                     | Say                                                                                                                                                                                                                                                              |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:15 | Start on the Fargain dashboard, then cut to a product page.                                                                                                                                              | “Buying online is full of small decisions: is this a fair price, should I make an offer, and can I trust how the seller wants to be paid? Fargain brings those decisions into one intuitive buying experience.”                                                  |
| 0:15–0:38 | Open the Chrome side panel on an Amazon product page. Show Amazon price, Channel3 offers from other retailers, and the best eligible price.                                                              | “Fargain compares the product across retailers with Channel3. It filters unreliable matches, shows where the best offer comes from, and applies only discounts I entered myself. Here, I can see the comparison before I decide.”                                |
| 0:38–0:55 | Add the item to the wishlist with a target and maximum price. Show the wishlist row in the dashboard.                                                                                                    | “I set a target price and a firm maximum. That maximum stays on the server. It is never sent to the negotiation model, so the model cannot reveal it to the seller.”                                                                                             |
| 0:55–1:27 | Switch to the prepared mock Marketplace seller and open the Fargain side panel. Generate a draft, review it, then click the page’s Send button yourself. Show the seller’s counter.                      | “Now the AI reads the listing and conversation and drafts a respectful opening offer. I review the wording and send it myself. Fargain helps with the work, but I stay in control of what the seller receives.”                                                  |
| 1:27–1:45 | In the side panel, enter a test agreed price above the maximum and submit. Show the server rejection.                                                                                                    | “Let me try to confirm a price above my limit. The backend rejects it, even if a client is changed. This is a real server-side money guardrail, not a prompt asking the model to behave.”                                                                        |
| 1:45–2:25 | Confirm the seller’s acceptable price below the max. Create the payment, show PayPal’s sandbox approval page, approve with the prepared sandbox buyer, then return to Fargain and show completed status. | “At an acceptable price, I confirm the deal. Fargain creates a PayPal sandbox order. PayPal asks me to approve it, and only after my approval does the order complete. The payment is real to the sandbox flow, but no live money moves.”                        |
| 2:25–2:45 | Return to the dashboard’s payments and activity screens. End on the Fargain wordmark and tagline.                                                                                                        | “The result is an AI-assisted purchase with visible price evidence, a human-approved negotiation, and a buyer-approved PayPal payment. Fargain makes buying more intuitive without handing control of a buyer’s money to an agent. Intuitive buying experience.” |

## Recording checklist

- Use the public Render URL and confirm `/api/health` returns successfully before recording.
- Prepare a test item with a target and max price, a working Anthropic key, Channel3 credentials, and PayPal sandbox credentials.
- Use the included mock seller for a repeatable conversation. Keep a standard seller tab ready for the paid flow.
- Pre-authenticate the PayPal sandbox buyer in a separate browser profile before recording, so the approval step fits the time limit. Do not show account credentials.
- Keep the browser zoom at a readable level and close unrelated tabs and notifications.
- Record the Chrome extension on screen. The challenge requires showing the project functioning on the device it was built for.
- If sandbox login takes too long, show the `PAYER_ACTION_REQUIRED` order and its PayPal approval link, then state that buyer approval is the next step. Do not imply capture happened if it did not.
- Upload the finished video publicly to YouTube, keep it under three minutes, and add its URL to the hackathon submission.

## Submission description

Fargain is an AI-powered buying assistant that helps shoppers compare prices, set a private spending limit, negotiate with sellers, and complete purchases through PayPal. Channel3 finds cross-retailer offers and price drops. Anthropic identifies products and drafts negotiation messages, while deterministic server-side rules keep the buyer’s maximum price private, reject over-limit agreements, and flag risky off-platform payment requests. The buyer reviews every draft, sends every seller message, confirms the agreed price, and approves each PayPal sandbox payment. Fargain explores agentic commerce while keeping money movement transparent and buyer-controlled.

## Tools used

- **Anthropic API:** structured product identification and negotiation drafts. The model never receives the buyer’s maximum price.
- **PayPal Orders v2 sandbox:** order creation, buyer approval, capture, and payment status.
- **Channel3 API:** cross-retailer product matching, offer comparison, discount calculations, and price-watch alerts.
- **Render:** hosted Fastify API and dashboard with persistent SQLite storage.
- **Postman:** import `postman/Fargain.postman_collection.json` to inspect and exercise the API.
- **Core stack:** React, Vite, Fastify, TypeScript, SQLite, and a Chrome Manifest V3 extension.
