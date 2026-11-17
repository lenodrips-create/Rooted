# Rooted

A simple, static Bible web app. No build step, no framework — just plain HTML,
CSS, and JavaScript you can open in a browser or drop onto any static host
(GitHub Pages, Netlify, Cloudflare Pages, etc.).

Three Bibles are included and readable side by side:

| Bible      | Translation                                     |
|------------|-------------------------------------------------|
| Protestant | King James Version (KJV), plus English Standard Version (ESV), New Living Translation (NLT), Berean Standard Bible (BSB), New Heart English Bible (NHEB) and American Standard Version (ASV) |
| Catholic   | Douay-Rheims Bible (Challoner)                   |
| Orthodox   | World English Bible (with full Orthodox canon)   |

## Pages

| Page          | What it does                                                        |
|---------------|---------------------------------------------------------------------|
| `index.html`  | Home: Verse of the Day, a "Bible in a Year" plan, and popular passages |
| `read.html`   | The reader — pick a Bible, browse books/chapters, and read the text |
| `search.html` | Ask-the-AI search (talks to a separate AI worker)                   |
| `news.html`   | Daily faith headlines (talks to a Cloudflare news worker)           |

## How it's laid out

```
Rooted/
├── index.html          Home page
├── read.html           Bible reader
├── search.html         AI search
├── news.html           Daily news
├── books.js            Protestant book list (root = Protestant)
├── Genesis.js …        Protestant books, one file per book (66 files)
├── catholic/           Catholic book list + one file per book
│   ├── books.js
│   └── Genesis.js …
├── bsb/ nheb/ asv/     Other Protestant translations, one file per book
│                       (uses the root books.js book list)
├── supabase/functions/ Server code: rooted-ai (AI search) and rooted-esv (ESV and NLT text)
├── orthodox/           Orthodox book list + one file per book
│   ├── books.js
│   └── Genesis.js …
├── news-worker.js      Cloudflare Worker for the News page (deploy separately)
├── images/             Logo and home video
└── style.css           (currently empty; styles live inline in each page)
```

## How the reader loads the text

`read.html` loads book data by injecting a `<script>` tag on demand, so only the
chapter you open is downloaded.

- **Protestant** files live at the repo **root** (`books.js`, `Genesis.js`, …).
- **Catholic** and **Orthodox** files live in their **own folders**
  (`catholic/Genesis.js`, `orthodox/Genesis.js`, …).

Each data file calls back into the page when it loads:

- `BibleData.setBooks(bible, translationName, bookList)` — from the `books.js` files
- `BibleData.add(bible, bookId, chapters)` — from each book file

The address bar drives everything via the hash:

```
read.html#protestant            → list of books
read.html#protestant-John       → list of chapters in John
read.html#protestant-John-3     → read John chapter 3
read.html#catholic-Genesis-1    → read Genesis 1 (Douay-Rheims)
```

Your Bible choice is remembered in `localStorage`, and switching Bibles keeps
you on the same book/chapter when that Bible has it.


## Protestant translations

The Protestant Bible has a second picker for the translation. The address uses
the translation id instead of `protestant`: `read.html#bsb-John-3`,
`read.html#esv-John-3` (`protestant` still means the KJV).

The KJV, BSB, NHEB and ASV are public domain and stored as files. The ESV and
NLT are copyrighted, so the `rooted-esv` Supabase function fetches them one
chapter at a time from their publishers' free (non-commercial) services:

- **ESV** from Crossway's ESV API. Needs the `ESV_API_KEY` secret; until it is
  set, the reader hides the ESV.
- **NLT** from Tyndale's NLT API. Works with Tyndale's public test key (limited
  to about 500 requests a day for the whole site); add an `NLT_API_KEY` secret
  to raise the limits.

Each chapter shows the publisher's copyright notice, as their terms require.
