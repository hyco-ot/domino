# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A domino scorekeeper (Dominican / Cuban rules) built as an offline PWA. The whole project is 3 source files: `index.html` (HTML + CSS + JS, no dependencies, no build), `sw.js` and `manifest.webmanifest`.

**The app is in Spanish**: UI strings, state labels, and code comments. New code follows that convention — write comments and user-facing strings in Spanish.

## Running

There is no build, bundler, test suite, or linter **locally** — edit `index.html` and reload. There is no Node or usable Python on the author's machine either, so nothing in this repo can be executed before pushing; local verification means re-reading the diff.

**Publishing is not the workflow's job.** GitHub Pages is configured in branch mode (`main`, `/`), so pushing to `main` publishes on its own. [.github/workflows/deploy.yml](.github/workflows/deploy.yml) — despite the filename — only *checks*; it never deploys. Adding deploy steps there would require flipping the Pages source to "GitHub Actions" and would break a setup that already works.

A red run therefore does **not** stop a bad push from going live. Treat it as a alarm to fix and re-push, not as a gate.

CI is the only place code actually runs. The four checks each guard a failure that produces no error message on its own:

| Check | What it catches |
|---|---|
| `node --check` on the extracted inline script + `sw.js` | a syntax slip anywhere in the app — the entire program is one inline `<script>`, so this means a blank screen |
| `JSON.parse` the manifest | phone silently refuses to install the PWA |
| every `ASSETS` path in `sw.js` exists | `addAll()` rejects → SW install fails → updates stop arriving, quietly |
| `VERSION` changed whenever `index.html` did | the release never reaches an installed phone |

The script-extraction regex assumes **one bare `<script>` tag** with no attributes and no `</script>` inside any string literal. Adding a second script block is fine (they're concatenated); adding attributes to the tag would silently skip it.

A workflow-only change ships nothing to phones, so it doesn't need a `VERSION` bump — and the guard agrees, since it only fires when `index.html` is in the diff.

Opening via `file://` works for the game itself, but **the service worker and manifest need HTTP**:

```powershell
python -m http.server 8000    # then http://localhost:8000
```

When testing changes with the SW registered, hard-reload or use DevTools → Application → Service Workers → *Unregister*; otherwise you get the cached copy.

## Architecture

### Single state object and persistence

All state lives in one object `S` ([index.html:646-661](index.html#L646-L661)), serialized to `localStorage` under the key `domino.v2`. `load()` does `{ ...blank(), ...raw }`, so **adding a field to `blank()` is backward compatible**; changing `KEY` wipes users' history.

Only two things are deliberately kept out of `S` so they don't survive an app restart: `winSeen` (winner screen already dismissed) and `view` (`'game' | 'config' | 'stats'`).

### `S.rounds` is the single source of truth

`S.scores`, `S.games`, `S.over` and `S.history` are **derived**: they are recomputed wholesale in `recount()` ([index.html:909](index.html#L909)) from the recorded entries. Never edit them by hand.

The required cycle after any mutation is: **mutate `S.rounds` (or `S.target`) → `recount()` → `save()` → `render()`**. `addRound`, `removeEntry` and `setTarget` are the three entry points that honor it.

`recount()` is reversible in both directions: if a game stops being won (an entry is removed, the target is raised), it decrements `S.games[prev]` and does `S.history.pop()`. That's why only a game that actually reached the target enters the history, and why the `history.push` must stay the last element corresponding to `prev`.

### Full re-render, no diffing

`render()` ([index.html:736](index.html#L736)) repaints everything from `S` every time. There is no intermediate DOM state to keep in sync; any visual change is achieved by changing `S` and calling `render()`.

The one exception to respect: the team-name `<input>` is not rewritten while it has focus (`document.activeElement`), or it would clobber what's being typed.

### Never print `names[i]` directly — use `teamName(i, names)`

The name field's `input` handler stores the raw value as you type, so `S.names[i]` **can legitimately be an empty string**, and that empty value survives a reload (the `blur` handler that restores the default never ran). Every place that displays a name goes through `teamName(i, names)` ([index.html:696](index.html#L696)), which falls back to `DEFAULT_NAMES`. It takes an optional array so it also resolves the frozen names on a history entry: `teamName(0, r.names)`.

The single exception is the `<input>`'s own `value`, which must mirror what's actually typed, empty included.

This caused a real bug: `renderStats()` was the one spot printing names raw, so a hand won by a team whose name had been cleared rendered with a blank label — and the loser's name, being the only one visible, read as the winner.

### Themes and styles via attributes

`data-theme` (`light`/`dark`) and `data-style` (`chercha`/`mono`) are set on `<html>` from `render()`. **All colors are CSS variables** — no color literals in the rules, except the tile divider line. Context-scoped variables: `--tc` (team color, from `.team[data-team]`), `--wc` (winner, set on `:root`), `--pt` (pad's team, set on `#sheet`).

**Watch the naming — the labels and the internal keys don't line up:**

| Internal key | UI label | What it is |
|---|---|---|
| `chercha` | Chercha | The full experience: reactions, pad shortcuts, ¡Lisa! |
| `mono` | **Clásico** | Stripped-down monochrome, no extras |

The user-facing "Clásico" is the `mono` key, *not* anything named `classic`. The extras style was keyed `classic` in an earlier version; `load()` migrates that stored value to `chercha` ([index.html:676](index.html#L676)) and that migration must stay, or existing installs silently drop to monochrome with nothing checked in the menu.

The `mono` style is not just a palette: it disables functionality. The reactions (`react`, `bigReact`) and the pad shortcuts (`chipTap`) `return` early when `S.style !== 'chercha'`.

### Modes carry their own target

`MODES` holds `label`, `pips` and `target` per mode: Dominican is double-6 at 200, Cuban is double-9 at 300. **Picking a mode overwrites `S.target`** with that mode's default; from then on Ajustes wins until a mode is picked again. The mode cards' subtitles are generated from `MODES` at startup alongside their tiles, so adding a mode means touching only that constant and the markup for the card.

`tileSVG(top, bottom)` builds a tile from `LAYOUT`, a 3×3 grid of pip positions per number (0–9). It's used in the mode cards, the badge, the capicúa chip, the entry log, and the winner screen. The pip count comes from `MODES[S.mode].pips`.

### House rule: shortcuts die near the finish line

A real domino rule, not a UI decision: **when a team needs `CHIP_PTS` (30) or fewer points to win, capicúa and pase corrido stop counting** — otherwise you'd win off a bonus. `chipsDead(team)` ([index.html:712](index.html#L712)) is `S.scores[team] >= S.target - CHIP_PTS`, so at a 200 target the shortcuts go dead at 170.

The threshold is deliberately tied to `CHIP_PTS` rather than a hardcoded 30, since the rule is "you can't win *on* the bonus" — change what a bonus is worth and the cutoff must follow.

Enforced in `chipTap()`, which is the single funnel for both the on-screen chips and the `p`/`c` keyboard shortcuts. A blocked tap fires the `REACTIONS.dead` phrase instead of adding points. `paintPad()` also marks the chips with a `dead` class (dimmed, value struck through) so the rule is visible before it's hit.

### Score pad: a list of operations

`padOps` is not a number but a list of operations (`{k:'d',v:'7'}`, `{k:'pase'}`, `{k:'capi'}`). That's what lets ⌫ undo the last action whether it was a digit or a shortcut. The total is derived by `padTotal()`; capicúa toggles (only one possible), pase corrido accumulates. Both are worth `CHIP_PTS`.

### Session and idle reset

`checkIdle()` resets the session (mode, scoreboard, games won) after `IDLE_MS` of inactivity, but **preserves `history`, `names`, `theme`, `style` and `target`**. It fires when the app becomes visible again and on a `setInterval` every minute.

## Service worker and the update flow

The app is installed on people's phones, so a new version on GitHub does not arrive on its own. The whole mechanism hangs on one fact: **the browser only looks for a new version when `sw.js` itself changes byte-for-byte.** Editing `index.html` alone is invisible to an installed app, forever.

That's what `VERSION` in [sw.js](sw.js) is for, and **it is bumped by hand on every single change**: +1 per individual tweak, so one request covering three tweaks moves `1.04` → `1.07`. It started at `1.00`; `2.00` is reserved for a larger change the user has in mind.

**Bumping it is not optional and not a release ritual — it is part of the edit.** Shipping without it is indistinguishable from not shipping: no error, no warning, the release simply never reaches an installed phone. It was previously stamped by a GitHub Action from the commit SHA; that was dropped because it depended on a deploy path that wasn't reliably in place.

The lifecycle:

1. New `sw.js` bytes → the browser installs the new worker, which **waits** (`install` has no `skipWaiting()` on purpose — the page decides when to swap).
2. The page notices via `reg.waiting` or `updatefound` and calls `autoApply()`.
3. `postMessage({type:'SKIP_WAITING'})` → the worker activates, purges old caches, claims the page.
4. `controllerchange` fires → the page reloads, but **only if `applying` is true**, so the first-ever install doesn't reload out from under a new visitor.

Updates apply **automatically**, but `autoApply()` refuses at three moments where a reload would intrude: the score pad open, a dialog open, or a finished hand on screen (`S.over >= 0` — reloading there would resurrect the winner overlay, since `winSeen` doesn't persist). It retries at the next natural break: returning to the app, or the next launch. The `.upd` button stays as a manual override and an "am I current?" check.

Losing state is not the concern — `save()` runs on every mutation, so `S` survives any reload. The guards are about not interrupting.

Checks for a new version run on visibility change and every 15 minutes while the app is open; an installed PWA barely navigates, so the browser's own schedule is far too lazy to rely on.

Two invariants to preserve:

- **Caches are per-version** (`domino-${VERSION}`), and `fetch` is cache-first, not stale-while-revalidate. Together these mean everything a given worker serves comes from one version. Reintroducing background revalidation would let a new `index.html` slip into an old version's cache and re-create the mixed-version bug this design exists to prevent.
- **Never change the `localStorage` key** (`domino.v2`) in a release — an update would wipe everyone's history.

Locally, `__BUILD__` is never substituted, so `sw.js` stays constant and no update ever appears. That's expected; test the update flow on a real deploy.

**Diagnosing a phone stuck on an old version.** Ajustes shows the version the active worker reports (`showVer()` asks it over a `MessageChannel`). Read it first:

| Shows | Means |
|---|---|
| a 7-char SHA | the pipeline works; updates will arrive |
| `__BUILD__` | the deploy isn't substituting it — Pages is serving the raw branch, so `sw.js` is byte-identical every release and **no update will ever be offered** |
| `desconocida (service worker viejo)` | a pre-update-flow worker is still in control; it has no `GET_VERSION` handler |

`hardReset()` (Ajustes → "¿Sigue sin actualizar? Reinstalar") unregisters every worker, deletes every cache, and reloads. It deliberately **leaves `localStorage` alone**, so it is always preferable to telling someone to clear site data in browser settings — that would take their history with it. It's also the only way off a pre-update-flow worker, since those can't be asked to step aside.

## Things that break easily

- The mobile `theme-color` is swapped from JS via `BAR_COLOR`; the static `<meta>` and the manifest alone are not enough.
- The floating reactions (`.fx`) deliberately have **no** `overflow:hidden`: a long phrase must be able to cross over the other team's column.
- `.entries` are painted reversed (`.reverse()`), newest on top, and only each team's most recent entry gets the X to remove it.
- The physical-keyboard handler ([index.html:1146](index.html#L1146)) is layered as a cascade (dialog → winner → pad open → board); a new layer must be inserted in that order or it will be shadowed.
- The menu actions (`new` / `mode` / `reset`) live in `doAct(act)`, not in the menu's click handler — Ajustes' "Limpiar todo" calls the same function. New entry points call `doAct`; don't re-inline the confirm-then-mutate logic.
- `ask()` takes an optional 5th arg, `checkLabel`. Passing it renders a checkbox and keeps the confirm button `disabled` until it's ticked — used by the wipe, since that one can't be undone. `Enter` on a disabled button is a no-op, so the keyboard path can't skip the tick either.
- The score pad shows **no team name on purpose**. `.aim` is a two-column grid that parks an up-arrow over the half matching the team being scored, which lines up with that team's board column; the pad's `--pt` tint carries the same information. Don't "fix" it by adding a label back — the name lives on in the `aria-label` for screen readers.
