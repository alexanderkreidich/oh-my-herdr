# Changelog

Versioned with [semantic versioning](https://semver.org/). Each release is a `vX.Y.Z` Git tag;
installs update only to releases. Remote-PC runtime bundles are versioned separately as
`remote-vN` releases.

## [Unreleased]

## [0.1.0] - 2026-10-23

The first release of T-Rex as a product of its own: your herdr sessions in a Ghostty-like
terminal, in a Mac app, a browser or on your phone.

### Added

- T-Rex for the Mac: a `.dmg` for Apple silicon and one for Intel, with the bridge, Bun and Node
  inside. It uses the herdr installed on the Mac, or starts the one it carries.
- The terminal is restty: Ghostty's terminal emulator (libghostty-vt in WebAssembly, drawn with
  WebGPU or WebGL2), with Ghostty's themes, ligatures and cursor styles.
- A Mosh-style state synchronization protocol between the bridge and each window: a slow window
  skips to the latest screen instead of replaying it, and predictive local echo keeps typing
  local on a slow link.
- Minimal chrome: the sidebar lists workspaces, one PC at a time behind a switcher; one top bar
  carries pill tabs; each pane is a card with a title bar, and dragging a card by its title swaps
  it with another. Focus mode lists each workspace's tabs in the sidebar.
- Keys: the command palette on Ctrl+F, a new workspace with a shell in home on Mod+Shift+O, split
  right on Mod+D, the sidebar on Mod+B.
- Installed as a herdr plugin (`alexanderkreidich.t-rex`), T-Rex updates to these releases from
  Settings.

### Removed

From the web client T-Rex began as: the chat view and composer, agent transcript readers, Files
and the file viewer, the Agents list, voice input, the Portal public address, plan meters and the
CLIProxy hub, in-app alert cards and their sound, Markdown rendering, and usage telemetry.
