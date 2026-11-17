# Mori companion

Mori is an optional animated cooking companion on signed-in recipe and AI pages.
It uses the existing rat-chef artwork and cook-book styling. The floating
navigation menu has been replaced by a compact conversation bubble.

## Interaction and state

Clicking Mori opens the non-modal chat and focuses its composer. Enter sends a
message; Shift+Enter adds a line. Closing the bubble preserves its conversation
in memory across route changes. Refresh or account change clears the messages.
The separate settings button can hide Mori, and **Show Mori** restores it.

The character itself supports pointer-capture dragging with a six-pixel click
threshold, viewport clamping, and arrow-key movement. Position and visibility are
stored per signed-in user. On narrow screens the chat becomes a bottom sheet and
tracks the visual viewport when a mobile keyboard opens. Mori yields to a modal
dialog and respects reduced-motion preferences.

## Workflow activity

Workflow owners set the shared activity context: browsing rests, image upload
shows curiosity, extraction and generation show work, a confirmed recipe save
celebrates briefly, and recoverable failures show concern. Mori's local state
machine adds hover, dragging, thinking, replying, and error states. These states
follow actual requests and save confirmations; no timer pretends a workflow
completed.

Dashboard guidance remains available inside the chat when it has a useful action,
such as clearing a search. Quick AI Entry and AI Chef are available in the shared
journal navigation alongside New recipe. The chat itself is not an action menu.

## Chat service

The browser sends authenticated conversation turns and page context to
`POST /functions/v1/mori-chat` through `apiClient`. The Edge Function validates
the request, reserves the shared per-user daily AI quota, and uses the existing
Gemini adapter. For saved-recipe questions it retrieves rows through the
authenticated caller's Supabase client and existing RLS; a current recipe ID is
also filtered by `user_id`. The server re-validates recipe ownership and bounds
the context before prompting Gemini. Recipe content and conversation text are
untrusted data.

Mori can answer cooking questions and refer to retrieved saved recipes. Chat does
not save, edit, or delete data. Those actions remain in the existing recipe
workflows and require their normal user confirmation. Enable the endpoint per
environment with `AI_MORI_CHAT_ENABLED=true`; `AI_MORI_CHAT_DISABLED=true`
overrides the opt-in. It reuses the server-side `GEMINI_API_KEY` and shared daily
 quota. See the [AI integration contract](../api/ai-integration.md#post-mori-chat).

## Verification

Component tests cover chat loading, success, errors and retry, close/reopen
history, pointer dragging, keyboard movement, settings, activity and viewport
clamping. The signed-in browser acceptance script uses only intercepted API
responses, checks the request contract, mobile sheet, reduced motion, keyboard
controls, route scope and per-user preference persistence. It does not call
hosted Supabase or Gemini:

```sh
cd frontend
node e2e/mori-dialogue.browser.mjs
```

Automated accessibility checks do not substitute for a manual screen-reader
session or physical-device testing.
