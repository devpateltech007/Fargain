# Fargain demo script

## The story

After a long day, a shopper sees Sony headphones in an Instagram Reel. The new price is over budget, and the shopper has no energy to compare stores or negotiate with a stranger. Fargain turns that moment into a guided buying journey. Anthropic AI identifies the product and negotiates, Channel3 compares retailer prices, and PayPal Orders v2 powers buyer-approved sandbox checkout.

## 2:30 video walkthrough

**Title:** From “I want that” to “I got it” | Fargain

| Time | Show | Say |
| --- | --- | --- |
| 0:00–0:25 | Open on the Reel. Establish the problem and explain PayPal up front. | “After a long day, I see headphones I want in a Reel. Then I have to identify them, compare prices, and figure out whether a used deal is worth pursuing. Fargain connects that journey. Anthropic AI identifies the product and negotiates, Channel3 compares retailer prices, and PayPal Orders v2 powers a checkout the buyer approves. Let me show you.” |
| 0:25–0:48 | On the dashboard click **Simulate Reel DM · $130 budget**. Show the Sony item appear. Explain that this button stands in for the real Instagram DM during this recording. | “In the real flow, I send the Reel and my $130 budget to Fargain. For this repeatable demo, one button simulates that incoming DM. The Sony item and private maximum now appear on my dashboard.” |
| 0:48–1:05 | Show the Channel3 price comparison and the over-budget step. Point out the $120 target and $130 maximum. Say whether the card shows live results or the labeled demo fixture. | “Fargain checks new retailer offers. They are above my $130 limit, so it keeps my $120 target and moves on to a used listing.” |
| 1:05–1:23 | Click **Open listing in Marketplace**. Open the Fargain side panel; confirm the Sony item is selected with a $120 target and $130 max, then click **Start autopilot**. | “Fargain found this prepared Marketplace listing. I start autopilot, and its opening offer goes to the seller. My $130 maximum stays private.” |
| 1:23–1:43 | Keep the panel open. Show the agent’s messages and seller replies. Have the seller accept only after the agent offers $120. | “The agent responds to the seller within my limit. When the seller accepts $120, Fargain pauses so I can review the terms. That leaves $10 of my budget unused.” |
| 1:43–2:05 | Confirm the accepted price and create the PayPal checkout. Show PayPal sandbox approval. | “PayPal Orders v2 creates a sandbox order for the agreed $120. I review and approve it in PayPal. Fargain captures the approved order and reports its status.” |
| 2:05–2:30 | Return to Fargain and show the payment status and activity record. End on the brand. | “Anthropic AI handled product identification and negotiation. Channel3 checked the new price. PayPal handled buyer-approved sandbox checkout. I set the limit and approved the purchase. Fargain makes buying feel intuitive.” |

## Recording checklist

- Confirm the Render URL and `/api/health` before recording.
- Use the dashboard’s **Simulate Reel DM** button for this recording. It does not fetch or send an Instagram DM. The endpoint creates the Sony wishlist item and records price snapshots. It uses Channel3 when eligible results are above budget, otherwise the displayed prices are labeled demo fixtures.
- The demo item sets a $120 target and $130 maximum. The prepared listing URL is `https://www.facebook.com/marketplace/item/1469470546248672/`; it is a curated match, not live Marketplace search. Confirm it opens and the extension can read the listing and seller chat.
- Starting autopilot sends the first AI offer. The seller should reply: “Thanks for the offer. I can do $130.” If the agent counters at $120, reply: “Deal at $120. I accept.” If the actual offer differs, respond to the visible offer and accept only the price both sides actually agree to.
- Configure PayPal sandbox and pre-authenticate the sandbox buyer in a separate browser profile. The current Orders v2 flow demonstrates approval and capture in Fargain’s sandbox merchant account. It does not transfer funds to the Facebook seller. Do not describe it as a seller payout.
- Keep browser zoom readable, close unrelated tabs and notifications, and keep the extension side panel open while the agent waits for seller replies.
- If PayPal approval or capture does not complete on camera, show the actual pending state and describe it accurately. Do not imply payment completed.
- Keep the video under three minutes and use visuals you have permission to show.

## Seller replies for the prepared listing

Use the real listing details and do not mention the buyer’s private maximum.

1. After Fargain’s opening message, reply with the actual condition and accessories, then say: “I’m asking $[listing price], but I’m open to a reasonable offer.”
2. If Fargain offers below $120, reply: “Thanks for the offer. I can do $120, including the accessories shown.”
3. When Fargain offers $120, accept that exact offer: “Deal at $120. I accept. The accessories shown are included.”
4. If a seller asks for off-platform payment or personal contact details, answer normally only if safe; Fargain should pause on the risk flag.

Do not force an acceptance before Fargain offers $120. If the agent does not reach $120 in three messages during rehearsal, adjust the listing or seller counters and rehearse again. Never narrate a price that is not visible in the conversation.

## Submission description

Fargain is an AI shopping agent for the moment a product catches your eye. DM an Instagram Reel and budget; Anthropic AI identifies the item, and Channel3 compares retailer offers. When new prices exceed the budget, Fargain can open a prepared Marketplace match and its opt-in negotiator handles up to three guarded messages within the buyer’s server-enforced maximum. The buyer reviews the seller’s acceptance and approves a PayPal Orders v2 sandbox checkout. The demo shows buyer approval and capture in Fargain’s sandbox merchant account; it does not settle funds to the Marketplace seller.

## Tools used

- **Anthropic API:** identifies products from supported Reel context, drafts bounded negotiation messages, and extracts seller agreement and risk signals.
- **Channel3 API:** searches retailer offers, compares prices, applies profile discounts, and supports price-watch alerts.
- **PayPal Orders v2 sandbox:** creates orders, requests buyer approval, captures approved orders, and returns payment status.
- **Render:** hosts the Fastify API and dashboard with persistent SQLite storage.
- **Core stack:** React, Vite, Fastify, TypeScript, SQLite, and a Chrome Manifest V3 extension.

## Requirement check

| Requirement | Fargain evidence | Submission status |
| --- | --- | --- |
| Meaningful PayPal and AI integration | AI product identification and negotiation; PayPal sandbox order, approval, and capture | Show both in the video |
| Working prototype | Hosted Render app and repository setup instructions | Confirm public URL and integrations before submission |
| Documentation and project description | README, architecture, deploy guide, demo runbook, and description above | Present |
| Tools identified and explained | Tools section above and README | Present |
| Public repository with license | Public GitHub repository | Confirm the license file is present |
| Demo video | Under three minutes, publicly visible on YouTube | Record and add the URL to the submission |
| Rules and media rights | Use only media you have permission to show | Verify before submitting |
