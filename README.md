# T-Rex

<p align="center">
  <img src="public/icons/icon-192.png" alt="T-Rex" width="100">
</p>

Your [herdr](https://github.com/herdrdev/herdr) sessions in a Ghostty-like terminal, in a browser
or on your phone, as an installable PWA.

T-Rex is built like Superlogical's [Rex](https://www.superlogical.com): a server keeps every
session running, and any window attaches to it and lets go without stopping the work. Here the
server is the [herdr](https://github.com/herdrdev/herdr) multiplexer, which owns every pty,
scrollback and agent state, and the window is [restty](https://github.com/wiedymi/restty),
Ghostty's terminal emulator for the web (libghostty-vt in WASM, WebGPU with a WebGL2 fallback).
Between the two, a Mosh-style state synchronization protocol with predictive local echo keeps
typing local on a slow link. The plan is in [docs/ROADMAP.md](docs/ROADMAP.md).

## Run

On a Mac, download T-Rex from [Releases](https://github.com/alexanderkreidich/t-rex/releases)
(`arm64` for Apple silicon, `x64` for Intel). The app carries its bridge, Bun and Node, and uses
your herdr or starts the one it carries. It is not signed yet, so clear its download mark once:
`xattr -dr com.apple.quarantine /Applications/T-Rex.app` ([docs/desktop.md](docs/desktop.md)).

As a herdr plugin it needs [Bun](https://bun.sh) 1.4+, Node 18+ and a running herdr.

```bash
herdr plugin install alexanderkreidich/t-rex   # herdr builds it and starts it with itself
```

Or from a checkout:

```bash
git clone https://github.com/alexanderkreidich/t-rex.git
cd t-rex
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

[MIT](LICENSE). Copyright © 2026 Alexander Kreidich. Third-party code and assets keep their own
licenses: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
