# Fargain hackathon demo

## The story

### The problem

You’re on the couch after a hard day, scrolling through a GRWM Reel, when you spot something you really want. Then the feeling turns into work. What exactly is the product? Is the price fair? Is there a better deal somewhere else? Could you find it used? Would you even know what to say to the seller? Each question means more tabs, more searching, and more effort. Eventually the excitement fades and the purchase gets abandoned—not because you stopped wanting it, but because getting it felt like a second job.

### What we’re building

Fargain bridges inspiration and purchase. The shopper shares a Reel; AI identifies the product, and Channel3 checks retailer offers and suggests a price target. If the new price is over budget, the shopper can look for a used listing on Marketplace. Once they open one and opt in to autopilot, Fargain reads the listing and conversation and negotiates with up to three guarded messages within the shopper’s maximum. It pauses on risk, uncertainty, or seller acceptance so the shopper can verify the full terms and confirm the agreed price. PayPal Orders v2 then takes the sandbox checkout through buyer approval, capture, and payment status. Less searching and message-writing means more time enjoying the things you love.

## 2:50 video walkthrough

**Video title:** From “I want that” to “I got it” | Fargain

**Visual direction:** Make it feel like one satisfying journey. Open with a quiet after-work scroll, then let the screen move through three colorful beats: **SPOT IT** (Instagram), **MAKE IT WORK** (price and negotiation), **MAKE IT YOURS** (PayPal). Keep captions short, UI zoomed in, and transitions clean. Record the real app on the device it was built for; use simple text overlays only, no fake product screens.

| Time      | Show                                                                                                                                                                                                   | Say                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:25 | Open on the Instagram tab in Fargain with the prepared Reel link ready. State the buyer problem first, then introduce Fargain and the PayPal + AI connection.                                          | “You’re on the couch after a hard day, scrolling a GRWM Reel, and spot something you love. Then come the tabs, the price doubt, and the awkward message you don’t have energy to write. Too often, the desire ends in an abandoned cart. Fargain turns that inspiration into a purchase journey: AI identifies products and drafts offers, Channel3 checks prices, and PayPal completes checkout after the buyer approves. Let me show you.” |
| 0:25-0:48 | Paste the prepared public Reel for Sony WH-1000XM5 headphones. Show AI identification, choose the right candidate if needed, then open Wishlist and show the Channel3 best price and suggested target. | "I send Fargain the Reel for these Sony headphones. AI identifies the product, then Channel3 checks current retailer offers and adds the find to my wishlist. I confirm the match and can see what new ones cost."                                                                                                                                                                                                                           |
| 0:48-1:05 | Show the live best new-retail price in Wishlist. Set the target to $145 and the maximum to $160.                                                                                                       | "The new price is $[Channel3 price], above what I want to spend. I set a $145 target and a firm $160 maximum. The maximum stays private on the server, so the negotiation model never sees it."                                                                                                                                                                                                                                              |
| 1:05-1:23 | Open the prepared Sony WH-1000XM5 Marketplace listing, condition Used - Like New, asking $180. Select the matching wishlist item and click Start autopilot.                                            | "I find the same headphones used for $180. I start Fargain with my $160 ceiling. It can handle the back-and-forth, but it cannot reveal or cross my limit."                                                                                                                                                                                                                                                                                  |
| 1:23–1:43 | Keep the panel open as the mock seller replies. Show Fargain automatically sending its next safe reply. If the seller accepts under max, show autopilot pausing.                                       | “Now the agent handles the back-and-forth. It reads each reply, checks for risk, and responds within my limit. I don’t have to write every message or babysit every turn. When the seller accepts, Fargain pauses so I can verify the full terms.”                                                                                                                                                                                           |
| 1:43-1:58 | Review the full deal, then click Confirm deal and open PayPal. Show Fargain creating the sandbox order and opening PayPal.                                                                             | "The accepted price is within my ceiling. I check the full terms and confirm the deal. One click creates the PayPal checkout; the agent cannot approve a price or add costs on my behalf."                                                                                                                                                                                                                                                   |
| 1:58-2:30 | Approve in PayPal with the prepared sandbox buyer, return and show completed status.                                                                                                                   | "PayPal gives me the final approval; after that, the sandbox order is captured and Fargain shows the status. This proves the PayPal flow without moving live money."                                                                                                                                                                                                                                                                         |
| 2:30–2:50 | Show the final payment and activity record. End on the Fargain brand.                                                                                                                                  | “AI handled product discovery and the negotiation. Channel3 found the price context. PayPal handled checkout. I set the ceiling and approved the deal. From ‘I want that’ to ‘I got it’—without hours of homework. Fargain: intuitive buying experience.”                                                                                                                                                                                    |

## Recording checklist

- Confirm the hosted Render URL and `/api/health` before recording.
- Prepare one public Reel link that the configured Anthropic model can identify. Instagram identification may return multiple candidates; choose the correct one on camera.
- Use one product consistently: Sony WH-1000XM5 headphones, black. Prepare the same product in the Reel, Channel3 comparison, wishlist, and seller listing. Use a $145 target, $160 max, and a $180 Used - Like New seller listing. The mock seller is configured with a $180 ask and $140 floor, so it can accept within the buyer cap.
- Check Channel3 live before recording. At prep time, Sony lists the WH-1000XM5 at $199.99 and Best Buy at $198. Prices can change, so use the live Channel3 amount in the voiceover. Reference prices: [Sony](https://electronics.sony.com/audio/headphones/headband/p/wh1000xm5-s) and [Best Buy](https://www.bestbuy.com/product/sony-wh-1000xm5-wireless-noise-cancelling-over-the-ear-headphones-black/J7XSRH5CXG).
- For a repeatable demo, use the included mock seller and test the complete autopilot loop before recording. To show Facebook Marketplace, use the prepared listing and test its best-effort send control on that exact page first; Fargain pauses if it cannot identify the control safely.
- Configure PayPal sandbox and pre-authenticate the sandbox buyer in a separate browser profile. Never show credentials.
- Keep browser zoom readable, close unrelated tabs and notifications, and record the Chrome extension on screen.
- Keep the video under three minutes. If PayPal approval or capture is not completed on camera, say so accurately and show the pending approval state; do not imply payment completed.
- Upload the finished video publicly to YouTube and add its URL to the submission. Use original narration and visuals or properly licensed material; do not include unlicensed music or third-party content.

## Seller-side replies for the test listing

Use these replies from the seller account while the Fargain buyer account runs autopilot. Keep the product details and price consistent with the listing; do not mention the buyer's private maximum.

**Listing:** Sony WH-1000XM5 headphones, black; Used – Like New; $180. Include the case and USB-C cable in the description.

1. After Fargain's opening message, reply: “Yes, still available. They’re in like-new condition and include the case and USB-C cable. I’m asking $180, but I’m open to a reasonable offer.”
2. If Fargain offers between $140 and $155, counter: "Thanks. My counter is $160, including the case and USB-C cable." If its offer is already $160, accept that amount instead.
3. When Fargain makes its next offer at or below $160, accept that exact amount: "Yes, I accept your $[the offer]. The case and USB-C cable are included. Pickup this weekend works." Replace the bracketed amount with the agent offer.
4. If Fargain asks about condition or accessories, answer those details directly, then return to the price. Keep the conversation on Marketplace and avoid adding unrelated payment or contact requests, which should correctly trigger Fargain’s safety pause.

If the agent’s first offer is already at or below the seller’s acceptable price, accept that actual offer instead of forcing extra turns. Autopilot stops on acceptance so the buyer can review the terms and confirm the price.

## Submission description

Fargain is an AI-powered shopping agent for the moment a product catches your eye. Share an Instagram Reel or post; AI identifies the product and Channel3 compares retailer offers. If the new price is over budget, find a used listing and opt in to Fargain autopilot. It negotiates with up to three guarded messages within a server-enforced maximum, then pauses when the seller accepts or the conversation needs human judgment. The buyer confirms the full deal and approves the PayPal sandbox checkout. Fargain handles the tedious shopping work while the buyer sets the limits and makes the final purchase decisions.

## Tools used

- **Anthropic API:** identifies products from supported Instagram link context, drafts bounded negotiation messages, and extracts seller agreement/risk signals. The buyer maximum is not sent to the model.
- **PayPal Orders v2 sandbox:** creates orders, requests buyer approval, captures approved orders, and reports payment status.
- **Channel3 API:** matches products across retailers, compares offers, applies manually entered discounts, and supports price-watch alerts.
- **Render:** hosts the Fastify API and dashboard with persistent SQLite storage.
- **Postman:** provides a collection for inspecting and exercising the API.
- **Core stack:** React, Vite, Fastify, TypeScript, SQLite, and a Chrome Manifest V3 extension.

## Hackathon requirement check

| Requirement                                                  | Fargain evidence                                                                                    | Submission status                                               |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Meaningful PayPal and AI integration                         | AI product identification and negotiation; PayPal sandbox order, approval, and capture              | Implemented; show both in the video                             |
| Working prototype judges can run                             | Hosted Render app and setup/run instructions in the repository                                      | Confirm the public URL is healthy before submitting             |
| Documentation and project description                        | README, architecture, deploy guide, demo runbook, and description above                             | Present                                                         |
| Tools identified and explained                               | Tools section above and README                                                                      | Present                                                         |
| Public open-source repository with license at repository top | Public GitHub repository                                                                            | **License file is missing and must be added before submission** |
| Demo video                                                   | Must be under three minutes, show the working app on its target device, publicly visible on YouTube | **Record, upload, and add the link to the submission form**     |
| Official Rules and media rights                              | Follow official rules; use only material you may show                                               | Verify before submitting                                        |
