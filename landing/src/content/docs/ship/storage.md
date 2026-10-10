---
title: File storage
description: Where an app keeps uploaded pictures, documents and exports, how much room you get, and what tau does about abuse.
section: ship
order: 6
updated: 2026-10-10
---

An app made with tau can keep files: profile pictures, receipts, documents, a
generated export. Ask for it in plain words ("let people upload a profile
picture") and tau turns file storage on for that app and builds the upload and
download screens.

## Where the files go

Files are kept by tau, not on the app's own server or in your browser. They stay
when the preview is rebuilt or the sandbox expires, which is the point: anything
the app writes to its own disk, or keeps inside the page, is lost the next time
it is rebuilt.

A file goes from the visitor's browser straight to storage. It never passes
through your app's server, so the size of a file is not limited by the server.

Every file is private. Nothing has a public address; your app's server asks for a
short-lived link each time it wants to show or download one.

## Seeing and managing the files

Open **Tools → Storage** in your project.

- How much of your allowance is used, and the largest file you can store.
- Every file: name, folder, type, size and date. Filter by folder, for example
  `users/42/`.
- **Preview** a picture, PDF, text file or media file, **download** any file, or
  **delete** it. Select several to delete them together.
- **Clear preview files** deletes everything uploaded while you test the app in
  the preview. It never touches files on a published app.
- **Replace key** gives your app a new storage key if you think the old one
  leaked. The old key works for another 24 hours so nothing breaks, and your
  files are not touched.

Deleting a project deletes its files. The confirmation says how many.

## Limits

| | Free | PRO |
|---|---|---|
| Stored, across all your projects | 100 MB | 5 GB |
| Largest single file | 10 MB | 100 MB |
| Preview environment, per project | 50 MB | 50 MB |

Turning storage on is free, and so are uploads, downloads and deletes. The limits
exist to keep storage fair, not to charge for it.

**When you reach the limit, new uploads are refused with a clear message.** You
can still list, open and delete files. Nothing is deleted for you. If you move
from PRO to Free while over the Free limit, the same applies: your files stay,
and you cannot add more until you are under it.

## What opens in the browser

Pictures (not SVG), PDF, audio, video and plain text open in place. Everything
else downloads, and **HTML and SVG files always download**, because they can run
code.

## Preview and published apps are separate

Files uploaded while you test in the preview belong to the preview. A published
app has its own files; nothing is copied from one to the other, and deleting a
file in one never touches a file of the same name in the other.

- **Publishing again keeps your published files.** Only the code changes.
- **Taking the app offline keeps its files.** Deleting the project deletes them.
- **Uploads on a published app are not limited by the server.** A visitor can
  upload a file up to your plan's largest size even though a request to a
  published server can carry only about 6 MB, because the file goes straight to
  storage.
- Both environments show under **Tools → Storage**, as **Preview** and **Live**.
  Live appears once the app has been published with storage. **Clear preview
  files** never touches Live.
- Your published app uses its own key, separate from the preview one. **Replace
  key** works on either tab, and a published app picks up the new key within
  seconds without a rebuild.
- Stored files count toward one allowance, preview and published together.

## What you need

- **A verified email address.** Anyone who uses your app can upload to it, and
  tau needs an address that somebody answers.
- **A server.** An app that stores files needs one, so tau adds one in place if
  your app does not have it. On the Free plan that counts as your one app with a
  server once you publish.

## What tau does about abuse

Any type of file can be stored. Tau does not scan what is in them, and storing a
file is not approval of it. **You are responsible for everything your app stores,
including what other people upload to it**, and the
[Terms of Service](/terms) set out what is not allowed (section 6), what tau may
do about it (section 9) and who is responsible for what (section 7).

If a project is reported, or its storage looks like abuse, tau can **suspend** it:
nothing can be uploaded and no file can be opened, and the files are kept for the
time being. Tau may also delete files, take an app offline or close an account,
and may share information with the authorities. The Storage pane tells you when
storage has been suspended. Suspending a published site suspends its files with
it.

**Report abuse or an infringement** to
[iammadfortech@gmail.com](mailto:iammadfortech@gmail.com) with the address of the
app or file and what is wrong. That is the only contact for reports.

If your app lets strangers upload, ask tau to require sign-in for uploads and to
cap the size and number of files per person. Without that, anyone who finds the
page can use up your allowance.

## Next

- [Secrets](/docs/ship/secrets)
- [Deploying](/docs/ship/deploying)
- [Limits](/docs/billing/limits)
