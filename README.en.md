<div align="center">

<img src="assets/banner.svg" alt="ANTI-REA" width="100%">

<br>

[![Version 0.2.0](https://img.shields.io/badge/version-0.2.0-FFC24B?style=for-the-badge)](#history-and-releases)
[![npm](https://img.shields.io/npm/v/@jeipidevs/anti-rea?style=for-the-badge&logo=npm&color=CB3837&label=npm)](https://www.npmjs.com/package/@jeipidevs/anti-rea)
[![MIT License](https://img.shields.io/badge/license-MIT-7C6CFF?style=for-the-badge)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](#)
[![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)](#install-in-3-steps)

**[Website (Portuguese)](https://jeipidevs.github.io/anti-rea/)** · **[Português](README.md)** · **[Docs (pt-BR)](docs/README.md)**

</div>

> [!NOTE]
> **Version 0.2.0: the gatekeeper runs in production and is on npm. Now with the self-scan and the log panel.**
> Check the [roadmap](#roadmap) for what already runs. Nothing here promises what does not run yet.

## In one sentence

ANTI-REA is a **gatekeeper** that sits in front of your website. Real people browse normally.
Reverse-engineering tools, copier bots and attack scanners land on a **shadow page** with a sarcastic
message, at the same address, and you get an **instant alert** on your phone.

Works with any site (Next.js, WordPress, Laravel, plain HTML). No changes to your code; WordPress
only needs a few exempt paths (see the Portuguese
[configuration guide](docs/03-configurar.md#wordpress-feeds-e-cdn)).

## How it works

<img src="assets/diagramas/como-funciona.svg" alt="Diagram: visitors go through the gatekeeper; verified people and official bots (Google, Bing, Meta) reach the real site; link-preview bots get the check page with title, description and image; REA, copier bots, DevTools and scanners get the shadow page and trigger an alert" width="100%">

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

It also locks these files for everyone, in any folder: source maps (`.map`); `.env`, `.env.*` and
`.envrc`; `.git`, `.svn`, `.hg` and `.DS_Store`; `.htaccess`, `.htpasswd`, `.npmrc`,
`.git-credentials`, `.ssh`, `.aws` and `wp-config.php.*`; files ending in `.bak`, `.old`, `.orig`,
`.save`, `~`, `.swp`, `.swo`, `.sql` and `.sql.gz`; archives (`.zip`, `.tar`, `.tar.gz`, `.tgz`, `.gz`,
`.7z`, `.rar`) whose name starts with `backup` or `bkp` and, at the root, those named `site`, `www`,
`web`, `html`, `public_html`, `htdocs`, `wwwroot`, `db`, `database` or `dump`.

The **self-scan** (`npx @jeipidevs/anti-rea exame https://yoursite.com`) shows what a curious visitor can
see of your site: source maps, sensitive files, APIs that answer without login and secret keys in the
code, with an HTML report. It only reads (GET, HEAD, OPTIONS) and only runs on a site that proves it is
yours through `/.well-known/anti-rea.txt`. The **log panel** opens on your own site at
`/.anti-rea/painel` with your owner pass, or becomes a file with `anti-rea painel`.

> [!IMPORTANT]
> No tool can stop 100% of copying of what the browser receives. ANTI-REA raises the cost, reports
> and deceives. It does not make your site invisible.

## Install in 3 steps

ANTI-REA is on npm ([`@jeipidevs/anti-rea`](https://www.npmjs.com/package/@jeipidevs/anti-rea)) and on GHCR
(`ghcr.io/jeipidevs/anti-rea`). Pick one: Node.js 22 or newer, or Docker.

```bash
npx @jeipidevs/anti-rea init    # wizard: asks your site address, what sits in front of it and alert channel
npx @jeipidevs/anti-rea start   # gatekeeper up on :8080
```

To keep it installed on the machine, run `npm install -g @jeipidevs/anti-rea` and then `anti-rea start`.
The package carries the account scope because npm refused a bare `anti-rea` as too close to an
existing package. Once installed, the command is still `anti-rea`.

Then point your domain to the gatekeeper instead of the site. The gatekeeper speaks plain HTTP on
port 8080: HTTPS comes from what sits in front of it (nginx on the machine, the panel's Traefik or
Cloudflare).

Prefer Docker? Use `image: ghcr.io/jeipidevs/anti-rea:v0.2.0` in the `docker-compose.yml` shown in
the [Portuguese README](README.md#instalar-em-3-passos). The pinned tag keeps the gatekeeper on that
version until you change it.

What sits in front of the gatekeeper sets the port and `trustProxy`; with a trusted proxy, anyone
who reaches the gatekeeper port directly could pick their own IP with a header:

- **nginx or Traefik on the same machine:** `trustProxy: true` and publish the port to that machine
  only (`"127.0.0.1:8080:8080"`).
- **Panel (EasyPanel, Coolify):** `trustProxy: true` and no published port; the panel serves the
  domain through its Traefik.
- **Cloudflare connecting straight to the gatekeeper:** `trustProxy: cloudflare`, the server's port
  80 published to the gatekeeper (`"80:8080"`) and no `127.0.0.1` (Cloudflare could not reach the
  gatekeeper and the site would go down). A firewall that accepts
  only Cloudflare's addresses closes the port to everyone else: see
  [Atrás da Cloudflare](docs/02-instalar.md#atrás-da-cloudflare) (Portuguese).

## Roadmap

- [x] Project, brand and docs
- [x] Reverse proxy with server-side rules
- [x] First-visit browser check
- [x] Official bot verification
- [x] Configurable shadow page
- [x] Alerts: WhatsApp (Evolution API), Telegram, webhook
- [x] Install wizard (`anti-rea init`)
- [x] Published Docker image (`ghcr.io/jeipidevs/anti-rea`)
- [x] Published npm package (`@jeipidevs/anti-rea`)
- [x] Apps with login, PWA and service worker (v0.1.1)
- [x] Self-scan (`anti-rea exame`, v0.2.0)
- [x] Log panel (`/.anti-rea/painel` and `anti-rea painel`, v0.2.0)

## History and releases

ANTI-REA started on 2026-11-20 from a simple question: if a tool like REA can take any site apart
through the browser, can we notice who is doing it and hand them nothing? Docs and brand came first,
then a plan, then the gatekeeper in small test-first steps. The guard was measured against the real
REA ([numbers, Portuguese](docs/_medicoes/2026-11-guarda.md)) before any claim went into this README.

**Current state.** The gatekeeper has run in production since the night of 2026-11-20, in front of
more than 20 static sites and apps with login. Since v0.1.3 it ships in two forms: the
[`@jeipidevs/anti-rea`](https://www.npmjs.com/package/@jeipidevs/anti-rea) package on npm and the
`ghcr.io/jeipidevs/anti-rea` image on GHCR, both on the same version. The fixes in v0.1.1 and v0.1.2 came from that real
use: the log showed where the gatekeeper got in the way, and each case became a test before it became
a release. In the production log, what lands on the shadow page is datacenter bots, WordPress
scanners and automated browsers; no regular visitor.

| Version | Date | What shipped |
|---|---|---|
| [v0.2.0](https://github.com/Jeipidevs/anti-rea/releases/tag/v0.2.0) | 2026-11-22 | **Self-scan:** `npx @jeipidevs/anti-rea exame https://yoursite.com` looks for source maps, sensitive files (checked by content, no false positive on single-page apps), APIs that answer without login and secret keys in the code, with an HTML report. GET, HEAD and OPTIONS only, only on a site proven by `/.well-known/anti-rea.txt`; with the gatekeeper in front, it scans behind it using the owner link, without raising alerts. **Log panel** at `/.anti-rea/painel`, owner pass only, and `anti-rea painel` to write it to a file. Same gatekeeper as v0.1.3. |
| [v0.1.3](https://github.com/Jeipidevs/anti-rea/releases/tag/v0.1.3) | 2026-11-21 | **First npm release:** `npx @jeipidevs/anti-rea init` and `npx @jeipidevs/anti-rea start`, no clone or build. Same gatekeeper as v0.1.2. The package ships only what it needs (compiled code, the example config and the READMEs) and is built from scratch before packing. |
| [v0.1.2](https://github.com/Jeipidevs/anti-rea/releases/tag/v0.1.2) | 2026-11-21 | **Video and audio as public media** (mp4, webm, mov, mp3, m4a, ogg, wav, flac and more): without a pass, a direct video link got a 403 and would not play. **`meta-webindexer` on the Meta list**, verified against the AS32934 ranges: Meta's indexer opens pages in headless Chrome and was landing on the shadow page. 559 tests. |
| [v0.1.1](https://github.com/Jeipidevs/anti-rea/releases/tag/v0.1.1) | 2026-11-20 | **Ready for apps with login** (Next.js, PWA, single page). Configurable `upstreamTimeout` (60 s by default, 1 s to 10 min), so a slow page does not turn into a 504. A caught visitor gets a 403 on script requests instead of the shadow page with a 200, so the app never mistakes it for a response. The pass renews on any response below 400 (204, 304, redirects). `.ttf` and `.otf` count as media. Link readers that do not ask for HTML get the preview. 558 tests. |
| [v0.1.0](https://github.com/Jeipidevs/anti-rea/releases/tag/v0.1.0) | 2026-11-20 | **First gatekeeper release.** First-visit check (under 1 s, with the site preview) and signed pass. In-browser guard every 0.5 s while the tab is visible. Sensitive files locked in any folder. Official bots verified (Google, Bing, Apple by DNS; Meta by its ranges). Configurable shadow page, WhatsApp, Telegram and webhook alerts with caps and grouping, local log with retention, owner link, `init` wizard and Docker image. 547 unit tests and 35 in real Chrome. |

A config with `upstreamTimeout` only starts on v0.1.1 or newer: v0.1.0 rejects the unknown key.

## Responsible use

ANTI-REA defends. The shadow page never runs anything against the visitor. The self-scan only runs on
domains you prove you control and only reads. IP addresses are personal data (GDPR, LGPD): mention
the collection in your privacy policy. Log files are readable only by the gatekeeper's user (files 0600; a folder the gatekeeper creates is 0700),
and the logged address keeps the query names but drops their values (`/login?token=...`).

## Credits

Built by studying the logic of [REA (Reverse Engineer Anything)](https://github.com/morluto/rea) to
learn how to defend against it. **Independent project**, not affiliated with REA or its authors.
MIT licensed. Made in Brazil by JPStudio.
