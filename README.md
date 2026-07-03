# Reading Room

A Goodreads-powered reading exploration prototype.

Reading Room turns a public Goodreads shelf export into a visual bookshelf, reading timeline, duration view, book detail pages, and an AI Librarian that can talk through reading patterns and next-read ideas.

The bundled seed data is a real starter dataset from one reader's Goodreads read shelf. The app copy is intentionally generic so the product can later support any Goodreads profile.

## Features

- Cover-forward shelf view grouped by inferred reading category.
- Grid, timeline, and duration views.
- Filters for search, rating, category, review text, and genre flags.
- Book detail route with cover, ratings, pages, dates, review text, and Goodreads links.
- AI Librarian chat with session memory, preset prompts, and generated follow-up chips.
- Server-owned reading dataset for AI calls, so the browser does not send the full shelf on every turn.

## Local Development

```bash
node server.js
```

Open `http://localhost:4177/`.

For local AI calls, the server reads the Anthropic credential from 1Password using the local service-account token. You can also set `ANTHROPIC_API_KEY`.

## Vercel Deployment

This repo is Vercel-ready:

- Static app files are served from the repo root.
- `api/ai.js` is the Vercel serverless function for `POST /api/ai`.
- Set `ANTHROPIC_API_KEY` in Vercel project environment variables.

The serverless function reads `data/lindsay-goodreads-read.csv` as seed data. Future work should replace that static CSV with an import/sync flow from a provided Goodreads profile URL.

## Data Contract

The current prototype reads `data/lindsay-goodreads-read.csv`, normalized from Goodreads RSS into fields such as title, author, rating, average rating, dates, pages, cover URL, review text, inferred category, and genre flags.

Future backend flow:

1. Accept a public Goodreads profile or shelf URL.
2. Extract user ID and shelf.
3. Fetch `review/list_rss/:user_id?shelf=...&per_page=200&page=N`.
4. Normalize to the existing table shape.
5. Store the reader's shelf server-side and expose it to the app.
