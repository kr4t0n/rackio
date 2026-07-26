# Rackio Wallpaper (macOS)

A ~400-line AppKit app that puts the live rackio board on your desktop
wallpaper: a borderless, transparent `WKWebView` pinned to the desktop window
level, loading the same SPA the browser does with `?shell=wallpaper`.

It is a **viewer**. The rackio server keeps running on the rack; this app is
another client of it. Nothing about connectors, credentials, or `board.json`
moves onto the Mac, and the app never writes the board back.

## Why not a real widget

macOS has two things that live on the wallpaper, and they are not the same:

- **WidgetKit widgets** (the Sonoma desktop widgets) are SwiftUI view trees
  rendered out-of-process by the system on a refresh budget. No WebView, no
  JavaScript, no animation loop — the weather card's three.js sky simply
  cannot exist there, and neither can any React component. A WidgetKit port
  would be a parallel Swift reimplementation of every card.
- **A desktop-level window** — what this app is — is a full WebView, so it runs
  the existing dashboard verbatim: live polling, motion, WebGL.

"Alive on the wallpaper" only describes the second. The cost is that it does
not appear in the widget gallery and it is always running.

## Build

Needs the Xcode command line tools (`xcode-select --install`). No Xcode
project, no SwiftPM manifest — `swiftc` plus a hand-assembled bundle.

```bash
cd mac
./build.sh --run          # build, then launch
```

The app appears as a status bar item, not in the Dock. First launch shows
`http://localhost:3000` — set the real one from **Board URL…**.

To start it at login: System Settings → General → Login Items → add
`mac/build/RackioWallpaper.app`.

## Status menu

| Item | What it does |
| --- | --- |
| **Reload Board** | Force-reloads every screen's web view. |
| **Interactive** | Off (default) passes all clicks through to the desktop. On lets you hover and click cards — but clicking also takes focus from the frontmost app. |
| **Above Desktop Icons** | On (default) floats the board over Finder icons; off tucks it underneath them. |
| **Board URL…** | Where rackio is served. `?shell=wallpaper` is appended for you. |
| **Open in Browser** | Opens the normal editable board — the way to rearrange cards, since the wallpaper is read-only. |

## How the desktop trick works

macOS stacks windows by *level*, and Finder draws the wallpaper and its icons
at well-known levels below every ordinary window
(`WallpaperWindow.desktopLevel`). Ask for one of those levels and the OS treats
the window as part of the desktop: no Cmd-Tab entry, no shadow, never in front
of real work. `collectionBehavior` adds `.canJoinAllSpaces` so it follows you
between Spaces and `.stationary` so Mission Control leaves it alone.

## Gotchas

- **`setValue(false, forKey: "drawsBackground")`** in `BoardWebView` is how a
  `WKWebView` gets a transparent background. It is KVC onto a private property.
  It has worked for a decade and `underPageBackgroundColor` (macOS 12+) is set
  alongside it, but it is the one line here that could break on a macOS update
  — the symptom would be an opaque rectangle over the wallpaper.
- **`NSAllowsArbitraryLoads`** is set in `Info.plist`. ATS blocks plain HTTP,
  and `NSAllowsLocalNetworking` only covers `.local` and link-local addresses,
  not the private ranges a rack actually uses. Fine for a locally built,
  unsandboxed app; it is also why this is not App Store material.
- **One web view per screen.** Each is a full board — including a separate
  three.js context if a weather card is on it. Two displays means two.
- **The weather scene is capped at 30fps here** (it is uncapped in a browser).
  A desktop window is always "visible", so no hidden-tab throttling applies and
  it would otherwise pull the GPU for as long as the app runs. Drifting clouds
  read the same at 30fps; this is still the app's main battery cost.
- **Layout edits need the browser.** The wallpaper shell can't edit, and it
  polls `/api/board` once a minute, so a rearrangement shows up within ~60s or
  immediately via **Reload Board**.
- **Not signed for distribution.** Ad-hoc signed locally. Shipping it to
  another Mac means a Developer ID certificate and notarization.
