# Tiny Trove

A blind box shelf that lives on your phone. Mark what you've opened, see what you're still hunting,
and check weights, data points and shake tips before you buy.

Plain HTML, CSS and JavaScript: no build step, no frameworks, no server.

## What's private and what's public

| | Where it lives | Who can see it |
|---|---|---|
| What you own, dates, counts, notes | IndexedDB on your phone | only you, on that phone |
| Collections, series and figures you made | IndexedDB on your phone | only you, on that phone |
| Photos added inside the app | IndexedDB on your phone | only you, on that phone |
| The catalog (`data/`) and `photos/` folder | this repo / GitHub Pages | anyone with the link |

Nothing you tap in the app is ever sent anywhere. Someone else who opens the site gets their own empty shelf.

## Put it on your iPhone

1. Push this folder to a GitHub repo and turn on **Settings → Pages** (deploy from the main branch, root folder).
   For a repo called `tiny-trove` it'll be at `https://<username>.github.io/tiny-trove/`.
   (Or drop the folder into your existing `<username>.github.io` repo as `tiny-trove/`. Everything uses relative paths, so either works.)
2. Open that address in **Safari** on your iPhone, tap **Share → Add to Home Screen**.
3. Open it from the Home Screen icon from now on. The Home Screen app and a Safari tab keep **separate** data.

It works offline after the first open.

## Keeping your data safe

- Data survives closing the app, restarting and powering off the phone.
- **Deleting the Home Screen icon deletes the data.** So does clearing Safari website data in Settings.
- Use **Save backup** on the home screen now and then. It makes a `.json` file (including your in-app photos)
  you can keep in Files / iCloud Drive. **Load backup** restores it, on the same or a new phone.

## Make your own

- **+ on the bookcase** makes a new collection.
- **+ new series** at the bottom of any collection's shelves (Smiski too) adds a series. You can type its figures
  one per line; put ★ in front of a secret.
- **+ add figure** at the end of any series shelf adds a figure: name, Japanese name, secret, your own weights
  with and without box, and notes / shake tips.
- Things you made have an **edit** link (top right) to rename or delete them. Built-in Smiski data can't be edited there.

They work like everything else (shelves, opened / date / count / notes, photos, search, sorting, weights in order)
and are stored on your phone only. Backups include them.

## Photos

See [`photos/README.md`](photos/README.md). Short version: `photos/smiski/<series>/<figure>.jpg`,
every filename is listed in `photos/smiski/FILENAMES.txt`.

## The catalog

`data/smiski.js` is generated from the community
[Smiski Collection Masterlist](https://docs.google.com/spreadsheets/d/1U4l4ugaL8UG7wzEfQqQ1h_oYYX0s0tGpqw9XV_cxnms/)
(average weights with and without box, data points, the low–high range of reports, and the Tips + Tricks tab copied word for word),
plus the Japanese figure names printed on the boxes, from smiski.com.

Each figure looks like this. Edit it by hand to fix or add things:

```js
{ "id": "living/sunflower", "slug": "sunflower", "en": "Sunflower", "ja": "", "jaUnsure": false,
  "secret": true, "box": { "avg": 46.09, "n": 6, "min": 45, "max": 46.84 },
  "bare": { "avg": 32.14, "n": 3, "min": 31.3, "max": 33 }, "tips": "- You can feel..." }
```

- `ja: ""` means the official site didn't list it (all secrets, Bath Ball 1, the Christmas hanging series).
  Fill them in from your boxes.
- `jaUnsure: true` marks a match I wasn't sure of (Moving "Green Thumb", Bath Ball 2 "Floating" / "Laid Back").
- The sheet keeps getting updated. To refresh numbers, edit the values or regenerate the file.

### Adding another collection later

Create `data/<name>.js` that calls `window.TROVE_CATALOGS.push({...})` with the same shape, add a
`<script>` tag for it in `index.html` and the file to `SHELL` in `sw.js`. It shows up on the bookcase automatically.
For its own look, add a `body.skin-<name>` block in `styles.css`.

## Updating the app

After changing any app file, bump `VERSION` in `sw.js` (e.g. `tiny-trove-v2`) so phones fetch the new copy.
Your saved collection is not affected by updates.

## Files

```
index.html             page shell
styles.css             the shelf look (colors per collection at the top)
app.js                 the app: storage, pages, backup
sketches.js            generic pose sketches shown when there's no photo
data/smiski.js         Smiski catalog
photos/                your figure photos (public)
icons/                 Home Screen icons
manifest.webmanifest   Home Screen app settings
sw.js                  offline support
```
