<div align="center">

<img src="assets/banner.svg" alt="ANTI-REA" width="100%">

<br>

[![Version 0.1](https://img.shields.io/badge/version-0.1-FFC24B?style=for-the-badge)](#roadmap)
[![MIT License](https://img.shields.io/badge/license-MIT-7C6CFF?style=for-the-badge)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](#)
[![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)](#install-in-3-steps)

**[Português](README.md)** · **[Docs (pt-BR)](docs/README.md)**

</div>

> [!NOTE]
> **Version 0.1: the gatekeeper works. The self-scan and the log panel come next.**
> Check the [roadmap](#roadmap) for what already runs. Nothing here promises what does not run yet.

## In one sentence

ANTI-REA is a **gatekeeper** that sits in front of your website. Real people browse normally.
Reverse-engineering tools, copier bots and attack scanners land on a **shadow page** with a sarcastic
message, at the same address, and you get an **instant alert** on your phone.

Works with any site (Next.js, WordPress, Laravel, plain HTML). No changes to your code; WordPress
only needs a few exempt paths (see the Portuguese
[configuration guide](docs/03-configurar.md#wordpress-feeds-e-cdn)).

## How it works

<img src="assets/diagramas/como-funciona.svg" alt="How ANTI-REA works" width="100%">

1. **Every visitor goes through the gatekeeper**, which reads who is asking and what for.
2. **First visit: a sub-second browser check.** Visitors who pass get a signed pass for days.
3. **Official bots** (Google, Bing, Apple, Meta) are verified by reverse DNS or published IP ranges.
   Link-preview bots (WhatsApp, Telegram and others) get the check page, which carries your title,
   description and image.
4. **Caught visitors** get the shadow page. You get an alert (WhatsApp, Telegram or webhook).
   With the default settings, a REA session attached to a visible tab is caught too: the guard
   checks every 0.5 s (up to about 0.6 s on a very busy page; on a very slow device it backs off to
   1 s and then 1.5 s) and does not check hidden tabs. REA's default short inspection was caught 20 times out of 20 in our
   measurements, but in 2 of them it had already read the page and the scripts that tab loaded
   (details in the [Portuguese FAQ](docs/perguntas-frequentes.md)).

It also locks source maps, `.env`, `.git` and backups for everyone. A **self-scan** that shows what a
curious visitor can see of your site comes next.

> [!IMPORTANT]
> No tool can stop 100% of copying of what the browser receives. ANTI-REA raises the cost, reports
> and deceives. It does not make your site invisible.

## Install in 3 steps

The `anti-rea` package is not on npm yet: it ships with the first published release. Until then,
run it from this repository (`npm ci && npm run build`, then `node dist/cli/index.js init`).

```bash
npx anti-rea init     # wizard: asks your site address, what sits in front of it and alert channel
npx anti-rea start    # gatekeeper up on :8080
```

Then point your domain to the gatekeeper instead of the site. The Docker image
`ghcr.io/jeipidevs/anti-rea` ships with the first published release; until then, build it from this
repository with `docker build -t anti-rea .`.

Behind a proxy (nginx, Traefik, EasyPanel, Coolify), set `trustProxy: true`; behind Cloudflare, set
`trustProxy: cloudflare` and let only Cloudflare's addresses reach the server. Either way, the
gatekeeper port must be reachable only through the proxy (publish it as `"127.0.0.1:8080:8080"`),
or anyone can pick their own IP with a header.

## Roadmap

- [x] Project, brand and docs
- [x] Reverse proxy with server-side rules
- [x] First-visit browser check
- [x] Official bot verification
- [x] Configurable shadow page
- [x] Alerts: WhatsApp (Evolution API), Telegram, webhook
- [x] `npx anti-rea init` wizard
- [ ] Published Docker image
- [ ] Self-scan
- [ ] Log panel

## Responsible use

ANTI-REA defends. The shadow page never runs anything against the visitor. The self-scan (coming next) will
only run on domains you prove you control and will only read. IP addresses are personal data (GDPR, LGPD): mention
the collection in your privacy policy.

## Credits

Built by studying the logic of [REA (Reverse Engineer Anything)](https://github.com/morluto/rea) to
learn how to defend against it. **Independent project**, not affiliated with REA or its authors.
MIT licensed. Made in Brazil by JPStudio.
