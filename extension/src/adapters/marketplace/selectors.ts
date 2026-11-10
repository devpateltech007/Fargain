/**
 * Facebook Marketplace selectors. BEST EFFORT: Facebook's class names are obfuscated and change
 * often, so these lean on URLs, ARIA roles/labels and contenteditable, which change less.
 * Lists are tried in order; the first match wins. When Facebook changes its markup, this is the
 * only file to edit. The side panel's "Page check" shows which entries matched.
 *
 * NOT verified against a live logged-in page yet (Facebook requires login). Fixture tests use
 * synthetic HTML modeled on these hooks.
 */
export const MARKETPLACE = {
  /** Hosts the adapter is allowed to run on. */
  hosts: ['www.facebook.com', 'web.facebook.com', 'm.facebook.com'],
  /** /marketplace/item/<numeric id> */
  itemPath: /^\/marketplace\/item\/(\d+)/,
  /** Messenger thread pages where Marketplace chats open full-page. */
  threadPath: /^\/(messages\/t|marketplace\/t)\/\d+/,

  listing: {
    root: ['[role="main"]', 'body'],
    title: ['[role="main"] h1 span', '[role="main"] h1', 'h1'],
    /** Text nodes near the title that look like a price ("$150", "US$150", "Free"). */
    priceCandidates: ['[role="main"] h1 ~ div span', '[role="main"] span[dir="auto"]'],
    sellerLink: ['a[href*="/marketplace/profile/"]'],
    image: ['[role="main"] img[alt*="Product photo"]', '[role="main"] img[src*="scontent"]'],
    /** Section headings whose following text is the description / details. */
    descriptionHeadings: ['Description', 'Details', "Seller's description"],
    conditionLabels: ['Condition'],
    locationLabels: ['Location', 'Listed in'],
  },

  chat: {
    /** Chat containers: full-page thread or the Marketplace popup chat. */
    container: [
      '[role="main"] [aria-label^="Messages in conversation"]',
      '[aria-label^="Messages in conversation"]',
      '[role="dialog"] [role="grid"]',
      '[role="main"] [role="grid"]',
    ],
    row: ['[role="row"]'],
    /** Message text inside a row. */
    text: ['div[dir="auto"]'],
    /** Screen-reader labels Messenger puts on the user's own messages. */
    ownMessageMarkers: ['You sent', 'You:'],
    /** Link to the listing shown in the chat header. */
    listingLink: ['a[href*="/marketplace/item/"]'],
    /**
     * The message box, most specific first:
     *  1. chat popup / thread: Lexical editor (contenteditable div, role=textbox)
     *  2. item page "Send seller a message" box for a first contact: unconfirmed type, so both a
     *     textarea and a labelled textbox are tried (live check showed the Lexical selectors miss it).
     */
    compose: [
      '[role="dialog"] div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"][role="textbox"][aria-label*="essage"]',
      '[role="main"] textarea',
      '[role="main"] [role="textbox"]',
      '[role="main"] input[type="text"][aria-label*="essage"]',
      'div[contenteditable="true"][role="textbox"]',
      '[role="dialog"] textarea',
    ],
    /**
     * Live check (item page, first contact): two unlabelled textareas inside role=main, no dialog.
     * When several candidates match, prefer a visible one whose nearby text contains a hint.
     */
    composeHints: ['Send seller a message', 'Message seller', 'Send a message'],
    /** How many ancestor levels to search for a hint. */
    hintDepth: 4,
    /** Anything that could be a text box; listed by the side panel "Page check" for debugging. */
    editableProbe: 'textarea, input[type="text"], [contenteditable="true"], [role="textbox"]',
  },
} as const;
