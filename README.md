# Astro Spotify

A locally built GNOME 50 extension with **separate Play and Pause buttons** in a small, glossy, macOS-inspired capsule. It is independent of Astro Vitals and fits the same 28-pixel top bar.

## Use

After installation, **log out and back in once** to let GNOME discover the extension.

- **▶ Play** starts or resumes Spotify.
- **Ⅱ Pause** pauses Spotify.
- The available action is bright; the redundant action is dimmed. Both buttons remain visible, so the control positions stay fixed.
- Clicking **Spotify** opens or focuses the desktop app. When Spotify is closed, playback buttons are disabled.
- The Spotify icon turns soft green during playback. Hover over the label for the track name, artist, and status.
- If a control fails, the label reads **Retry**. Click it to reconnect.

Only Spotify desktop players are targeted. Browser media, VLC and other players are ignored. Playback is never started automatically by enabling the extension or by Spotify opening.

## Low overhead

- Native GNOME actors and local vector icons; no helper process, daemon, web view or additional package.
- D-Bus property signals update playback state. There is no periodic polling or progress timer.
- No album-art downloads, network access, blur shader or continuous animation.
- Hover/press transitions last 120 ms and respect the system animation preference.
- All D-Bus requests are asynchronous, with three-second timeouts. Concurrent control clicks are rejected; explicit Play and Pause methods avoid accidental double toggles.
- One property refresh follows a user action so missing player signals do not leave the control stale.
- Up to three bounded startup retries handle players that publish their bus name before their media interface. These stop after startup; they are not idle polling.
- Disabling the extension cancels requests, releases proxies and signal subscriptions, and removes tooltips and timers. It is not enabled on the lock screen.

The rendered capsule is **135 × 23 px**, with **145 px total panel width** including its outer padding. Playback and recovery were tested with a simulated MPRIS player.

## Install / remove

```sh
python3 install.py
```

The installer preserves your other extensions and saves any prior Astro Spotify installation under `~/.local/state/astro-spotify/`. A new extension or updated JavaScript module requires one logout/login; the installer never logs you out.

Disable with GNOME Extensions or:

```sh
gnome-extensions disable astro-spotify@local
```

Remove only this extension:

```sh
python3 uninstall.py
```

## Test

```sh
dbus-run-session -- gjs -m tests/player.test.js
```

This runs a test MPRIS player on a private bus, leaving your real Spotify playback untouched. The test fixture is not installed with the extension.

## Compatibility

Built for GNOME Shell 50.1 on the development computer with the WhiteSur dark theme and Inter font. Snap, native and Flatpak Spotify desktop IDs are recognized when opening the app; only the locally installed Snap was inspected. No security policy was changed.

The source uses the standard [MPRIS Play, Pause and playback-property interface](https://specifications.freedesktop.org/mpris/latest/Player_Interface.html) with [Gio D-Bus integration](https://gjs.guide/guides/gio/dbus.html). This is an independent local extension, not an Apple or Spotify product.
