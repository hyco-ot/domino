# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Tranque** — a domino scorekeeper (Dominican / Cuban rules) built as an offline PWA. The whole project is 3 source files: `index.html` (HTML + CSS + JS, no dependencies, no build), `sw.js` and `manifest.webmanifest`.

The app was called "Dominó" until v1.18. Two things deliberately kept the old name: the `localStorage` key `domino.v2` (renaming it would wipe everyone's history) and the repo/Pages path `hyco-ot.github.io/domino` (the PWA's scope — renaming the repo would orphan every installed copy). Neither is user-visible.

`2.00` added the player system (see **Players, table and identity**); `3.00` added the three-player table (see **Three at the table**). Two previous releases are kept playable — `/1.37/` (the last one before players) and `/2.81/` (the last one before the three-player table) — frozen copies described under **The archived copies**.

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

`S.esquema` is the migration counter (now at **7**), and it is what makes one-time migrations possible at all. `load()` reads **`raw.esquema`**, not the merged value — the merged one comes from `blank()` for anyone who has never stored it, so a pre-2.00 install would look already-migrated. Installs older than 2.00 have no `esquema` and count as `1`.

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

The `mono` style is not just a palette: it disables functionality. The reactions (`react`, `bigReact`) and the pad shortcuts (`chipTap`) `return` early when `S.style !== 'chercha'`, and **every animation is switched off** by a single `[data-style="mono"] … {animation:none}` rule. That rule is the whole opt-out — there is deliberately no `prefers-reduced-motion` block, because the app already has a stripped-down mode and splitting the decision across two mechanisms would leave two places to remember. A new animation class has to be added to that list, or Clásico quietly keeps it.

### Modes carry their own target

`MODES` holds `label`, `pips` and `target` per mode: **Por manos** (tally marks, no tile, no point target), Dominican (double-6 at 200) and Cuban (double-9 at 300). **Picking a mode overwrites `S.target`**, always through `topeDeJuego()` — points for the two point modes, `paraGanar()` hands for Por manos. From then on Ajustes wins until a mode is picked again. `modoSVG(k)` gives each card its icon: the tally glyph for `manos`, its double tile for the others. The cards are generated from `MODES` at startup, so adding a mode means touching only that constant and the markup for the card.

`tileSVG(top, bottom)` builds a tile from `LAYOUT`, a 3×3 grid of pip positions per number (0–9). It's used in the mode cards, the badge, the capicúa chip, the entry log, and the winner screen. The pip count comes from `MODES[S.mode].pips`.

**`MARCA_ICO` shares that tile's `100 200` viewBox on purpose.** Six places paint the mode glyph — the launcher cards, the board badge, the mesa's centre, the winner screen, the history rows — and every one of them sizes it by **height**. A square tally therefore came out twice as wide as a tile, which pushed "Por manos" out of line with the other two in the launcher's strip. A new mode glyph has to keep that box, or the misalignment reappears in all six at once. Tests should identify a tile by its `.t-face`, never by a path coordinate: those move whenever a glyph is redrawn, and one did.

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

The third shortcut, **Tranque**, is the odd one out: it records *how the hand ended*, not points. It stays out of `padTotal()` — `padBase()` is the digits, `padBonus()` counts only pase and capicúa — and stores `r.tranque = 1`, which paints a padlock in the log.

**Tranque and capicúa cannot both be on.** If someone closed with a capicúa the hand wasn't blocked; if it was blocked, nobody closed. Marking one *releases* the other instead of refusing, so nobody has to remember to untick first — and `openPad()`'s rebuild prefers capicúa when correcting an old entry that somehow carries both, since that is the one that moves the score.

Marking a tranque with nothing typed fires a reaction but **still marks**: the tile points still have to be counted, and marking first and typing after is a normal way to use the pad.

### Players, table and identity (2.00)

Four top-level fields carry it: `S.anotador` (who is keeping score), `S.jugadores` (the catalogue of known people, each `{id, nombre, creado, visto, manos, ganadas, borrado}`), `S.mesa` (`{ids[4], grupo, desde, cerrada, armando, contada, nueva, modo}`) and `S.grupos` (saved quartets). Ids are stable strings, never names: people get renamed, and a rename would otherwise split someone's history in two silently. Deleting a player writes a `borrado` tombstone rather than removing the record, because old history entries point at that id.

**Seats go anticlockwise from the scorekeeper**, who is always seat 0, at the bottom of the screen: `0` bottom, `1` left, `2` opposite, `3` right. Partners sit across from each other, so `idsEquipo(t, ids)` pairs `t` with `t+2`. Filling and rotating both follow `0 → 3 → 2 → 1`, which is the direction dominoes actually move around a table.

`MAX_JUGADORES`, `MAX_GRUPOS` and `MAX_COLORES` are load-bearing, not decoration: `save()` swallows quota errors, so an unbounded list stops persisting **silently**. `HISTORY_MAX` is 400 hands — at 100 a family playing daily lost a month of history to `shift()`. `cuota.mjs` fills every list to its cap at once and measures: **207 KB** against the ~5 MB a browser gives, and it fails above 1 MB.

**`S.parejas` — who wins with whom.** Keyed `'idA|idB'` with the two ids sorted, so the pair is the same whoever sat where, and counted in `contarManos()` with the same both-ways rule as each player's own tally. It is a durable counter for the reason the history can't be one: a window of 400 hands erases the evidence of a habit that took months to form — the same lesson `contarAparicion()` already learned. Both lists live behind the history's fourth pill, **Resumen** (`HVIEWS`), alongside the counts — they used to hang off the end of the hand list, where reaching them meant scrolling past 400 hands. The Resumen view deliberately does not build the hand rows at all: constructing 400 of them to then not show them is work thrown away on every visit. `cadaUnoHTML()` is the per-player list and is the **only** one that covers three-player play — a trio has no partners, so `S.parejas` correctly records nothing for it. Both show entries with **four hands or more** (`PAREJA_MIN`, reused as `MANOS_MIN` on purpose); below that the percentage is noise, and one shared bar means never having to explain why one list appears and the other doesn't. `esquema 6` seeds it once from whatever is still in the window, so the panel says something the day it ships instead of two months later. It has no cap of its own: all 64 players paired with each other is 2016 entries, and that is inside the measurement above.

### `S.ident` — whose hands these are

The problem it solves: hands won by one set of people were being counted for whoever sat down next. `S.ident` is a string identifying who is playing right now — `'f:' + the four ids sorted` in Formal, `'i:' + both team names` in Informal (`identAhora()`).

Every history entry is stamped with the `ident` it was played under, plus the `accents` it was played with. `nuevaTanda(ident)` resets `S.games` when the identity changes, and `manoMia(r)` decides whether a stored hand belongs to whoever is at the table now. Entries stored before 2.00 have no `ident` and fall back to comparing team names — the only thing knowable about them.

Two consequences worth keeping:

- **Colours belong to the people, not to the app.** `S.colores` remembers the accent pair per identity, so sitting down with the same four restores their colours, and a history row keeps the colours it was played with. History rows therefore set colour **inline** from `colorMano(r, t)`, never via the `.t0`/`.t1` classes, which point at the live `--a`/`--b` and would repaint three-day-old hands.
- **Don't invent an identity for old data.** The Formal/Informal label in the history (`tipoMano(r)`) renders nothing when `r.ident` is missing, because that distinction didn't exist when those hands were played.

### Three at the table (3.00)

Two people or four means two scoring columns; **three means three**, everyone against everyone, nobody with a partner. That is the first time "the team" stops being 0-or-1, and it is what the whole release is about: every `[0, 1]` in the code became `cadaEq()`, which answers two or three.

- `nEq()` / `cadaEq()` — how many columns there are now, and their indices.
- `esTres()` — the live table is a trio. It reads `S.mesa.cuantos === 3`, so it is Formal-only by construction: Blitz has no mesa.
- `ASIENTOS3 = [1, 0, 3]` — which **seat** paints in which **column**. The scorekeeper (seat 0) lands in the middle column, because that is their own score and it sits under their thumb. The trio uses no north seat.
- `idsEquipo(t, ids, tres)` — partners across the table for two/four, a single person for three. **The third argument is not optional in spirit:** this is also called with the mesa of a *stored* hand, which can be a trio when the live table isn't. Its default reads the live table, so any caller working on history has to pass the record's own answer.

A stored hand carries `r.tres`, and `manoTres(r)` is the **only** way to ask. Asking `r.tres` directly left out hands saved before the flag existed, which the history still painted with three figures — the pill showed three scores and the detail sheet showed two.

Three consequences that were each a bug first:

- **Anything that resets a score array has to size it.** `newGame()` hard-coded `[0, 0]`, so the second hand of a trio painted "Faltan NaN" in the third column.
- **Colours are as many as there are columns.** `acentosAlDia()` swaps the whole set when the count stops matching, and it is called from `renderMesa()` and from `#mesa-ok` — the two moments the count can change. `TRES_ACCENTS` is morado · azul · verde, in column order, so the scorekeeper in the middle is blue.
- **There are two "others" now.** Picking a colour someone else has swaps with them; with three, the code has to find *which* one. Same for lisa: it is winning without **anyone** else scoring, not without the other one scoring.

Team names don't exist at a trio: each column is a person, so the "Nombres de los equipos" section hides itself and the names always come from who is seated. The board columns get their own smaller scale through `--sc`, since each has a third of the screen instead of half.

**Landscape is not scoped to the mode, and can't be.** The lock lived in the manifest, which applies to the whole app, and the Screen Orientation API isn't available on iOS. So the lock was dropped and every screen was made to survive sideways — the lists scroll, the pad shrinks its keys, the board trims vertical chrome. The trio is the case that actually gains from it.

The menu's **Acostar la pantalla** (3.01, phones only) exists because dropping the lock is not enough: most people keep their phone's own rotation lock switched on, and then nothing turns. It tries the real thing first — fullscreen plus `screen.orientation.lock` — and falls back to rotating the `<body>` 90° in CSS when that throws, which is what iOS does. It rotates the **body**, not `#app`: the pad, the dialogs and the winner screen are siblings of `#app`, so rotating `#app` alone would leave them standing upright on top of a rotated board. `acostado` is screen state and does not persist.

### Two ways to sit down, three ways to score

Two axes, and keeping them apart is the whole design:

- **`S.tipo` — with whom.** `'formal'` (UI: **Anotar con jugadores**: a real table, named people, colours, identity) or `'informal'` (**Blitz**: two anonymous columns).
- **`S.mode` — what you score.** `'dom'`, `'cub'` or `'manos'` (**Por manos**).

Por manos was a third `S.tipo` until 2.6x, and it was wrong: "we're counting hands" says nothing about who is at the table, and as a tipo it could never be played in Blitz. `load()`'s `esquema 5` migration rewrites a stored `tipo:'manos'` into `tipo:'formal', mode:'manos'`, so a tanda in progress when the update lands keeps its table.

The internal keys never changed and must not: they are in `S.tipo`, in every `S.ident`, and in every stored hand. `TIPO_TXT` and `MODES[].label` are the only places the user-facing words live.

**Every check about "does this game have players" goes through `conMesa()`, and every check about units goes through `porManos()`.** Two bugs shipped from testing `S.tipo` directly — the Jugadores button painted itself enabled and then refused, and picking a saved group dropped you out of Por manos.

**Por manos is not a special case — it's the same game with different units.** A tanda at "mejor de X" is a match where each hand is worth 1 point and `S.target` is `paraGanar()` (half of X, rounded up). Everything else falls out for free: the score, "Faltan 2", the bar, one history row per tanda with `4 — 2` in it, the games tally, and lisa meaning *won without conceding a single hand*. `reg.manos` and `reg.mejor` are stamped on the record so the history knows what the numbers mean. An earlier attempt kept hands outside the machinery and produced one history row per hand; don't go back there.

Two consequences to keep in mind:

- `setTarget()` clamps to `TARGET_MIN`/`TARGET_MAX`, which are **points**. Under `porManos()` the target is hands, so the clamp is skipped — otherwise a 3-hand tanda asked for 2 and got 50, and never ended.
- The tanda length is written **`5/3`** — total over hands-needed, which is how it is said at the table. `cuantaTxt()` is the only place that wording lives. It is chosen with a stepper of **±2 between 3 and 41**: the step is what guarantees an odd number, and an even tanda can end in a tie.
- The score renders as tally marks (`marcasHTML`), grouped in fives with the fifth crossing the other four. The groups run **two per row** and wrap, so the sixth hand puts a second group to the right and the eleventh starts a new row. The cap is `max-width:min(100%, calc(var(--mw) * 2 + 9px))`, and the `100%` half is load-bearing: at a high zoom two groups no longer fit across a column, and it is what quietly drops them back to a single stack instead of overflowing. `.marcas` carries a `min-height` so the board doesn't jump between zero and one.
- The board's controls are **`−1 [+1] +2`**, centred as a unit: all three are the same 40px square, and what marks the middle one out is its colour, not its size. It was wider at first and the row read as lopsided — the thing that balances the trio under the score is that the three weigh the same. `+2` writes **two separate rounds**, not one round worth two — two hands were played, and the log shows one row per hand. If the first of them wins the tanda, the second is refused by `addRound`'s `S.over >= 0` guard, so `+2` can never overshoot the target.
- The log row in Por manos is only the hour, so it carries `.soloh`. The ordinary `.erow` is a three-cell grid (hour · points · X) and with two of the cells empty the hour sat pinned to the left in footnote type; `.soloh` makes it a centred flex row at a size that reads from across the table.
- The tanda length lives behind `#btn-cuanta` in the board's top bar, which toggles the `#cuanta` accordion below the gamebar. Kept permanently open it competed for room with the score and sat visibly off-axis. `cuantaAbierta` is screen state and doesn't persist; `render()` forces it closed whenever the mode isn't Por manos, so leaving for Blitz can't strand an accordion for a control that no longer exists.

**Blitz forces `BLITZ_ACCENTS` (azul/rojo) on entry**, overriding whatever `nuevaTanda` remembered. Colours belong to people, and Blitz never asks who is playing — so there they belong to nobody. It is also the only mode with no way to change them, since the colour picker lives on the Jugadores screen.

### A stored hand remembers how it ended, not how it went

Tapping any history row opens `abrirMano()`: score, teams, players, mode, target, and whether it was a lisa. From there `rehacerMano()` rebuilds the table exactly — same people in the same seats, their colours, names, mode and target — and starts a **fresh** hand.

There is nothing to "resume", and the detail sheet says so out loud rather than letting someone assume it was lost: `newGame()` clears `S.rounds`, and the record only ever held `scores` and `w`. Storing every round of 100 hands would multiply the state, and hands played before such a change would never have them anyway.

`rehacerMano()` is hidden when any player on that table has since been deleted — a tombstoned id still resolves to a name for display, but it cannot be seated again.

### The habitual group offers itself

`contarAparicion()` has been counting since 2.00: a quartet that produces at least one saved hand scores one *appearance*, at most one per calendar day. `dayKey()` does the day part, and it is not optional — `IDLE_MS` is an hour, so a family that plays, has dinner and comes back builds two tables the same evening.

`ofrecerGrupo()` is what finally uses it. At `GRUPO_VECES` (3) distinct days inside `GRUPO_VENTANA` (60), it offers once to save the group. Both it and `contarAparicion()` gate on `mesaGrabable(m)`, not on "all four": a trio that meets every week is as much a habit as a quartet, and since the record carries `cuantos` it can be brought back without losing anyone. **It never saves on its own**: a saved group is the first thing on the launcher and changes what you tap, so creating one unasked moves someone's buttons behind their back. "Ahora no" sets `rechazado` and it is offered a second and final time at `GRUPO_INSISTE` (8); a second no sets `nunca`.

It fires only at quiet moments — `momentoTranquilo()`, shared with `autoApply()`: not with the pad open, not over another dialog, not with a won hand on screen. The triggers are closing the winner screen, opening the app, and returning to it.

The counting lives on the group record, **never recomputed from `S.history`**: history is a 100-hand window, and a habit that forms over three months would erase its own evidence.

### The table asks who and how many

`S.mesa` gained `cuantos` (4 or 2) and `yoJuego`. Both are read through `mesaCuantos()` / `yoJuego()`, which default to 4 and true — **a mesa stored before this has neither field, and `load()`'s shallow merge cannot fill a nested record**. Changing either calls `rehacerMesa()`, which empties the table and re-seats only the scorekeeper, and only if they play: the seats stop meaning the same thing, so what was in them no longer holds.

For two players the seats are **0 and 1**, not 0 and 2 — those two are partners. Seat 1 is moved to the top of the square by CSS (`.mesa4.de2`), which is where an opponent sits.

### Two-step launcher and the table screen

`#sc-mode` has two steps driven by `S.tipo` (`null` → ask Informal/Formal → then the mode), not by a loose variable, so a reload mid-way lands somewhere coherent. `S.tipo` returns to `null` on idle reset.

Formal needs a name: `puedeFormal()` is false when `S.anotador` is empty, and without one the app stays Informal for good.

`#sc-mesa` is the square table. It has **two** paint functions and the split is not cosmetic: `renderMesa()` rebuilds the markup, `refrescarMesa()` only updates the derived bits. Calling the full one from a handler that fires mid-interaction destroys its siblings — that is how only two of four players ever got registered.

Seats are **buttons, not inputs**. Tapping one opens `#sentar` (`sillaAbierta`, `abrirSilla` / `cerrarSilla` / `pintarSentar`): an overlay listing the known players, with a field for a name that isn't in the catalogue yet. Tapping an occupied seat empties it and reopens the picker. The loose list of registered players and the separate "add a player" field that used to sit under the table are gone — there is one thing to tap, and it is in the place where the answer goes.

`S.mesa.modo` records which mode the table was built for, read through `mesaPorManos(m)`. The tanda-length stepper needs it: while the table is being built there is no `S.mode` yet, and it has to know whether `S.target` means points or hands.

### The Jugadores screen edits a draft, not the table

`#sc-jug` (`view === 'jugadores'`, reachable only from the board and only in Formal) changes who is at the table without leaving the scoring screen. It works on `jugBorrador`, a **copy** of `S.mesa.ids` — that is what makes "Guardar" mean something, and what makes leaving without saving a no-op. Like the other screen state, it doesn't persist; `render()` clears it whenever `view` moves away.

`guardarJug()` distinguishes **who is playing** from **where they sit**: it compares the sorted id sets, and only asks about the points in progress when someone actually entered or left. Reshuffling the same four asks nothing. The two answers are "keep the points" and "start from scratch"; that second label is why `ask()` grew a `noLabel` parameter.

Saving runs `nuevaTanda(identAhora())`, so changing who plays resets the games tally — the same rule as everywhere else.

Two things worth knowing: seat 0 can be emptied here, but `renderMesa()` forces the scorekeeper back into it the next time the table screen opens; and a name typed in with the table full is added to the catalogue without being seated, which is the point — you register people before they sit down.

### The backup is the only copy there is

Everything lives in one browser's `localStorage`, and the durable counters — what each person has won, who wins with whom, how many days a group has met — **cannot be rebuilt**: the history is a 400-hand window, but those numbers took months to add up. Ajustes → **Copia de seguridad** writes them out as a dated `.json` (clipboard as the fallback, because losing the data beats an ugly path).

Restoring **writes the file into `localStorage` and reloads** instead of pouring it into `S` by hand. That is the whole point: the copy then goes through `load()`, which is the only thing that knows how to migrate. A backup taken today still restores correctly after a future `esquema` bump — there is a test that restores an `esquema 4` file and checks it comes back already translated.

It validates before touching anything, and says what it is about to do (`"Trae 6 manos y 4 jugadores, del 26/8"`) behind `ask()`'s checkbox, like the wipe.

`recargar()` is the single place that reloads the page. Three unrelated things need it — restoring, reinstalling, and applying a waiting version — and keeping them in one function is what makes it obvious that reloading is always deliberate, never a side effect.

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

- **`install` fetches every asset with `cache: 'reload'`.** `cache.addAll()` would be shorter, but it goes through the browser's HTTP cache: with a still-fresh `index.html` from the previous release, a new worker cached the **old** HTML under its own version. The result was a phone reporting the new version while showing the old app — `sw.js` itself escapes because it is registered with `updateViaCache: 'none'`, which is exactly why the version display looked right. Only a reinstall cleared it. This shipped, and `S.avisoCache` (esquema 4) offers the reinstall once to anyone who might still be stuck.
- **Caches are per-version** (`tranque-${VERSION}`), and `fetch` is cache-first, not stale-while-revalidate. Together these mean everything a given worker serves comes from one version. Reintroducing background revalidation would let a new `index.html` slip into an old version's cache and re-create the mixed-version bug this design exists to prevent.
- **Never change the `localStorage` key** (`domino.v2`) in a release — an update would wipe everyone's history.

**Diagnosing a phone stuck on an old version.** Ajustes shows the version the active worker reports (`showVer()` asks it over a `MessageChannel`). If it says `desconocida (service worker viejo)`, a pre-update-flow worker is still in control: it has no `GET_VERSION` handler and can't be asked to step aside.

### The archived copies

`/1.37/` and `/2.81/` are kept playable at `hyco-ot.github.io/domino/<version>/` — the last release before the player system, and the last one before the three-player table. Each is built by `archivar.mjs` from `git show HEAD:index.html` with four things removed, and each removal exists because of a real failure mode:

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
- **A modifier class must not be named after a component that positions itself.** The winner's name in the history carried `class="hteam win"`, and `.win` is *also* the full-screen winner overlay — `position:fixed; inset:0; opacity:0`. That span inherited the whole overlay and became an invisible sheet the size of the phone: the name was painted, the separator showed, and the only thing invisible was whoever had won. It is now `gano`. **No jsdom test could see this** — the text was in the DOM — which is why `colision.mjs` exists: it parses the markup and flags any element whose non-primary classes position themselves. Same blind spot as the `[hidden]` trap, same kind of guard.
- **`[hidden]` loses to any rule that sets `display`.** `.linky`, `.wipe`, `.names2`, `.icon-btn` and `.menu button` all define their own, so each needs an explicit `[hidden]{display:none}` or the `hidden` property does nothing. This has bitten **six** times. `ocultos.mjs` guards it, and in 3.01 it had to be rebuilt: it only compared the element's own *classes*, so `.menu button` — a bare tag inside a container — walked straight past it and the new rotate-screen button shipped visible on desktops. It now parses the markup with jsdom and asks the DOM directly which display-setting selectors actually `matches()` the element, and whether any `[hidden]` rule matches it too. That is right in both directions; the class-name heuristic was wrong in both. (It also strips CSS comments first — the brace-splitting swallowed them into the selector, which then matched nothing.)
- The board's team name is an editable `<input>` in Informal and a read-only stack of player names (`.names2`) in Formal — the name comes from who is seated, so editing it there would contradict the table with nothing to reflect it.
- The style picker (Chercha / Clásico) lives in **two** places: the three-dot menu during a hand, and the top of Ajustes before one starts, since the menu doesn't exist on the launcher. `#cfg-sec-estilo` hides itself when `S.mode` is set, so only one is ever reachable.
- The score pad shows **no team name on purpose**. `.aim` is a two-column grid that parks an up-arrow over the half matching the team being scored, which lines up with that team's board column; the pad's `--pt` tint carries the same information. Don't "fix" it by adding a label back — the name lives on in the `aria-label` for screen readers.
- **`view === 'stats'` no longer implies a game is running.** The history is reachable from the launcher (only with at least one saved hand — an empty history is not a screen), so `#sc-stats` is toggled on `view` alone and its back arrow returns to whichever of the two it came from. The guard that matters is the other direction: clearing the history while looking at it from the launcher has to close the screen, or it stays open and blank.
- The slide animations run on `.screen > *`, never on `.screen` itself — that one is the flex column that holds the layout together, and transforming it moves the whole page. `animar()` removes the class before re-adding it and forces a reflow, or the same animation twice in a row plays once.
- The slide classes animate `> *`, but `.anim-fade` and `.anim-baja` animate **the element itself** — they are used on single pieces (the mesa's tile and mode caption when the mode changes; an accordion when it unfolds), not on a whole screen. `animar()` clears them all via `ANIMS`, so a new animation class has to be added there or it will never be removed.
- **"Revisar la mano" breathes**, and the animation hangs off `.result` itself rather than a class something toggles. While that button exists there is a hand to review, and that is exactly the stretch during which it should be asking for attention — so no repaint can cut it short or restart it. Winning by points deliberately does *not* jump to the winner screen (`recount()` sets `winSeen`), so this button was the only trace that anything had happened, and a single shake on arrival was missed by anyone looking at the score at that moment.
- What just arrived slides down into place: `.erow.entra` for the new log row and `.score.baja` for the figure. `filaNueva` carries which team scored, is set by `addRound` and is **spent on the next repaint** — `render()` fires for anything at all (opening a menu, changing theme), and replaying the entry on every one of them would read as a twitch. The figure's class is stripped on **every** repaint and re-added only when the flag is set: the figure is never rebuilt, only re-texted, so clearing it inside the `if` left it stuck from the first score onwards.
- The tanda stepper ("¿Hasta la cuánta?") sits **below** the table, not above it. It only exists in Por manos, so it appears the moment the mode is picked, and from above it shoved the whole table down right under the finger that had just tapped it. Its click listener hangs off `#mesa-mejor` itself for the same move: it used to be delegated from `#mesa-quien`, and taking the block out of that container left the − and + deaf with no error of any kind.
