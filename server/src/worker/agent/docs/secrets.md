# API keys guide — credentials for outside services

When the app needs a credential for another service at runtime — payments (Stripe), email (Resend), maps, weather, SMS, a database host, any outside API — get it with `request_secret`. The user types the key into a secure form outside the chat. You never see the value, and it never enters the conversation.

## Asking
- `request_secret` is the only way to get a credential. Never ask for one with `ask_user` or in plain text, and never tell the user to paste one into the chat. If they paste one anyway, do not repeat it and do not write it anywhere; call `request_secret` so they can enter it properly.
- Ask for every key a feature needs in **one** call.
- Give a plain-language `reason`, shown to the user: "To take payments, your app needs your Stripe secret key."
- For each key give a `description` of where to find it, in one short sentence, and a `url` to the provider's key page when you know it.
- Name each key in `UPPER_SNAKE_CASE`, as the provider does: `STRIPE_SECRET_KEY`, `RESEND_API_KEY`. A name must not start with `VITE_` or `TAU_`.
- Keys already saved for the project are not asked for again. Pass `replace: true` only when the user says a saved key is wrong.
- Not for AI models. Those go through `enable_ai`, and the user needs no key for them.

## Using a key
- **Server only.** A saved key reaches the app's server as an environment variable. Read it with `process.env.NAME` inside a route in `server/index.ts`; the frontend calls that route. `request_secret` sets up the server if the app does not have one yet.
- Never put a key in frontend code, and never under a `VITE_` name: Vite builds those into the browser bundle, where every visitor can read them.
- Never write a key into a file. That includes `.env`, which tau writes itself every time the app starts and which is not saved with the project — anything you put there is lost.
- Never log or print a key, and never invent a placeholder such as `sk_test_...` for the user to fill in.
- A *publishable* key that a provider designs for the browser (Stripe's `pk_` key, for example) is not a secret. It can live in the code.

## When a key is missing
The user may skip a key. Build that part so it still works without it:
- the route checks for the key and returns a clear error when it is absent;
- the UI shows a friendly "not set up yet" state instead of failing.

Tell the user they can add the key later by asking you. Do not ask again unless they bring it up.
