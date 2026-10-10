---
title: Deploying
description: Publish your app to a public URL, straight from tau.
section: ship
order: 4
updated: 2026-10-09
---

**Tau publishes your app to a public URL.** Open the rocket icon in the top
right of your project, press **Publish**, and you get a link anyone can open -
no account, no host to sign up for, no build settings to configure.

## How it works

Publishing runs your project's own build (`bun run build`) in its sandbox, takes
the static output, and serves it from tau's storage.

1. Press **Publish**. The build streams into the chat like any other job.
2. When it finishes, the panel shows your URL and a copy button.
3. Press **Publish update** whenever you want the live site to catch up. The
   panel tells you how many changes you have made since the last publish.

Each publish is a complete, separate copy. The live site only switches over once
the new build has uploaded successfully: a failed build never takes your site
down, it just leaves the previous version serving.

> [!NOTE]
> Your address is fixed the first time you publish and does not change when you
> rename the project. Links you have shared keep working.

## Choosing your address

Before your first publish, the panel offers an **Address** for your app, such as
`kurinji-leaf.bytauai.pro`. Change it to anything you like: 3 to 40 letters,
numbers and hyphens. The panel tells you as you type whether it is free.

- It is **fixed after the first publish**, so choose it first. Links you share
  keep working because the address never changes.
- Names such as `login`, `billing` and `admin` are reserved, because the domain
  would make a page there look like one of tau's own.
- A name belongs to one project for good. If you delete the project, nobody else
  can take its address, so an old link can never open a stranger's app.
- This is not the title in a browser tab. That is the **Name** under **Name and
  logo**, and you can change it any time.

## What it costs

The first publish of a project costs **200 credits**, taken when that first
build goes live. A free account starts with 300, so one publish takes most of
them: that is intended. Everything after is free: publishing updates, rolling
back, taking the site offline and publishing it again.

- A publish that fails costs nothing.
- The price is on the **Publish** button, with your balance beside it. If you
  can't cover it, the button is disabled and links to buying credits.

## Name and logo

Open **Name and logo** in the panel to set what your app is called. All three
are optional, and anything you leave alone keeps its default.

- **Name** is the title in a browser tab and in a link someone shares. It is
  not your address, and you can change it whenever you publish.
- **Description** is the line under the name in a shared link.
- **Logo** is the icon in the tab. Every app starts with tau's. **Upload logo**
  takes a PNG or SVG and costs 25 credits to save. **Generate logo** (Pro) makes
  a picture for 20 credits each; keeping a generated one costs nothing more.

These are written into your project like any other change, so they appear in
your files, in a GitHub push and in the count of unpublished changes. Publish
to put them on the site.

## What gets published

The front-end. That is the whole app for a frontend-only project, and it is what
most projects are.

If your project has a **backend**, publishing also puts your server online. It
is checked first, built into a single file, started on its own, and called once
before your site switches over, so a server that fails to start never replaces
the version that works. Your `/api` routes then answer at your site's address.

A few things to know about a hosted backend:

- It runs when a request arrives and sleeps when there are none, so the first
  request after a quiet spell can take a second or two longer.
- **No WebSockets.** Requests and responses only (streamed responses work).
- A request body can be up to 6 MB, and one request can run for about 15 seconds.
- Nothing is kept in memory or on disk between requests. Keep data in a
  database, not in a variable or a file.
- Your secrets are available to the server as environment variables, up to 4 KB
  in total.

If your project has **file storage** (uploads, pictures, documents), your
published app gets its own files too. **Files uploaded in the preview are not
copied**, publishing again keeps what visitors uploaded, and taking the app
offline keeps it. Deleting the project deletes the files. See
[File storage](/docs/ship/storage).

If your project has a **database**, your published app gets its own, separate
Postgres. **Preview data is not copied to it**: the published database starts
empty, and what visitors add there is kept across every later publish.

- Publishing again keeps your data. New tables are created, and a column you
  add to a table is added to the published database as long as it is optional
  or has a default.
- If you remove a column, change its type, or add a required column with no
  default, the publish stops and lists what changed. Nothing is published
  until you choose **Publish anyway**. Tau then takes a restore point first,
  adds what is new, and leaves your existing data as it is.
- **Download your data** in the Publish panel gives you every table as a CSV
  file, plus the schema.
- Taking the app offline keeps the database. Deleting the project removes it
  after 7 days.

## When a build fails

The panel shows the error with a **Fix with tau** button beside it. Press it and
tau gets the error and the end of the build log, fixes what stopped the build,
and tells you in the chat when it is done. Then publish again.

Your live site is not affected while this happens: it keeps serving the last
version that published successfully.

Type errors alone will not block you: if your code bundles but fails its type
check, tau publishes anyway and says so. The errors are still worth fixing.

## Rolling back

Open **History** in the Publish panel to see your recent publishes. Press
**Roll back** next to an earlier version and it is live again within seconds.
Nothing is rebuilt, because tau still has that version's files.

- Rolling back changes the published site only. Your project's code stays as it
  is, so the next **Publish update** publishes your current code again.
- The version you rolled back from stays in the history, so you can switch back
  to it the same way.
- An earlier version can be restored for 7 days after it stops being the live
  one. After that it is listed as **Expired**.

## Taking a site offline

Press **Take offline** at the bottom of the panel and confirm. The link stops
working straight away and visitors see a "not published" page.

Your address stays reserved for the project, and nothing in the project changes.
To bring the site back, press **Restore** next to the version in the history, or
publish again.

> [!NOTE]
> You need a verified email address to publish. Tau can also suspend a published
> site that breaks its rules. The panel then says why, and publishing is paused
> until the suspension is lifted.

## Deploying somewhere else

Publishing from tau does not lock anything in. Tau builds ordinary web projects -
there is no tau runtime to depend on and nothing to eject from: so you can
also push to GitHub and point Vercel, Netlify, Fly, Render or Cloudflare Pages
at the repo. See [GitHub](/docs/ship/github).

That is still the right route if you want to run the project on your own infrastructure.

## What about the environment?

If tau wired the AI gateway into your app, it set two variables in the sandbox.
Those live on the sandbox, not in your repo: a deploy elsewhere needs them set
on that host too:

```bash
TAU_AI_URL=https://api.usetau.dev/ai
TAU_API_KEY=tau_sk_live_...
```

Copy the key from your billing page. Rotating it there does not update a deploy
you made elsewhere; you will need to paste the new one.
