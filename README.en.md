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
`web`, `html`, `public_html`, `htdocs`, `wwwroot`, `db`, `database` or `dump`. A **self-scan** that
shows what a curious visitor can see of your site comes next.

> [!IMPORTANT]
> No tool can stop 100% of copying of what the browser receives. ANTI-REA raises the cost, reports
> and deceives. It does not make your site invisible.

## Install in 3 steps

The `anti-rea` package is not on npm and the image is not on GHCR yet: both ship with the first
published release. Until then, these commands run from this repository (Node.js 22 or newer):

```bash
git clone https://github.com/Jeipidevs/anti-rea.git
cd anti-rea
npm ci && npm run build
node dist/cli/index.js init    # wizard: asks your site address, what sits in front of it and alert channel
node dist/cli/index.js start   # gatekeeper up on :8080
```

Then point your domain to the gatekeeper instead of the site. The gatekeeper speaks plain HTTP on
port 8080: HTTPS comes from what sits in front of it (nginx on the machine, the panel's Traefik or
Cloudflare).

Prefer Docker? Build the image in the repository folder with `docker build -t anti-rea .` and use
`image: anti-rea` in the `docker-compose.yml` shown in the
[Portuguese README](README.md#instalar-em-3-passos) (swap it for `ghcr.io/jeipidevs/anti-rea` once
that image ships).

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
- [ ] Published npm package
- [ ] Published Docker image
- [ ] Self-scan
- [ ] Log panel

## Responsible use

ANTI-REA defends. The shadow page never runs anything against the visitor. The self-scan (coming next) will
only run on domains you prove you control and will only read. IP addresses are personal data (GDPR, LGPD): mention
the collection in your privacy policy. The log is readable only by the gatekeeper's user (folder 0700, files 0600),
and the logged address keeps the query names but drops their values (`/login?token=...`).

## Credits

Built by studying the logic of [REA (Reverse Engineer Anything)](https://github.com/morluto/rea) to
learn how to defend against it. **Independent project**, not affiliated with REA or its authors.
MIT licensed. Made in Brazil by JPStudio.
