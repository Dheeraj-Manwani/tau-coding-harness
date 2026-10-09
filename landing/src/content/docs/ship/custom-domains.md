---
title: Custom domains
description: Show your published app at a domain you own, like www.example.com, with HTTPS included.
section: ship
order: 5
updated: 2026-10-09
---

**Connect a domain you already own and your published app appears there**, over
HTTPS, with the certificate handled for you. You add two DNS records where you
bought the domain; tau does the rest.

You need a published app first (see [Deploying](/docs/ship/deploying)). Open
your project, choose **Tools → Domains**, type the domain, and press
**Connect**.

## The two records

Tau shows you two records, each with a copy button:

| Record | What it does |
|---|---|
| **TXT** at `_tau` in front of your name | Proves the domain is yours. Tau will not connect a domain until it sees this. |
| **CNAME** (or **ALIAS** for a root domain) | Sends visitors to your app. |

Add the **TXT** record first. The panel shows each record as *found* or *not
found yet* as tau looks, and the domain moves through **Waiting for DNS →
Verifying → Issuing certificate → Active**. DNS changes can take from a few
minutes to a few hours, and the page updates itself while it waits. You can
press **Refresh** to check straight away.

## `www.example.com` or `example.com`?

**A name with something in front of it, like `www.example.com` or
`shop.example.com`**, takes a CNAME. This is the easy one.

**A root domain, like `example.com`**, can't hold a CNAME, so it takes an
**ALIAS** record instead. Registrars name it differently: ALIAS, ANAME, or a
CNAME on `@` that they flatten for you. If your registrar has none of these,
connect `www.example.com` instead and switch on the registrar's **forward root
to www** setting, so `example.com` sends people to `www`.

## At Hostinger

1. Open **Domains**, choose your domain, then **DNS / Nameservers** and **DNS
   records**.
2. **For `www`:** add a **CNAME** with name `www` and the value tau shows.
3. **For the root:** add a **CNAME** with name `@` and the value tau shows.
   Hostinger treats this as an ALIAS. It allows only one per domain, and it
   makes its own when its CDN is on, so turn **Hostinger CDN off** for the
   domain first (**Domains → your domain → CDN**), and delete any `@` record
   that is already there.
4. Add the **TXT** record with the name and value tau shows. If Hostinger asks
   for the full name, it is `_tau.www.example.com` (or `_tau.example.com` for
   the root).
5. Come back and press **Refresh**.

At other registrars the records are the same; only the screens differ.

## Primary domain

Once a domain is **Active** you can make it **primary**. Your tau address
(`name.bytauai.pro`) then redirects to it, so people only ever see your own
domain. Make a different one primary, or press **Stop being primary**, whenever
you like.

## If it gets stuck

- **Waiting for DNS for a long time.** The TXT record is missing or has a typo.
  Compare its name and value with the table, character for character. Some
  registrars add your domain to the name for you, which would double it
  (`_tau.www.example.com.example.com`).
- **The CNAME says *points elsewhere*.** Another record at the same name
  (a parking page, an old A record, a registrar CDN) is answering. Remove it.
- **Failed.** Tau gives up after 72 hours and says why. Fix the records and
  press **Try again**.

## Things to know

- **Sign-in with another service.** If your app signs in with Google, GitHub or
  similar, add the new address to that service's list of allowed callback URLs.
- **Up to five domains** per project.
- **Removing a domain** stops it working straight away. Your tau address keeps
  working.
- **Wildcard domains** (`*.example.com`) aren't supported. Connect each name.
- **Email on your domain** is unaffected: tau only needs the records above, and
  doesn't touch your MX records.
- Names that belong to tau (anything under `tauai.pro` or `bytauai.pro`) and IP
  addresses can't be connected.
