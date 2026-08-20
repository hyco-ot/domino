# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Tranque** — a domino scorekeeper (Dominican / Cuban rules) built as an offline PWA. The whole project is 3 source files: `index.html` (HTML + CSS + JS, no dependencies, no build), `sw.js` and `manifest.webmanifest`.

The app was called "Dominó" until v1.18. Two things deliberately kept the old name: the `localStorage` key `domino.v2` (renaming it would wipe everyone's history) and the repo/Pages path `hyco-ot.github.io/domino` (the PWA's scope — renaming the repo would orphan every installed copy). Neither is user-visible.

`2.00` added the player system (see **Players, table and identity**). The previous release is kept playable at `/1.37/` — a frozen copy, described under **The archived copy**.

**Big work happens on a clone.** `c:\Claude\Tranque-v2` is a full copy of the app that is never published, kept isolated by four markers: the `<title>`, `KEY = 'tranque.pruebas'`, the manifest name, and `VERSION = '2.00-dev'` / `CACHE = tranque-pruebas-…`. Anything shipped to `main` while a clone is open has to be ported into it before that clone is published, or publishing silently reverts it.

**The app is in Spanish**: UI strings, state labels, and code comments. New code follows that convention — write comments and user-facing strings in Spanish.

## Running

There is no build, bundler or linter — edit `index.html` and reload.

Node **is** installed (`C:\Program Files\nodejs\node.exe`; it may be missing from the shell's `PATH`, in which case read `PATH` from `HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment`). The tests are standalone `.mjs` scripts kept in the session scratchpad, not in the repo, and they boot the real `index.html` under **jsdom** and click through it. That matters more than it sounds: the entire program is one inline `<script>`, so `node --check` proves only that it parses. Every real bug found in this project — a `$$` collapsed to `$`, an archived copy still listening to the live service worker, chips never rendered because a screen was never entered — was caught by booting it, not by reading it.

Each test takes the folder to check as `argv[2]`, so the same script runs against the live app and the clone. Ones that seed `localStorage` (`migrar`, `zoom`) take the key as `argv[3]`: `domino.v2` for the published app, `tranque.pruebas` for the clone.

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

All state lives in one object `S` (see `blank()`), serialized to `localStorage` under the key `domino.v2`. `load()` does `{ ...blank(), ...raw }` — a **shallow** merge, so **adding a top-level field to `blank()` is free**, but the shape of an already-stored nested record can never be changed. That is why history entries only ever gained *optional* fields.

`S.esquema` is the migration counter, and it is what makes one-time migrations possible at all. `load()` reads **`raw.esquema`**, not the merged value — the merged one comes from `blank()` for anyone who has never stored it, so a pre-2.00 install would look already-migrated. Installs older than 2.00 have no `esquema` and count as `1`.

Things deliberately kept out of `S`, so they don't survive a restart: `winSeen`, `view`, `lisaWord`, `preguntandoUpd` / `updPospuesta`, and `borrarSel` / `borrarAbierto`.

### `S.rounds` is the single source of truth

`S.scores`, `S.games`, `S.over` and `S.history` are **derived**: they are recomputed wholesale in `recount()` from the recorded entries. Never edit them by hand.

The required cycle after any mutation is: **mutate `S.rounds` (or `S.target`) → `recount()` → `save()` → `render()`**. `addRound`, `removeEntry` and `setTarget` are the three entry points that honor it.

`recount()` is reversible in both directions: if a game stops being won (an entry is removed, the target is raised), it decrements `S.games[prev]` and does `S.history.pop()`. That's why only a game that actually reached the target enters the history, and why the `history.push` must stay the last element corresponding to `prev`.

### Full re-render, no diffing

`render()` repaints everything from `S` every time. There is no intermediate DOM state to keep in sync; any visual change is achieved by changing `S` and calling `render()`.

The one exception to respect: the team-name `<input>` is not rewritten while it has focus (`document.activeElement`), or it would clobber what's being typed.

### Never print `names[i]` directly — use `teamName(i, names)`

The name field's `input` handler stores the raw value as you type, so `S.names[i]` **can legitimately be an empty string**, and that empty value survives a reload (the `blur` handler that restores the default never ran). Every place that displays a name goes through `teamName(i, names)`, which falls back to `DEFAULT_NAMES`. It takes an optional array so it also resolves the frozen names on a history entry: `teamName(0, r.names)`.

The single exception is the `<input>`'s own `value`, which must mirror what's actually typed, empty included.

This caused a real bug: `renderStats()` was the one spot printing names raw, so a hand won by a team whose name had been cleared rendered with a blank label — and the loser's name, being the only one visible, read as the winner.

### Themes and styles via attributes

`data-theme` (`light`/`dark`) and `data-style` (`chercha`/`mono`) are set on `<html>` from `render()`. **All colors are CSS variables** — no color literals in the rules, except the tile divider line. Context-scoped variables: `--tc` (team color, from `.team[data-team]`), `--wc` (winner, set on `:root`), `--pt` (pad's team, set on `#sheet`).

**Watch the naming — the labels and the internal keys don't line up:**

| Internal key | UI label | What it is |
|---|---|---|
| `chercha` | Chercha | The full experience: reactions, pad shortcuts, ¡Lisa! |
| `mono` | **Clásico** | Stripped-down monochrome, no extras |

The user-facing "Clásico" is the `mono` key, *not* anything named `classic`. The extras style was keyed `classic` in an earlier version; `load()` migrates that stored value to `chercha` (in `load()`) and that migration must stay, or existing installs silently drop to monochrome with nothing checked in the menu.

The `mono` style is not just a palette: it disables functionality. The reactions (`react`, `bigReact`) and the pad shortcuts (`chipTap`) `return` early when `S.style !== 'chercha'`.

### Modes carry their own target

`MODES` holds `label`, `pips` and `target` per mode: Dominican is double-6 at 200, Cuban is double-9 at 300. **Picking a mode overwrites `S.target`** with that mode's default; from then on Ajustes wins until a mode is picked again. The mode cards' subtitles are generated from `MODES` at startup alongside their tiles, so adding a mode means touching only that constant and the markup for the card.

`tileSVG(top, bottom)` builds a tile from `LAYOUT`, a 3×3 grid of pip positions per number (0–9). It's used in the mode cards, the badge, the capicúa chip, the entry log, and the winner screen. The pip count comes from `MODES[S.mode].pips`.

### House rule: the pase corrido can't be what wins the hand — and the capicúa always fits

A real domino rule, not a UI decision, and it applies to **the pase corrido only**. `bonusCap(score)` returns how many fit:

```js
const falta = S.target - score;
if (falta <= 0) return 0;                     // already at the target
return Math.max(0, Math.ceil(falta / CHIP_PTS) - 1);
```

At a 200 target: 6 from zero, 3 at 100, 2 at 138, 1 at 140, none at 170.

**The measure is the score the team had before this hand — the tile points typed on the pad are deliberately NOT part of it.** They are separate and land at the end. An earlier version folded them in, and the result was baffling in the hand: at 138 you'd mark two pases (both legal), start typing the 35 your tiles came to, and watch the pases disappear one per digit without having touched them. The cap is decided when a shortcut is marked; typing never moves it.

**The capicúa has no cap at all.** It always fits, at any score, and its chip never dims. It doesn't go through `bonusCap`.

Enforcement is now a single point: `chipTap()` refuses a `pase` tap when `paseLleno()` — the one funnel for both the on-screen chips and the `p`/`c` keys. There is no `trimBonus()` any more, and reintroducing one would bring the disappearing-pases bug straight back.

`paintPad()` marks only the pase chip `dead` (dimmed, value struck through) when none fit, so the limit is visible before it's hit.

`bonusCap` takes a **score, not a team index**, because of editing: while correcting an entry, that entry's points are still in `S.scores`, so callers pass `padScore()` — the team's score minus the entry being edited. Passing `S.scores[team]` there would under-count the room left.

### Editing an entry reuses the pad

Tapping the newest entry's number opens `openPad(team, i)`, which rebuilds `padOps` from the stored round (base points = `p` minus what the bonuses contributed, then that many `pase` ops, then `capi`). Submitting routes to `editRound()` instead of `addRound()`; clearing it to zero routes to `removeEntry()`, which is the natural way to say "this never happened".

`editRound()` deliberately **lacks** the `S.over >= 0` guard that `addRound()` has: correcting the entry that ended the hand is exactly when you need it, and `recount()` reopens the hand on its own if the correction drops the team below target.

Only the newest entry per team is editable — the same one that carries the X. Editing an older one would silently invalidate everything scored after it.

### Score pad: a list of operations

`padOps` is not a number but a list of operations (`{k:'d',v:'7'}`, `{k:'pase'}`, `{k:'capi'}`). That's what lets ⌫ undo the last action whether it was a digit or a shortcut. The total is derived by `padTotal()`; capicúa toggles (only one possible), pase corrido accumulates. Both are worth `CHIP_PTS`.

### Players, table and identity (2.00)

Four top-level fields carry it: `S.anotador` (who is keeping score), `S.jugadores` (the catalogue of known people, each `{id, nombre, creado, visto, manos, ganadas, borrado}`), `S.mesa` (`{ids[4], grupo, desde, cerrada, armando, contada, nueva, modo}`) and `S.grupos` (saved quartets). Ids are stable strings, never names: people get renamed, and a rename would otherwise split someone's history in two silently. Deleting a player writes a `borrado` tombstone rather than removing the record, because old history entries point at that id.

**Seats go anticlockwise from the scorekeeper**, who is always seat 0, at the bottom of the screen: `0` bottom, `1` left, `2` opposite, `3` right. Partners sit across from each other, so `idsEquipo(t, ids)` pairs `t` with `t+2`. Filling and rotating both follow `0 → 3 → 2 → 1`, which is the direction dominoes actually move around a table.

`MAX_JUGADORES`, `MAX_GRUPOS` and `MAX_COLORES` are load-bearing, not decoration: `save()` swallows quota errors, so an unbounded list stops persisting **silently**.

### `S.ident` — whose hands these are

The problem it solves: hands won by one set of people were being counted for whoever sat down next. `S.ident` is a string identifying who is playing right now — `'f:' + the four ids sorted` in Formal, `'i:' + both team names` in Informal (`identAhora()`).

Every history entry is stamped with the `ident` it was played under, plus the `accents` it was played with. `nuevaTanda(ident)` resets `S.games` when the identity changes, and `manoMia(r)` decides whether a stored hand belongs to whoever is at the table now. Entries stored before 2.00 have no `ident` and fall back to comparing team names — the only thing knowable about them.

Two consequences worth keeping:

- **Colours belong to the people, not to the app.** `S.colores` remembers the accent pair per identity, so sitting down with the same four restores their colours, and a history row keeps the colours it was played with. History rows therefore set colour **inline** from `colorMano(r, t)`, never via the `.t0`/`.t1` classes, which point at the live `--a`/`--b` and would repaint three-day-old hands.
- **Don't invent an identity for old data.** The Formal/Informal label in the history (`tipoMano(r)`) renders nothing when `r.ident` is missing, because that distinction didn't exist when those hands were played.

### Two-step launcher and the table screen

`#sc-mode` has two steps driven by `S.tipo` (`null` → ask Informal/Formal → then the mode), not by a loose variable, so a reload mid-way lands somewhere coherent. `S.tipo` returns to `null` on idle reset.

Formal needs a name: `puedeFormal()` is false when `S.anotador` is empty, and without one the app stays Informal for good.

`#sc-mesa` is the square table. It has **two** paint functions and the split is not cosmetic: `renderMesa()` rebuilds the markup, `refrescarMesa()` only updates the derived bits. The seat `change` handler must call `refrescarMesa()` — calling the full one there destroys the sibling `<input>`s mid-edit, which showed up as only two of four players ever being registered.

### The Jugadores screen edits a draft, not the table

`#sc-jug` (`view === 'jugadores'`, reachable only from the board and only in Formal) changes who is at the table without leaving the scoring screen. It works on `jugBorrador`, a **copy** of `S.mesa.ids` — that is what makes "Guardar" mean something, and what makes leaving without saving a no-op. Like the other screen state, it doesn't persist; `render()` clears it whenever `view` moves away.

`guardarJug()` distinguishes **who is playing** from **where they sit**: it compares the sorted id sets, and only asks about the points in progress when someone actually entered or left. Reshuffling the same four asks nothing. The two answers are "keep the points" and "start from scratch"; that second label is why `ask()` grew a `noLabel` parameter.

Saving runs `nuevaTanda(identAhora())`, so changing who plays resets the games tally — the same rule as everywhere else.

Two things worth knowing: seat 0 can be emptied here, but `renderMesa()` forces the scorekeeper back into it the next time the table screen opens; and a name typed in with the table full is added to the catalogue without being seated, which is the point — you register people before they sit down.

### Session and idle reset

`checkIdle()` resets the session (mode, scoreboard, games won) after `IDLE_MS` of inactivity, but **preserves `history`, `names`, `theme`, `style` and `target`**. It fires when the app becomes visible again and on a `setInterval` every minute.

## Service worker and the update flow

The app is installed on people's phones, so a new version on GitHub does not arrive on its own. The whole mechanism hangs on one fact: **the browser only looks for a new version when `sw.js` itself changes byte-for-byte.** Editing `index.html` alone is invisible to an installed app, forever.

That's what `VERSION` in [sw.js](sw.js) is for, and **it is bumped by hand on every single change**: +1 per individual tweak, so one request covering three tweaks moves `1.04` → `1.07`. It started at `1.00` and reached `2.00` with the player system.

A change that ships nothing to phones — the workflow, `CLAUDE.md`, the archived copy under `/1.37/` — needs no bump, and the CI guard agrees: it only fires when the root `index.html` is in the diff.

**Bumping it is not optional and not a release ritual — it is part of the edit.** Shipping without it is indistinguishable from not shipping: no error, no warning, the release simply never reaches an installed phone. It was previously stamped by a GitHub Action from the commit SHA; that was dropped because it depended on a deploy path that wasn't reliably in place.

The lifecycle:

1. New `sw.js` bytes → the browser installs the new worker, which **waits** (`install` has no `skipWaiting()` on purpose — the page decides when to swap).
2. The page notices via `reg.waiting` or `updatefound` and calls `autoApply()`.
3. `postMessage({type:'SKIP_WAITING'})` → the worker activates, purges old caches, claims the page.
4. `controllerchange` fires → the page reloads, but **only if `applying` is true**, so the first-ever install doesn't reload out from under a new visitor.

Updates apply **automatically**, but `autoApply()` refuses at three moments where a reload would intrude: the score pad open, a dialog open, or a finished hand on screen (`S.over >= 0` — reloading there would resurrect the winner overlay, since `winSeen` doesn't persist). It retries at the next natural break: returning to the app, or the next launch. The `.upd` button stays as a manual override and an "am I current?" check.

**A major version asks first.** `decidirYAplicar()` compares the leading number of the waiting worker's `VERSION` against the running one, asking the *waiting* worker over a `MessageChannel` — it is the only one that knows what it brings. Same leading number → apply silently, as before. Different → `ask()`, naming both versions. "No" is never permanent: it sets `updPospuesta`, which doesn't persist, so the next launch offers it again. If either version can't be read, it applies without asking — the old behaviour, and the safe default.

The ordering constraint here is worth stating, because it is not recoverable after the fact: **the code that asks has to already be on the phone before the version it asks about.** A consent dialog shipped *inside* a major release can never gate that release. 1.31 existed only to put the gate in place ahead of 2.00.

Losing state is not the concern — `save()` runs on every mutation, so `S` survives any reload. The guards are about not interrupting.

Checks for a new version run on visibility change and every 15 minutes while the app is open; an installed PWA barely navigates, so the browser's own schedule is far too lazy to rely on.

Two invariants to preserve:

- **Caches are per-version** (`tranque-${VERSION}`), and `fetch` is cache-first, not stale-while-revalidate. Together these mean everything a given worker serves comes from one version. Reintroducing background revalidation would let a new `index.html` slip into an old version's cache and re-create the mixed-version bug this design exists to prevent.
- **Never change the `localStorage` key** (`domino.v2`) in a release — an update would wipe everyone's history.

**Diagnosing a phone stuck on an old version.** Ajustes shows the version the active worker reports (`showVer()` asks it over a `MessageChannel`). If it says `desconocida (service worker viejo)`, a pre-update-flow worker is still in control: it has no `GET_VERSION` handler and can't be asked to step aside.

### The archived copy

`/1.37/` is the previous release, kept playable at `hyco-ot.github.io/domino/1.37/`. It is built from `git show HEAD:index.html` with four things removed, and each removal exists because of a real failure mode:

- **No service-worker registration and no `<link rel="manifest">`** — it's a page, not a second installable app.
- **Deaf to `navigator.serviceWorker.ready`.** The copy lives under `/domino/`, so the *live* app's worker also controls it. Left connected, it would announce "Actualizado a la versión 2.00" from inside the old app.
- **`hardReset()` disabled.** Same-origin: from the archive it would unregister the real app's worker and delete its caches.
- **`showVer()` hardcoded**, since there's no worker of its own to ask.

Two things follow. It shares `localStorage` with the live app — deliberate, so someone who prefers the old one keeps their history — and offline, before that page has ever been visited, the live worker answers its navigation with the *new* `index.html`. Neither has a fix worth taking.

Archive the version that is actually good: the copy is what someone falls back to, so a release with a known-wrong rule is a trap. The old code is never lost regardless — `v1.30` and `v1.37` are tags.

`hardReset()` (Ajustes → "¿Sigue sin actualizar? Reinstalar") unregisters every worker, deletes every cache, and reloads. It deliberately **leaves `localStorage` alone**, so it is always preferable to telling someone to clear site data in browser settings — that would take their history with it. It's also the only way off a pre-update-flow worker, since those can't be asked to step aside.

## Things that break easily

- The mobile `theme-color` is swapped from JS via `BAR_COLOR`; the static `<meta>` and the manifest alone are not enough.
- The floating reactions (`.fx`) deliberately have **no** `overflow:hidden`: a long phrase must be able to cross over the other team's column.
- `.entries` are painted reversed (`.reverse()`), newest on top, and only each team's most recent entry gets the X to remove it.
- The physical-keyboard handler is layered as a cascade (dialog → winner → pad open → board); a new layer must be inserted in that order or it will be shadowed.
- The menu actions (`new` / `mode` / `reset`) live in `doAct(act)`, not in the menu's click handler — Ajustes' "Limpiar todo" calls the same function. New entry points call `doAct`; don't re-inline the confirm-then-mutate logic.
- `ask()` takes an optional 5th arg, `checkLabel`. Passing it renders a checkbox and keeps the confirm button `disabled` until it's ticked — used by the wipe, since that one can't be undone. `Enter` on a disabled button is a no-op, so the keyboard path can't skip the tick either.
- **`[hidden]` loses to any rule that sets `display`.** `.linky`, `.wipe` and `.names2` all define their own, so each needs an explicit `[hidden]{display:none}` or the `hidden` property does nothing. Check this every time you hide an element by property.
- The board's team name is an editable `<input>` in Informal and a read-only stack of player names (`.names2`) in Formal — the name comes from who is seated, so editing it there would contradict the table with nothing to reflect it.
- The style picker (Chercha / Clásico) lives in **two** places: the three-dot menu during a hand, and the top of Ajustes before one starts, since the menu doesn't exist on the launcher. `#cfg-sec-estilo` hides itself when `S.mode` is set, so only one is ever reachable.
- The score pad shows **no team name on purpose**. `.aim` is a two-column grid that parks an up-arrow over the half matching the team being scored, which lines up with that team's board column; the pad's `--pt` tint carries the same information. Don't "fix" it by adding a label back — the name lives on in the `aria-label` for screen readers.
