# Flash catalogue

A shareable catalogue of available tattoo designs. Drop artwork in a folder, run one
command, get a single `index.html` you can send to a client, put behind a link, or print
as a flash book.

Nothing to install — no dependencies, no build tools, no framework. Just Node.

## Everyday use

Put your artwork in `flash/designs/` — `.svg`, `.png`, `.jpg` or `.webp` — then
**double-click `View Catalogue.command`** (macOS) or `View-Catalogue.bat` (Windows).
It rebuilds the catalogue and opens it in your browser. No terminal.

The first time on macOS, Gatekeeper will refuse a downloaded script: right-click the file,
choose **Open**, then **Open** again. It won't ask after that.

Prefer the terminal? It's the same thing:

```bash
node flash/build.mjs && open flash/index.html
```

## Browsing a big archive

The **Compact** button at the top switches to a contact sheet — around five times as many
designs per screen, references still under each one. Use it to scan a large collection;
switch back to **Large** when showing a client. Your choice is remembered.

Combine it with the search box and tag filters to find something fast: typing a reference,
a tag or part of a title narrows the sheet as you type.

Every new file is automatically given the next reference number (`BW-001`, `BW-002`, …)
and an entry in `designs.json`. Fill in the title, tags, size and placement there, then
run the build again.

## Why the reference numbers matter

`designs.json` is a ledger, not a cache. Once a file has a reference it keeps it forever —
even if you rename the file, reorder the folder, or add fifty designs in front of it. A
client who messaged you about `BW-014` three months ago still means the same design today.

Deleting artwork **retires** its reference rather than freeing it up, so a number is never
quietly reassigned to a different design. Retired entries stay in `designs.json` marked
`"missing": true`; delete those lines by hand if you genuinely want the number back.

## Editing a design's details

Open `designs.json` and edit the entry:

```json
"bw-003-coiled-serpent.svg": {
  "ref": "BW-003",
  "title": "Coiled Serpent",
  "tags": ["nature", "bold"],
  "size": "9–15 cm",
  "placement": "Knee, elbow, shoulder cap",
  "notes": "The coil scales well — good over a joint.",
  "repeatable": true,
  "hidden": false
}
```

- **tags** — become the filter buttons at the top of the page. Keep them few and reused.
- **repeatable** — `false` shows "One-off — tattooed once", which is what most flash is.
- **hidden** — `true` keeps the file and its reference but leaves it off the page. Use this
  for a design that's been claimed, instead of deleting it.

## Your details

`config.json` holds your name, contact details and the wording at the top of the page.
The email address there is used for the "Enquire" button, so it ends up visible to anyone
you send the catalogue to — swap it for a booking address if you'd rather not publish your
personal one. Leave `email` or `instagram` empty and that button simply won't appear.

## Making it a printed book

Open the page and print it (⌘P / Ctrl+P), then "Save as PDF". The print stylesheet drops
the search bar, buttons and colours, and lays the designs out three to a row with no design
split across a page break. Filter first and only the designs still on screen get printed —
handy for a per-client selection.

## Sharing it

If all your artwork is SVG, `index.html` is completely self-contained — the designs are
embedded in the file itself. You can email that one file and it works offline.

If you use PNG or JPG artwork, the page links to `designs/` instead, so keep that folder
next to `index.html` when you share or upload it. The build prints a reminder when this
applies to you.

To put it online, upload `index.html` (plus `designs/` if you have raster artwork) to any
static host — Netlify, Cloudflare Pages, GitHub Pages. There's no server to run.

## Notes on artwork

Vector (SVG) is worth preferring: the designs stay sharp at any zoom, the files are tiny,
and they're embedded straight into the page.

Designs always render as **black ink on a white plate, in both themes**. A tattoo shown
white-on-black reads as a negative and misrepresents how the design will sit on skin, so the
plates never invert — only the page chrome around them follows the viewer's theme.

Export your artwork as **black on transparent or white**.
