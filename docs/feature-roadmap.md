# Feature Roadmap Notes

These are sensible next directions for Reading Room after the current proof of concept. They are intentionally brief so they can be revisited later without committing to implementation now.

## 1. AI-Generated Collections

Create dynamic shelves from Librarian answers, such as dark romantasy favorites, quick five-star reads, series to continue, palate cleansers, or books that underperformed.

Possible implementation path:
- Add a server-side collection schema: title, description, criteria, book IDs.
- Let the Librarian return a structured `collection` object alongside chat answers.
- Add a `Collections` section in Books that renders AI-created shelves using the existing book-card components.

## 2. Better Book Detail Pages

Make each book page feel more interpretive, not just informational.

Possible implementation path:
- Add “similar books on your shelf,” “why this rating makes sense,” and “series context.”
- Add a button to ask the Librarian about the current book.
- Reuse the existing server-side shelf context and pass the selected book ID as query context.

## 3. Reader Taste Profile

Create a durable summary of the reader's tastes: favorite ingredients, common five-star patterns, underperforming patterns, favorite authors/series, and pacing preferences.

Possible implementation path:
- Generate a profile from the full shelf using the Librarian model.
- Cache it server-side as a profile artifact.
- Show it as a separate page or side rail in Librarian.

## 4. Recommendation Workflow

Move from general next-read ideas to concrete recommendation cards.

Possible implementation path:
- Start with “directional recommendations” using only current shelf data.
- Add fields like why it fits, confidence, vibe, and safe bet / stretch / palate cleanser.
- Later integrate an external book API for real candidate discovery.

## 5. Dynamic Shelves From Chat

Bridge chat and browsing. If the Librarian describes a pattern, the user should be able to open it as a shelf.

Possible implementation path:
- Add “Open as shelf” to relevant Librarian responses.
- Store collection criteria from the response.
- Apply criteria to the current book list and navigate to a filtered Books view.

## 6. Reading Phases

Interpret the timeline instead of only visualizing dates.

Possible implementation path:
- Group reads by month or streak.
- Label phases like “romantasy binge,” “series sprint,” or “literary fiction detour.”
- Add phase markers to the Timeline or Duration view.

## 7. Recommendation Feedback Loop

Let the reader train the Librarian on whether suggestions feel right.

Possible implementation path:
- Add feedback controls: sounds good, not for me, already read something like this.
- Store lightweight preference notes in local/server session state.
- Include those preferences in future recommendation prompts.

## 8. Import And Sync Flow

Generalize beyond the bundled seed data.

Possible implementation path:
- Accept a Goodreads profile URL.
- Detect available shelves.
- Preview imported books before saving.
- Support read, currently-reading, and want-to-read shelves.
