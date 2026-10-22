# oh-my-herdr

<p align="center">
  <img src="public/icons/icon-192.png" alt="oh-my-herdr" width="100">
</p>

A minimal browser terminal for [herdr](https://github.com/herdrdev/herdr): your herdr workspaces,
tabs and panes in a browser or on your phone, as an installable PWA.

A fork of [herdr web ui](https://github.com/devswha/herdr-web-ui) with a Ghostty-like terminal
([restty](https://github.com/wiedymi/restty)) and a Mosh-style state synchronization protocol with
predictive local echo. The plan is in [docs/ROADMAP.md](docs/ROADMAP.md).

## Run

Needs [Bun](https://bun.sh) 1.4+, Node 18+ and a running herdr.

```bash
git clone https://github.com/alexanderkreidich/oh-my-herdr.git
cd oh-my-herdr
bun install
bun run start       # builds, then serves on http://127.0.0.1:7317
```

## Develop

```bash
bun run sandbox                          # disposable herdr + bridge on :7417
HERDR_WEB_API_PORT=7417 bun run dev      # Vite with HMR on :5173
bun run check fast                       # types, themes, typecheck, build, unit tests
```

See [AGENTS.md](AGENTS.md), [docs/development.md](docs/development.md) and [DESIGN.md](DESIGN.md).
Report security problems privately: [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). Copyright © 2026 devswha.
