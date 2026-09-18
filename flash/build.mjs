#!/usr/bin/env node
/**
 * Flash catalogue builder.
 *
 * Drop artwork into ./designs, run `node flash/build.mjs`, get ./index.html.
 *
 * Reference numbers are assigned once and then never change: designs.json is the
 * ledger that remembers which file got which reference. That matters because a
 * client who messages you about "BW-014" next month must still mean this design.
 * Deleting a file retires its reference rather than recycling it.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, extname, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DESIGNS_DIR = join(HERE, 'designs')
const LEDGER_PATH = join(HERE, 'designs.json')
const CONFIG_PATH = join(HERE, 'config.json')
const OUT_PATH = join(HERE, 'index.html')

const ART = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp'])
const SMALL = new Set(['and', 'of', 'the', 'a', 'an', 'in', 'on', 'with', 'to', 'for', 'or'])

const DEFAULT_CONFIG = {
  artist: 'Your Name',
  tagline: 'Blackwork flash — available designs',
  location: '',
  email: '',
  instagram: '',
  refPrefix: 'BW',
  inlineLimit: 120,
  sheetPageSize: 'A3',
  sheetColumns: 8,
  intro:
    'Each piece below is available to tattoo. Designs are drawn once and tattooed once unless noted as repeatable. Tap any design for details, then send me its reference number.',
  footnote: 'Deposits are non-refundable and come off the final price.',
}

/* ---------------------------------------------------------------- helpers */

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  )

const titleFromFilename = (file) =>
  basename(file, extname(file))
    .replace(/^[a-z]{1,4}[-_ ]?\d{1,4}[-_ ]*/i, '') // strip a leading ref like "bw-001-"
    .replace(/[-_]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => (i > 0 && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1)))
    .join(' ') || basename(file, extname(file))

const refNumberIn = (file) => {
  const m = basename(file).match(/^[a-z]{1,4}[-_ ]?(\d{1,4})/i)
  return m ? parseInt(m[1], 10) : null
}

/**
 * Inline SVGs share one DOM, so two files both using id="mask" would collide and
 * silently break each other's masks. Namespace every id per design before inlining.
 */
function namespaceIds(svg, slug) {
  const ids = new Set()
  for (const m of svg.matchAll(/\sid="([^"]+)"/g)) ids.add(m[1])
  for (const id of ids) {
    const safe = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const next = `${slug}--${id}`
    svg = svg
      .replace(new RegExp(`(\\sid=")${safe}(")`, 'g'), `$1${next}$2`)
      .replace(new RegExp(`url\\(#${safe}\\)`, 'g'), `url(#${next})`)
      .replace(new RegExp(`(\\s(?:xlink:)?href=")#${safe}(")`, 'g'), `$1#${next}$2`)
  }
  return svg
}

function prepareSvg(raw, slug) {
  let svg = raw
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/i, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim()

  if (!/^<svg[\s>]/i.test(svg)) return null

  // An Illustrator export of an empty artboard is a valid but blank SVG. It would
  // otherwise take a reference and show as an empty card, so treat it as no art.
  if (!/<(path|circle|rect|ellipse|polygon|polyline|line|text|image|use)[\s/>]/i.test(svg)) {
    return null
  }

  // Let CSS own the size; keep viewBox so it scales cleanly at any resolution.
  svg = svg.replace(/^<svg([^>]*)>/i, (_, attrs) => {
    let a = attrs.replace(/\s(width|height)="[^"]*"/gi, '')
    if (!/viewBox=/i.test(a)) a += ' viewBox="0 0 400 400"'
    if (!/preserveAspectRatio=/i.test(a)) a += ' preserveAspectRatio="xMidYMid meet"'
    return `<svg${a} class="art" role="img" focusable="false">`
  })

  return namespaceIds(svg, slug)
}

const readJson = (p, fallback) => {
  if (!existsSync(p)) return fallback
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch (err) {
    console.error(`\n  ✗ ${basename(p)} is not valid JSON — fix it before rebuilding.\n    ${err.message}\n`)
    process.exit(1)
  }
}

/* ------------------------------------------------------------ build steps */

const config = { ...DEFAULT_CONFIG, ...readJson(CONFIG_PATH, {}) }
if (!existsSync(CONFIG_PATH)) writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n')

const ledger = readJson(LEDGER_PATH, {})

if (!existsSync(DESIGNS_DIR)) {
  console.error(`\n  ✗ No designs folder at ${DESIGNS_DIR}\n`)
  process.exit(1)
}

const files = readdirSync(DESIGNS_DIR)
  .filter((f) => !f.startsWith('.') && ART.has(extname(f).toLowerCase()))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))

// Reference numbers already spoken for, including retired ones.
const taken = new Set(
  Object.values(ledger)
    .map((e) => parseInt(String(e.ref).replace(/\D/g, ''), 10))
    .filter(Number.isFinite)
)
let nextFree = 1
const claimNext = () => {
  while (taken.has(nextFree)) nextFree++
  taken.add(nextFree)
  return nextFree
}

const pad = (n) => String(n).padStart(3, '0')
let added = 0

for (const file of files) {
  if (ledger[file]) {
    delete ledger[file].missing
    continue
  }
  const wanted = refNumberIn(file)
  const num = wanted !== null && !taken.has(wanted) ? (taken.add(wanted), wanted) : claimNext()
  ledger[file] = {
    ref: `${config.refPrefix}-${pad(num)}`,
    title: titleFromFilename(file),
    tags: [],
    size: '',
    placement: '',
    notes: '',
    repeatable: false,
    hidden: false,
  }
  added++
}

// A file that disappeared keeps its entry so its reference is never handed out again.
let retired = 0
for (const key of Object.keys(ledger)) {
  if (!files.includes(key) && !ledger[key].missing) {
    ledger[key].missing = true
    retired++
  }
}

writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + '\n')

/* ------------------------------------------------------------ the designs */

/**
 * Two strategies, chosen by size.
 *
 * Inlining every SVG makes a catalogue that is one portable file you can email,
 * and it works offline — ideal for a flash sheet of a few dozen designs. But the
 * whole page must download before anything appears, so past a certain count that
 * becomes a multi-megabyte wait on mobile data for a client who will look at the
 * first twenty. Beyond `inlineLimit`, designs are referenced and lazily loaded
 * instead: the browser fetches only what scrolls into view.
 */
const visible = files.filter((f) => !ledger[f].hidden)
const inlineSvg = visible.length <= (config.inlineLimit || 120)

const designs = []
for (const file of files) {
  const meta = ledger[file]
  if (meta.hidden) continue

  const slug = meta.ref.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const ext = extname(file).toLowerCase()
  let markup

  if (ext === '.svg') {
    // Validate every SVG whichever way it will be rendered — a blank or broken
    // file must not take a reference and show as an empty card just because
    // this catalogue is large enough to reference rather than inline.
    const prepared = prepareSvg(readFileSync(join(DESIGNS_DIR, file), 'utf8'), slug)
    if (!prepared) {
      console.warn(`  ! ${file} is empty or not an SVG — skipped`)
      continue
    }
    markup = inlineSvg
      ? prepared
      : `<img class="art" loading="lazy" decoding="async" src="designs/${encodeURIComponent(file)}" alt="${esc(meta.title)}">`
  } else {
    markup = `<img class="art" loading="lazy" decoding="async" src="designs/${encodeURIComponent(file)}" alt="${esc(meta.title)}">`
  }

  designs.push({ ...meta, file, slug, markup })
}

const allTags = [...new Set(designs.flatMap((d) => d.tags || []))].sort((a, b) =>
  a.localeCompare(b)
)

const hasRaster = designs.some((d) => !d.file.toLowerCase().endsWith('.svg'))

/* -------------------------------------------------------------- the page */

/**
 * Dark palette. Declared once and used by both the prefers-color-scheme block and
 * the explicit [data-theme="dark"] stamp, so a viewer's OS setting and the toggle
 * can never resolve to different palettes.
 * Cards are pure black so white negative space in a design inverts to exactly the
 * card colour.
 */
const DARK_TOKENS = `
      --bone:#131313; --ink:#F2EFE8; --muted:#8C877D; --line:#2A2A2A;
      --card:#000000; --accent:#F2EFE8; --on-accent:#0E0E0E;
      --shadow:none;
    `

const contactLinks = []
if (config.instagram) {
  const handle = config.instagram.replace(/^@/, '')
  contactLinks.push(
    `<a class="link" href="https://instagram.com/${esc(handle)}" target="_blank" rel="noopener">@${esc(handle)}</a>`
  )
}
if (config.email) contactLinks.push(`<a class="link" href="mailto:${esc(config.email)}">${esc(config.email)}</a>`)
if (config.location) contactLinks.push(`<span class="muted">${esc(config.location)}</span>`)

const cards = designs
  .map(
    (d) => `      <article class="card" data-ref="${esc(d.ref)}" data-title="${esc(d.title)}"
        data-tags="${esc((d.tags || []).join(' '))}" data-size="${esc(d.size)}"
        data-placement="${esc(d.placement)}" data-notes="${esc(d.notes)}"
        data-repeatable="${d.repeatable ? '1' : ''}" tabindex="0" role="button"
        aria-label="${esc(d.ref)} ${esc(d.title)}">
        <div class="frame">${d.markup}</div>
        <div class="meta">
          <span class="ref">${esc(d.ref)}</span>
          <h2 class="title">${esc(d.title)}</h2>
          ${d.size ? `<p class="size">${esc(d.size)}</p>` : ''}
          ${d.repeatable ? '' : '<p class="once">One-off — tattooed once</p>'}
        </div>
      </article>`
  )
  .join('\n')

const tagChips = allTags
  .map((t) => `<button class="chip" data-tag="${esc(t)}" type="button">${esc(t)}</button>`)
  .join('')

const emptyState = `      <div class="empty">
        <h2>No designs yet</h2>
        <p>Drop your artwork into <code>flash/designs/</code> — SVG, PNG, JPG or WebP — then run
          <code>node flash/build.mjs</code> again. Each new file is given the next reference number
          automatically.</p>
      </div>`

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(config.artist)} — Flash</title>
<meta name="description" content="${esc(config.tagline)}">
<meta name="color-scheme" content="light dark">
<meta property="og:title" content="${esc(config.artist)} — Flash">
<meta property="og:description" content="${esc(config.tagline)}">
<style>
  :root{
    --bone:#F4F1EA; --ink:#141414; --muted:#6B675F; --line:#DAD5C9;
    --card:#FFFFFF; --accent:#141414; --on-accent:#F4F1EA;
    --shadow:0 1px 2px rgba(20,20,20,.05), 0 8px 24px rgba(20,20,20,.06);
    /* Artwork is always black ink on a paper plate, in BOTH themes. A tattoo
       shown white-on-black is a negative — it misrepresents how the design sits
       on skin — so the plate and the ink are deliberately never re-themed and
       never inverted. Only the page chrome around them follows the theme. */
    --art-ink:#141414; --plate:#FFFFFF;
  }
  @media (prefers-color-scheme:dark){
    :root:not([data-theme="light"]){ ${DARK_TOKENS} }
  }
  :root[data-theme="dark"]{ ${DARK_TOKENS} }
  *{box-sizing:border-box}
  html{-webkit-text-size-adjust:100%}
  body{
    margin:0; background:var(--bone); color:var(--ink);
    font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  .wrap{max-width:1180px; margin:0 auto; padding:0 16px}

  header{padding:56px 0 28px; border-bottom:1px solid var(--line)}
  .eyebrow{
    margin:0 0 10px; font-size:11px; letter-spacing:.24em; text-transform:uppercase; color:var(--muted);
  }
  h1{
    margin:0; font-size:clamp(34px,7.5vw,60px); line-height:1.02;
    letter-spacing:-.025em; font-weight:600;
  }
  .tagline{margin:14px 0 0; max-width:56ch; color:var(--muted)}
  .contact{margin:18px 0 0; display:flex; flex-wrap:wrap; gap:8px 18px; font-size:14px}
  .link{color:var(--ink); text-underline-offset:3px}
  .muted{color:var(--muted)}

  .controls{
    position:sticky; top:env(safe-area-inset-top, 0px); z-index:20; background:var(--bone);
    border-bottom:1px solid var(--line); padding:12px 0;
  }
  .controls-inner{display:flex; flex-wrap:wrap; gap:10px; align-items:center}
  .search{
    flex:1 1 220px; min-width:0; padding:10px 14px; font:inherit; font-size:15px;
    color:var(--ink); background:var(--card); border:1px solid var(--line); border-radius:999px;
  }
  .search::placeholder{color:var(--muted)}
  .search:focus-visible,.chip:focus-visible,.card:focus-visible,.btn:focus-visible,.icon-btn:focus-visible{
    outline:2px solid var(--ink); outline-offset:2px;
  }
  .chips{display:flex; flex-wrap:wrap; gap:8px}
  #density{margin-left:auto}
  .chip{
    padding:8px 14px; font:inherit; font-size:13px; color:var(--ink); background:transparent;
    border:1px solid var(--line); border-radius:999px; cursor:pointer;
  }
  .chip[aria-pressed="true"]{background:var(--accent); color:var(--on-accent); border-color:var(--accent)}
  .icon-btn{ padding:8px 14px; font:inherit; font-size:13px; color:var(--ink);
    background:transparent; border:1px solid var(--line); border-radius:999px; cursor:pointer;
  }

  .count{padding:22px 0 4px; font-size:13px; color:var(--muted)}

  .grid{
    display:grid; gap:20px; padding:12px 0 72px;
    grid-template-columns:repeat(auto-fill,minmax(230px,1fr));
  }
  .card{
    background:var(--card); border:1px solid var(--line); border-radius:14px;
    padding:16px; cursor:pointer; box-shadow:var(--shadow);
    transition:transform .16s ease, box-shadow .16s ease, border-color .16s ease;
  }
  .card:hover{transform:translateY(-3px); border-color:var(--ink)}
  .card[hidden]{display:none}
  .frame{
    display:grid; place-items:center; aspect-ratio:1; margin-bottom:14px;
    color:var(--art-ink); background:var(--plate); border-radius:10px; padding:14px;
  }
  .art{
    width:100%; height:100%; object-fit:contain;
    /* A grid item will not shrink below its content's intrinsic size unless told
       to, which lets a tall design stretch its own plate and knock every card in
       the row out of alignment. These let the plate stay square and the artwork
       letterbox inside it. */
    min-width:0; min-height:0;
  }
  .meta .ref{
    font-size:11px; letter-spacing:.14em; color:var(--muted);
    font-variant-numeric:tabular-nums;
  }
  .title{margin:4px 0 0; font-size:16px; font-weight:600; letter-spacing:-.01em}
  .size,.once{margin:4px 0 0; font-size:12.5px; color:var(--muted)}

  /* Contact-sheet mode. Browsing a large archive is a different job from a
     client picking a design: you want as many thumbnails on screen as stay
     recognisable, so the cards shed their padding and text and keep the ref. */
  :root[data-density="dense"] .grid{
    grid-template-columns:repeat(auto-fill,minmax(104px,1fr)); gap:10px;
  }
  :root[data-density="dense"] .card{padding:7px}
  :root[data-density="dense"] .frame{margin-bottom:5px; padding:5px; border-radius:6px}
  :root[data-density="dense"] .title,
  :root[data-density="dense"] .size,
  :root[data-density="dense"] .once{display:none}
  :root[data-density="dense"] .meta .ref{font-size:10px; letter-spacing:.06em}

  .empty{
    grid-column:1/-1; padding:64px 24px; text-align:center; border:1px dashed var(--line);
    border-radius:14px; color:var(--muted);
  }
  .empty h2{margin:0 0 10px; color:var(--ink)}
  code{
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.9em;
    background:var(--card); border:1px solid var(--line); border-radius:5px; padding:1px 5px;
  }

  dialog{
    width:min(880px,100%); max-height:92vh; margin:auto; padding:0; color:var(--ink);
    background:var(--card); border:1px solid var(--line); border-radius:16px;
  }
  dialog::backdrop{background:rgba(10,10,10,.62)}
  .sheet{display:grid; grid-template-columns:1.1fr .9fr}
  @media (max-width:720px){ .sheet{grid-template-columns:1fr} }
  .sheet-art{
    display:grid; place-items:center; padding:28px; background:var(--plate);
    aspect-ratio:1; color:var(--art-ink);
  }
  @media (max-width:720px){ .sheet-art{aspect-ratio:4/3; padding:20px} }
  .sheet-body{padding:26px; overflow:auto}
  .sheet-body .ref{font-size:11px; letter-spacing:.16em; color:var(--muted)}
  .sheet-body h2{margin:6px 0 0; font-size:25px; letter-spacing:-.02em}
  dl{margin:20px 0 0; display:grid; grid-template-columns:auto 1fr; gap:8px 16px; font-size:14px}
  dt{color:var(--muted)}
  dd{margin:0}
  .actions{margin-top:24px; display:flex; flex-wrap:wrap; gap:10px}
  .btn{
    padding:11px 18px; font:inherit; font-size:14px; border-radius:999px; cursor:pointer;
    border:1px solid var(--accent); background:var(--accent); color:var(--on-accent);
    text-decoration:none; display:inline-block;
  }
  .btn.ghost{background:transparent; color:var(--ink); border-color:var(--line)}
  .close{
    position:absolute; top:12px; right:14px; width:36px; height:36px; font-size:20px; line-height:1;
    border-radius:999px; border:1px solid var(--line); background:var(--card); color:var(--ink);
    cursor:pointer;
  }
  .nav{margin-top:18px; display:flex; gap:10px; font-size:13px}
  .nav button{
    padding:7px 13px; font:inherit; font-size:13px; background:transparent; color:var(--ink);
    border:1px solid var(--line); border-radius:999px; cursor:pointer;
  }

  footer{padding:28px 0 56px; border-top:1px solid var(--line); font-size:13px; color:var(--muted)}

  @media (prefers-reduced-motion:reduce){ *{transition:none!important} .card:hover{transform:none} }

  /* Print / save-as-PDF: the same catalogue as a flash book. */
  @media print{
    :root{--bone:#fff; --card:#fff; --line:#ddd; --shadow:none}
    .controls,.icon-btn,.nav,.actions,.count,dialog{display:none!important}
    body{background:#fff}
    header{padding-top:0; border-bottom:1px solid #ddd}
    .grid{grid-template-columns:repeat(3,1fr); gap:14px; padding-top:18px}
    .card{break-inside:avoid; box-shadow:none; border-color:#e3e3e3}
    .card[hidden]{display:none!important}
    a[href]:after{content:""}
  }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <p class="eyebrow">Flash catalogue</p>
    <h1>${esc(config.artist)}</h1>
    <p class="tagline">${esc(config.intro)}</p>
    ${contactLinks.length ? `<p class="contact">${contactLinks.join('')}</p>` : ''}
  </header>
</div>

<div class="controls">
  <div class="wrap controls-inner">
    <input id="search" class="search" type="search" placeholder="Search designs, references or tags" aria-label="Search designs">
    ${allTags.length ? `<div class="chips" id="chips">${tagChips}</div>` : ''}
    <button id="density" class="icon-btn" type="button" aria-label="Switch between large and compact thumbnails">Compact</button>
    <button id="theme" class="icon-btn" type="button" aria-label="Switch between light and dark">Dark</button>
  </div>
</div>

<div class="wrap">
  <p class="count" id="count"></p>
  <main class="grid" id="grid">
${designs.length ? cards : emptyState}
  </main>
  <footer>
    <p>${esc(config.footnote)}</p>
    <p>${designs.length} design${designs.length === 1 ? '' : 's'} · References are permanent — quote one when you get in touch.</p>
  </footer>
</div>

<dialog id="sheet" aria-label="Design details">
  <button class="close" id="close" type="button" aria-label="Close">×</button>
  <div class="sheet">
    <div class="sheet-art" id="sheet-art"></div>
    <div class="sheet-body">
      <span class="ref" id="sheet-ref"></span>
      <h2 id="sheet-title"></h2>
      <dl id="sheet-dl"></dl>
      <div class="actions" id="sheet-actions"></div>
      <div class="nav">
        <button id="prev" type="button">← Previous</button>
        <button id="next" type="button">Next →</button>
      </div>
    </div>
  </div>
</dialog>

<script>
(function () {
  var CONTACT = ${JSON.stringify({ email: config.email || '', instagram: (config.instagram || '').replace(/^@/, ''), artist: config.artist })};
  var grid = document.getElementById('grid');
  var cards = Array.prototype.slice.call(grid.querySelectorAll('.card'));
  var search = document.getElementById('search');
  var chips = Array.prototype.slice.call(document.querySelectorAll('.chip'));
  var count = document.getElementById('count');
  var sheet = document.getElementById('sheet');
  var active = [];
  var index = -1;

  /* ---- theme: remembered per visitor, falls back to their OS setting ---- */
  var themeBtn = document.getElementById('theme');
  var root = document.documentElement;
  // Three states to respect: an explicit stamp already on the page (a host may
  // set one), this visitor's stored choice, else the OS preference — which CSS
  // already handles, so leave the root unstamped and don't fight it.
  function currentTheme() {
    return root.getAttribute('data-theme') ||
           (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }
  function label() { themeBtn.textContent = currentTheme() === 'dark' ? 'Light' : 'Dark'; }
  var stored = null;
  try { stored = localStorage.getItem('flash-theme'); } catch (e) {}
  if (stored && !root.getAttribute('data-theme')) root.setAttribute('data-theme', stored);
  label();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', label);
  themeBtn.addEventListener('click', function () {
    var next = currentTheme() === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    label();
    try { localStorage.setItem('flash-theme', next); } catch (e) {}
  });

  /* ---- density: remembered per visitor, same as the theme ---- */
  var densityBtn = document.getElementById('density');
  function labelDensity() {
    densityBtn.textContent = root.getAttribute('data-density') === 'dense' ? 'Large' : 'Compact';
  }
  try {
    if (localStorage.getItem('flash-density') === 'dense') root.setAttribute('data-density', 'dense');
  } catch (e) {}
  labelDensity();
  densityBtn.addEventListener('click', function () {
    var dense = root.getAttribute('data-density') === 'dense';
    if (dense) root.removeAttribute('data-density'); else root.setAttribute('data-density', 'dense');
    labelDensity();
    try { localStorage.setItem('flash-density', dense ? 'large' : 'dense'); } catch (e) {}
  });

  /* ---- filtering ---- */
  function activeTags() {
    return chips.filter(function (c) { return c.getAttribute('aria-pressed') === 'true'; })
                .map(function (c) { return c.dataset.tag; });
  }
  function filter() {
    var q = search.value.trim().toLowerCase();
    var tags = activeTags();
    active = [];
    cards.forEach(function (card) {
      var haystack = (card.dataset.ref + ' ' + card.dataset.title + ' ' + card.dataset.tags + ' ' +
                      card.dataset.notes + ' ' + card.dataset.placement).toLowerCase();
      var cardTags = (card.dataset.tags || '').split(/\\s+/);
      var show = (!q || haystack.indexOf(q) !== -1) &&
                 (!tags.length || tags.every(function (t) { return cardTags.indexOf(t) !== -1; }));
      card.hidden = !show;
      if (show) active.push(card);
    });
    count.textContent = active.length === cards.length
      ? cards.length + (cards.length === 1 ? ' design' : ' designs')
      : active.length + ' of ' + cards.length + ' designs';
  }
  search.addEventListener('input', filter);
  chips.forEach(function (chip) {
    chip.setAttribute('aria-pressed', 'false');
    chip.addEventListener('click', function () {
      chip.setAttribute('aria-pressed', chip.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
      filter();
    });
  });

  /* ---- detail sheet ---- */
  function row(dl, label, value) {
    if (!value) return;
    var dt = document.createElement('dt'); dt.textContent = label;
    var dd = document.createElement('dd'); dd.textContent = value;
    dl.appendChild(dt); dl.appendChild(dd);
  }
  function open(card) {
    index = active.indexOf(card);
    var art = document.getElementById('sheet-art');
    art.innerHTML = '';
    art.appendChild(card.querySelector('.frame').firstElementChild.cloneNode(true));
    document.getElementById('sheet-ref').textContent = card.dataset.ref;
    document.getElementById('sheet-title').textContent = card.dataset.title;

    var dl = document.getElementById('sheet-dl');
    dl.innerHTML = '';
    row(dl, 'Reference', card.dataset.ref);
    row(dl, 'Size', card.dataset.size);
    row(dl, 'Placement', card.dataset.placement);
    row(dl, 'Tags', (card.dataset.tags || '').split(/\\s+/).filter(Boolean).join(', '));
    row(dl, 'Availability', card.dataset.repeatable ? 'Repeatable' : 'One-off — tattooed once');
    row(dl, 'Notes', card.dataset.notes);

    var actions = document.getElementById('sheet-actions');
    actions.innerHTML = '';
    var line = card.dataset.ref + ' — ' + card.dataset.title;

    if (CONTACT.email) {
      var body = 'Hi ' + CONTACT.artist + ',\\n\\nI\\'d like to book this design:\\n\\n' +
                 '  Design: ' + line + '\\n  Placement: \\n  Approx. size: \\n' +
                 '  Availability: \\n\\nThanks!';
      var a = document.createElement('a');
      a.className = 'btn';
      a.href = 'mailto:' + CONTACT.email +
               '?subject=' + encodeURIComponent('Tattoo enquiry — ' + line) +
               '&body=' + encodeURIComponent(body);
      a.textContent = 'Enquire about ' + card.dataset.ref;
      actions.appendChild(a);
    }
    if (CONTACT.instagram) {
      var ig = document.createElement('a');
      ig.className = 'btn' + (CONTACT.email ? ' ghost' : '');
      ig.href = 'https://instagram.com/' + CONTACT.instagram;
      ig.target = '_blank'; ig.rel = 'noopener';
      ig.textContent = 'DM on Instagram';
      actions.appendChild(ig);
    }
    var copy = document.createElement('button');
    copy.className = 'btn ghost'; copy.type = 'button';
    copy.textContent = 'Copy reference';
    copy.addEventListener('click', function () {
      // Clipboard needs a secure context; fall back to selecting the text.
      var done = function () { copy.textContent = 'Copied ' + card.dataset.ref; setTimeout(function () { copy.textContent = 'Copy reference'; }, 1600); };
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(line).then(done, function () { window.prompt('Copy this reference:', line); });
      } else {
        window.prompt('Copy this reference:', line);
      }
    });
    actions.appendChild(copy);

    if (!sheet.open) sheet.showModal();
  }
  function step(delta) {
    if (!active.length) return;
    var i = (index + delta + active.length) % active.length;
    open(active[i]);
  }

  cards.forEach(function (card) {
    card.addEventListener('click', function () { open(card); });
    card.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(card); }
    });
  });
  document.getElementById('close').addEventListener('click', function () { sheet.close(); });
  document.getElementById('prev').addEventListener('click', function () { step(-1); });
  document.getElementById('next').addEventListener('click', function () { step(1); });
  sheet.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  });
  // Clicking the backdrop (outside the sheet) closes it.
  sheet.addEventListener('click', function (e) { if (e.target === sheet) sheet.close(); });

  filter();
})();
</script>
</body>
</html>
`

writeFileSync(OUT_PATH, page)

/* ----------------------------------------------------------- flash sheets */

/**
 * The printable counterpart: dense grids of designs with their reference under
 * each, sized for the studio wall or a folder on the counter rather than a
 * phone. Print this file to PDF and every design in the catalogue comes out
 * across however many pages it takes.
 *
 * Designs are always embedded here regardless of `inlineLimit` — a print job
 * that silently drops half its artwork because a lazy image had not loaded is
 * worse than a large file.
 */
const SHEET_PATH = join(HERE, 'sheets.html')
const sheetCols = Math.max(2, Number(config.sheetColumns) || 8)

const sheetCells = designs
  .map((d) => {
    const art =
      extname(d.file).toLowerCase() === '.svg'
        ? prepareSvg(readFileSync(join(DESIGNS_DIR, d.file), 'utf8'), `s-${d.slug}`)
        : `<img class="art" src="designs/${encodeURIComponent(d.file)}" alt="${esc(d.title)}">`
    if (!art) return ''
    return `    <figure class="cell">
      <div class="plate">${art}</div>
      <figcaption>${esc(d.ref)}</figcaption>
    </figure>`
  })
  .filter(Boolean)
  .join('\n')

const sheetPage = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(config.artist)} — Flash Sheets</title>
<style>
  @page{ size:${esc(config.sheetPageSize || 'A3')} portrait; margin:12mm; }
  *{box-sizing:border-box}
  body{
    margin:0; padding:12mm; background:#fff; color:#111;
    font:12px/1.4 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;
  }
  header{ margin:0 0 8mm; padding-bottom:4mm; border-bottom:1.5px solid #111; }
  h1{ margin:0; font-size:22px; letter-spacing:-.02em }
  .sub{ margin:4px 0 0; font-size:11px; color:#555 }
  .sheet{
    display:grid; grid-template-columns:repeat(${sheetCols}, 1fr); gap:4mm 3mm;
  }
  .cell{ margin:0; break-inside:avoid; page-break-inside:avoid; text-align:center }
  .plate{
    display:grid; place-items:center; aspect-ratio:1; padding:1.2mm;
    border:.3pt solid #e0e0e0; border-radius:1.2mm; background:#fff;
  }
  .art{ width:100%; height:100%; object-fit:contain; min-width:0; min-height:0; color:#111 }
  figcaption{
    margin-top:1mm; font-size:6.5pt; letter-spacing:.02em; color:#555;
    font-variant-numeric:tabular-nums;
  }
  .hint{
    margin:0 0 6mm; padding:3mm 4mm; border:.4pt dashed #bbb; border-radius:2mm;
    font-size:11px; color:#444;
  }
  @media print{ .hint{display:none} body{padding:0} }
</style>
</head>
<body>
  <header>
    <h1>${esc(config.artist)} — Flash</h1>
    <p class="sub">${designs.length} design${designs.length === 1 ? '' : 's'} · quote the reference beneath a design to book it</p>
  </header>
  <p class="hint">Print this page (⌘P / Ctrl+P) and choose “Save as PDF” for a flash book, or print it to pin up. Set your printer to ${esc(config.sheetPageSize || 'A3')} and enable background graphics. This box does not print.</p>
  <main class="sheet">
${sheetCells}
  </main>
</body>
</html>
`

writeFileSync(SHEET_PATH, sheetPage)

/* ------------------------------------------------------------- test sheet */

/**
 * A single A4 page for checking the printed size before committing to the whole
 * book. The designs are laid out at exactly the size the configured full-size
 * sheet produces — fewer fit on the smaller paper, which is the point: it is a
 * true-size slice, not a shrunken copy. A ruler is printed alongside so the
 * scale can be confirmed, since printers silently apply "fit to page" by default.
 */
const TEST_PATH = join(HERE, 'test-sheet.html')
const PAGE_MM = { A4: [210, 297], A3: [297, 420], A2: [420, 594] }
const MARGIN_MM = 12
const GAP_MM = 3

const [fullW] = PAGE_MM[config.sheetPageSize] || PAGE_MM.A3
const cellMm = (fullW - 2 * MARGIN_MM - (sheetCols - 1) * GAP_MM) / sheetCols

const [a4W, a4H] = PAGE_MM.A4
const testCols = Math.max(1, Math.floor((a4W - 2 * MARGIN_MM + GAP_MM) / (cellMm + GAP_MM)))
const testRows = Math.max(1, Math.floor((a4H - 2 * MARGIN_MM - 38) / (cellMm + 7.5)))
const testCount = testCols * testRows

const testCells = designs
  .slice(0, testCount)
  .map((d) => {
    const art =
      extname(d.file).toLowerCase() === '.svg'
        ? prepareSvg(readFileSync(join(DESIGNS_DIR, d.file), 'utf8'), `t-${d.slug}`)
        : `<img class="art" src="designs/${encodeURIComponent(d.file)}" alt="${esc(d.title)}">`
    return art
      ? `    <figure class="cell"><div class="plate">${art}</div><figcaption>${esc(d.ref)}</figcaption></figure>`
      : ''
  })
  .filter(Boolean)
  .join('\n')

const testPage = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(config.artist)} — Print Test Sheet</title>
<style>
  @page{ size:A4 portrait; margin:${MARGIN_MM}mm; }
  *{box-sizing:border-box}
  body{
    margin:0; padding:${MARGIN_MM}mm; background:#fff; color:#111;
    font:12px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;
  }
  h1{ margin:0 0 1mm; font-size:15px; letter-spacing:-.01em }
  .note{ margin:0 0 3mm; font-size:10px; color:#555 }
  .ruler{ margin:0 0 5mm }
  .bar{
    position:relative; width:100mm; height:7mm;
    border:.5pt solid #111; border-top:none;
  }
  .bar span{ position:absolute; top:0; width:.5pt; height:2.6mm; background:#111 }
  .bar span.major{ height:4.4mm }
  .bar b{ position:absolute; top:4.6mm; font-size:6.5pt; font-weight:400; transform:translateX(-50%) }
  .ruler p{ margin:1.5mm 0 0; font-size:9.5px; color:#111 }
  .sheet{ display:grid; grid-template-columns:repeat(${testCols}, ${cellMm.toFixed(2)}mm); gap:4mm ${GAP_MM}mm; }
  .cell{ margin:0; break-inside:avoid }
  .plate{
    display:grid; place-items:center; width:${cellMm.toFixed(2)}mm; height:${cellMm.toFixed(2)}mm;
    padding:1.2mm; border:.3pt solid #e0e0e0; border-radius:1.2mm; background:#fff;
  }
  .art{ width:100%; height:100%; object-fit:contain; min-width:0; min-height:0; color:#111 }
  figcaption{ margin-top:1mm; font-size:6.5pt; color:#555; text-align:center; font-variant-numeric:tabular-nums }
  .hint{ margin:0 0 4mm; padding:2.5mm 3mm; border:.4pt dashed #bbb; border-radius:2mm; font-size:11px; color:#444 }
  @media print{ .hint{display:none} body{padding:0} }
</style>
</head>
<body>
  <p class="hint">Print this at <strong>100% / Actual size</strong> — turn OFF “Fit to page” or “Scale to fit”, or the ruler and the designs will both come out wrong. This box does not print.</p>
  <h1>Print test — ${esc(config.artist)} flash</h1>
  <p class="note">Designs below are at their true ${cellMm.toFixed(0)}mm size, exactly as they print on the full ${esc(config.sheetPageSize || 'A3')} sheets (${sheetCols} per row). Only fewer fit on A4.</p>
  <div class="ruler">
    <div class="bar">
${Array.from({ length: 11 }, (_, i) =>
  `      <span class="major" style="left:${i * 10}mm"></span><b style="left:${i * 10}mm">${i * 10}</b>`
).join('\n')}
${Array.from({ length: 100 }, (_, i) => (i % 10 ? `      <span style="left:${i}mm"></span>` : '')).filter(Boolean).join('\n')}
    </div>
    <p>Check this bar measures <strong>100&nbsp;mm</strong> with a ruler. If it does, every design on the full sheets will print at the right size.</p>
  </div>
  <main class="sheet">
${testCells}
  </main>
</body>
</html>
`

writeFileSync(TEST_PATH, testPage)



/* ------------------------------------------------------------------ report */

console.log('')
console.log(`  Flash catalogue built → ${OUT_PATH.replace(HERE, 'flash')}`)
console.log(`  Printable sheets     → ${SHEET_PATH.replace(HERE, 'flash')} (${sheetCols} per row, ${config.sheetPageSize || 'A3'})`)
console.log(`  A4 print test        → ${TEST_PATH.replace(HERE, 'flash')} (${testCount} designs at true ${cellMm.toFixed(0)}mm)`)
console.log(`  ${designs.length} design${designs.length === 1 ? '' : 's'} on the page` +
  (added ? `, ${added} new` : '') + (retired ? `, ${retired} retired` : ''))
if (added) console.log(`  New designs were given references in designs.json — add titles and tags there.`)
if (inlineSvg && !hasRaster) {
  console.log(`  Self-contained: index.html embeds every design and works on its own.`)
} else if (!inlineSvg) {
  console.log(`  ${visible.length} designs is past the inline limit (${config.inlineLimit || 120}), so they are`)
  console.log(`  referenced and lazy-loaded. Keep designs/ next to index.html when you share it.`)
} else {
  console.log(`  Note: this page uses PNG/JPG designs, so keep designs/ next to index.html when you share it.`)
}
console.log('')
