const DATA_URL = "./data/lindsay-goodreads-read.csv";
const CHAT_STORAGE_KEY = "reading-room-chat-v1";
const SESSION_STORAGE_KEY = "reading-room-session-id";

const state = {
  books: [],
  filtered: [],
  selectedId: null,
  view: "shelf",
  filtersOpen: false,
  timelineMode: "all",
  timelineStart: null,
  page: "books",
  chat: [],
  sessionId: getSessionId(),
};

const els = {
  profileForm: document.querySelector("#profileForm"),
  syncStatus: document.querySelector("#syncStatus"),
  aiStatus: document.querySelector("#aiStatus"),
  chatLog: document.querySelector("#chatLog"),
  followupChips: document.querySelector("#followupChips"),
  aiQuestionForm: document.querySelector("#aiQuestionForm"),
  aiQuestion: document.querySelector("#aiQuestion"),
  aiButtons: [...document.querySelectorAll("[data-ai-action]")],
  pageButtons: [...document.querySelectorAll("[data-page]")],
  pagePanels: [...document.querySelectorAll("[data-page-panel]")],
  aiTotalBooks: document.querySelector("#aiTotalBooks"),
  aiFiveStars: document.querySelector("#aiFiveStars"),
  aiReviewedBooks: document.querySelector("#aiReviewedBooks"),
  totalBooks: document.querySelector("#totalBooks"),
  fiveStars: document.querySelector("#fiveStars"),
  reviewedBooks: document.querySelector("#reviewedBooks"),
  topCategory: document.querySelector("#topCategory"),
  filterButton: document.querySelector("#filterButton"),
  filterCount: document.querySelector("#filterCount"),
  filterDrawer: document.querySelector("#filterDrawer"),
  timelineControls: document.querySelector("#timelineControls"),
  timelineRangeLabel: document.querySelector("#timelineRangeLabel"),
  timelineButtons: [...document.querySelectorAll("[data-zoom]")],
  timelinePanButtons: [...document.querySelectorAll("[data-pan]")],
  closeFilters: document.querySelector("#closeFilters"),
  clearFilters: document.querySelector("#clearFilters"),
  scrim: document.querySelector("#scrim"),
  searchInput: document.querySelector("#searchInput"),
  categoryFilter: document.querySelector("#categoryFilter"),
  ratingFilter: document.querySelector("#ratingFilter"),
  sortSelect: document.querySelector("#sortSelect"),
  reviewedOnly: document.querySelector("#reviewedOnly"),
  romanceOnly: document.querySelector("#romanceOnly"),
  fantasyOnly: document.querySelector("#fantasyOnly"),
  darkOnly: document.querySelector("#darkOnly"),
  resultCount: document.querySelector("#resultCount"),
  quickInsight: document.querySelector("#quickInsight"),
  library: document.querySelector("#library"),
  bookRoute: document.querySelector("#bookRoute"),
  bookDetail: document.querySelector("#bookDetail"),
  viewButtons: [...document.querySelectorAll("[data-view]")],
};

function parseCsv(csv) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];
    const next = csv[i + 1];

    if (char === '"' && quoted && next === '"') {
      value += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(value);
      if (row.some((cell) => cell.length)) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }

  const [headers, ...records] = rows;
  return records.map((record) =>
    Object.fromEntries(headers.map((header, index) => [header, record[index] || ""])),
  );
}

function normalizeBook(row, index) {
  const rating = Number(row["Lindsay Rating"] || 0);
  const avgRating = Number(row["Goodreads Avg Rating"] || 0);
  const delta = Number(row["Rating Delta"] || 0);
  return {
    id: row["Goodreads Book ID"] || `${row.Title}-${index}`,
    title: row.Title,
    baseTitle: row["Base Title"] || row.Title,
    author: row.Author,
    series: row.Series,
    seriesNumber: row["Series Number"],
    rating,
    avgRating,
    delta,
    band: row["Rating Band"],
    readDate: row["Read Date"],
    addedDate: row["Date Added"],
    pages: row.Pages,
    year: row["Published Year"],
    isbn: row.ISBN,
    cover: row["Cover URL"],
    shelves: row["Other Shelves"],
    category: row["Inferred Category"] || "Unsorted",
    romance: row["Romance?"] === "Yes",
    fantasy: row["Fantasy/Paranormal?"] === "Yes",
    dark: row["Dark/Thriller?"] === "Yes",
    review: row["Review Text"],
    description: row.Description,
    goodreadsBook: row["Goodreads Book URL"],
    goodreadsReview: row["Goodreads Review URL"],
    startAt: parseDate(row["Date Added"]),
    endAt: parseDate(row["Read Date"]) || parseDate(row["Date Added"]),
  };
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function categoryCounts(books) {
  return books.reduce((counts, book) => {
    counts[book.category] = (counts[book.category] || 0) + 1;
    return counts;
  }, {});
}

function renderSummary() {
  const counts = categoryCounts(state.books);
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const fiveStars = state.books.filter((book) => book.rating === 5).length;
  const reviewed = state.books.filter((book) => book.review.trim()).length;
  els.totalBooks.textContent = state.books.length;
  els.fiveStars.textContent = fiveStars;
  els.reviewedBooks.textContent = reviewed;
  els.topCategory.textContent = top ? top[0] : "-";
  els.aiTotalBooks.textContent = state.books.length;
  els.aiFiveStars.textContent = fiveStars;
  els.aiReviewedBooks.textContent = reviewed;
}

function populateCategories() {
  const categories = Object.entries(categoryCounts(state.books)).sort((a, b) => b[1] - a[1]);
  els.categoryFilter.innerHTML = [
    `<option value="">All shelves</option>`,
    ...categories.map(([category, count]) => `<option value="${escapeHtml(category)}">${category} (${count})</option>`),
  ].join("");
}

function activeFilterCount() {
  return [
    els.searchInput.value.trim(),
    els.categoryFilter.value,
    Number(els.ratingFilter.value) > 0 ? els.ratingFilter.value : "",
    els.reviewedOnly.checked,
    els.romanceOnly.checked,
    els.fantasyOnly.checked,
    els.darkOnly.checked,
  ].filter(Boolean).length;
}

function applyFilters() {
  const query = els.searchInput.value.trim().toLowerCase();
  const category = els.categoryFilter.value;
  const minRating = Number(els.ratingFilter.value);

  state.filtered = state.books.filter((book) => {
    const haystack = [book.title, book.author, book.series, book.category, book.description].join(" ").toLowerCase();
    return (
      (!query || haystack.includes(query)) &&
      (!category || book.category === category) &&
      book.rating >= minRating &&
      (!els.reviewedOnly.checked || book.review.trim()) &&
      (!els.romanceOnly.checked || book.romance) &&
      (!els.fantasyOnly.checked || book.fantasy) &&
      (!els.darkOnly.checked || book.dark)
    );
  });

  sortBooks();
  renderLibrary();
  renderFilterCount();
}

function sortBooks() {
  const sort = els.sortSelect.value;
  const byTitle = (a, b) => a.baseTitle.localeCompare(b.baseTitle);
  state.filtered.sort((a, b) => {
    if (sort === "rating") return b.rating - a.rating || byTitle(a, b);
    if (sort === "delta") return b.delta - a.delta || b.rating - a.rating || byTitle(a, b);
    if (sort === "date") return (b.readDate || "").localeCompare(a.readDate || "") || byTitle(a, b);
    if (sort === "author") return a.author.localeCompare(b.author) || byTitle(a, b);
    return a.category.localeCompare(b.category) || b.rating - a.rating || byTitle(a, b);
  });
}

function renderFilterCount() {
  const count = activeFilterCount();
  els.filterCount.textContent = count;
  els.filterCount.hidden = count === 0;
}

function renderLibrary() {
  els.timelineControls.hidden = !["timeline", "duration"].includes(state.view);
  renderTimelineRange();
  els.resultCount.textContent = `${state.filtered.length} ${state.filtered.length === 1 ? "book" : "books"}`;
  els.quickInsight.textContent = buildInsight();
  els.library.className = `library ${state.view}-view`;

  if (!state.filtered.length) {
    els.library.innerHTML = `<div class="no-results">No books match those filters.</div>`;
    return;
  }

  if (state.view === "duration") {
    els.library.innerHTML = renderDurationBoard();
  } else if (state.view === "timeline") {
    els.library.innerHTML = renderTimeline();
  } else if (state.view === "grid") {
    els.library.innerHTML = renderBookButtons(state.filtered);
  } else {
    const groups = state.filtered.reduce((grouped, book) => {
      if (!grouped[book.category]) grouped[book.category] = [];
      grouped[book.category].push(book);
      return grouped;
    }, {});
    els.library.innerHTML = Object.entries(groups)
      .map(
        ([category, books]) => `
          <section class="category-section">
            <div class="category-title">
              <h3>${escapeHtml(category)}</h3>
              <span>${books.length}</span>
            </div>
            <div class="shelf-row">${renderBookButtons(books)}</div>
          </section>
        `,
      )
      .join("");
  }

  document.querySelectorAll(".book").forEach((button) => {
    button.addEventListener("click", () => {
      window.location.hash = `#/book/${encodeURIComponent(button.dataset.id)}`;
    });
  });
  document.querySelectorAll(".timeline-item").forEach((button) => {
    button.addEventListener("click", () => {
      window.location.hash = `#/book/${encodeURIComponent(button.dataset.id)}`;
    });
  });
  document.querySelectorAll(".duration-bar").forEach((button) => {
    button.addEventListener("click", () => {
      window.location.hash = `#/book/${encodeURIComponent(button.dataset.id)}`;
    });
  });
}

function renderBookButtons(books) {
  return books
    .map((book, index) => {
      const rotation = ((index % 7) - 3) * 0.8;
      return `
        <button
          class="book ${book.id === state.selectedId ? "active" : ""}"
          type="button"
          data-id="${escapeHtml(book.id)}"
          data-rating="${"★".repeat(book.rating)}"
          title="${escapeHtml(book.title)} by ${escapeHtml(book.author)}"
          style="--tilt: ${rotation}deg;"
        >
          <img src="${escapeHtml(book.cover)}" alt="${escapeHtml(book.title)} cover" loading="lazy" />
        </button>
      `;
    })
    .join("");
}

function buildInsight() {
  if (!state.filtered.length) return "";
  if (state.view === "timeline") {
    const dated = timelineBooks();
    return `${dated.length} books with dates. Start uses Goodreads Date Added; finish uses Read Date from the scrape.`;
  }
  if (state.view === "duration") {
    const dated = durationBooks();
    return `${dated.length} books plotted as reading spans. Bars use the earlier of Date Added/Read Date as start and the later date as finish.`;
  }
  const loved = state.filtered.filter((book) => book.rating === 5).length;
  const reviewed = state.filtered.filter((book) => book.review.trim()).length;
  const avg = state.filtered.reduce((sum, book) => sum + book.rating, 0) / state.filtered.length;
  return `${loved} loved, ${reviewed} with your notes, ${avg.toFixed(1)} average rating.`;
}

function durationBooks() {
  const windowRange = currentTimelineWindow();
  return state.filtered
    .filter((book) => book.startAt && book.endAt)
    .map((book) => {
      const start = book.startAt <= book.endAt ? book.startAt : book.endAt;
      const end = book.startAt <= book.endAt ? book.endAt : book.startAt;
      return { ...book, durationStart: start, durationEnd: end };
    })
    .filter((book) => !windowRange || (book.durationEnd >= windowRange.start && book.durationStart <= windowRange.end))
    .sort((a, b) => b.durationEnd - a.durationEnd || a.durationStart - b.durationStart);
}

function renderDurationBoard() {
  const books = durationBooks();
  const range = currentTimelineWindow() || durationDateRange(books);
  if (!books.length || !range) return `<div class="duration-empty">No books with start and finish dates in this window.</div>`;
  const totalMs = Math.max(range.end - range.start, 86400000);
  const ticks = monthTicks(range.start, range.end);

  return `
    <div class="duration-board">
      <div class="duration-axis">
        ${ticks
          .map((tick) => {
            const left = ((tick.date - range.start) / totalMs) * 100;
            return `<div class="duration-tick" style="left:${clamp(left, 0, 100)}%"><span>${escapeHtml(tick.label)}</span></div>`;
          })
          .join("")}
      </div>
      ${books.map((book) => renderDurationBar(book, range, totalMs)).join("")}
    </div>
  `;
}

function renderDurationBar(book, range, totalMs) {
  const visibleStart = book.durationStart < range.start ? range.start : book.durationStart;
  const visibleEnd = book.durationEnd > range.end ? range.end : book.durationEnd;
  const left = ((visibleStart - range.start) / totalMs) * 100;
  const width = Math.max(((visibleEnd - visibleStart) / totalMs) * 100, 4);
  const days = Math.max(1, Math.round((book.durationEnd - book.durationStart) / 86400000) + 1);
  return `
    <div class="duration-row">
      <button
        class="duration-bar"
        type="button"
        data-id="${escapeHtml(book.id)}"
        style="left:${clamp(left, 0, 98)}%; width:${clamp(width, 4, 100 - clamp(left, 0, 98))}%"
        title="${escapeHtml(book.baseTitle)} · ${formatShortDate(book.durationStart)} to ${formatShortDate(book.durationEnd)}"
      >
        <img src="${escapeHtml(book.cover)}" alt="${escapeHtml(book.title)} cover" loading="lazy" />
        <span>
          <strong>${escapeHtml(book.baseTitle)}</strong>
          <span>${days} day${days === 1 ? "" : "s"} · ${"★".repeat(book.rating)} · ${escapeHtml(book.category)}</span>
        </span>
      </button>
    </div>
  `;
}

function durationDateRange(books) {
  const starts = books.map((book) => book.durationStart).filter(Boolean);
  const ends = books.map((book) => book.durationEnd).filter(Boolean);
  if (!starts.length || !ends.length) return null;
  return {
    start: new Date(Math.min(...starts.map((date) => date.getTime()))),
    end: new Date(Math.max(...ends.map((date) => date.getTime()))),
  };
}

function monthTicks(start, end) {
  const ticks = [];
  const cursor = new Date(start);
  cursor.setDate(1);
  while (cursor <= end) {
    ticks.push({
      date: new Date(cursor),
      label: cursor.toLocaleDateString(undefined, { month: "short", year: "numeric" }),
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return ticks;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function timelineBooks() {
  const windowRange = currentTimelineWindow();
  return state.filtered
    .filter((book) => book.endAt)
    .filter((book) => !windowRange || (book.endAt >= windowRange.start && book.endAt <= windowRange.end))
    .sort((a, b) => b.endAt - a.endAt || b.rating - a.rating || a.baseTitle.localeCompare(b.baseTitle));
}

function renderTimeline() {
  const books = timelineBooks();
  if (!books.length) return `<div class="no-results">No dated books in this timeline window.</div>`;
  const groups = books.reduce((grouped, book) => {
    const key = monthKey(book.endAt);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(book);
    return grouped;
  }, {});

  return Object.entries(groups)
    .map(
      ([month, monthBooks]) => `
        <section class="timeline-month">
          <h3 class="timeline-month-label">${escapeHtml(month)}</h3>
          <div class="timeline-lane">
            ${monthBooks.map(renderTimelineItem).join("")}
          </div>
        </section>
      `,
    )
    .join("");
}

function renderTimelineItem(book) {
  return `
    <button class="timeline-item" type="button" data-id="${escapeHtml(book.id)}">
      <img src="${escapeHtml(book.cover)}" alt="${escapeHtml(book.title)} cover" loading="lazy" />
      <span class="timeline-copy">
        <strong>${escapeHtml(book.baseTitle)}</strong>
        <span>${escapeHtml(book.author)} · ${escapeHtml(book.category)} · ${"★".repeat(book.rating)}</span>
      </span>
      <span class="timeline-dates">
        <strong>${formatShortDate(book.endAt)}</strong>
        <span>${book.startAt ? `${formatShortDate(book.startAt)} start` : "start unknown"}</span>
      </span>
    </button>
  `;
}

function monthKey(date) {
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function formatShortDate(date) {
  if (!date) return "-";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function allDateRange() {
  const dates = state.filtered.map((book) => book.endAt).filter(Boolean).sort((a, b) => a - b);
  if (!dates.length) return null;
  return { start: dates[0], end: dates[dates.length - 1] };
}

function currentTimelineWindow() {
  if (state.timelineMode === "all") return null;
  const range = allDateRange();
  if (!range) return null;
  const months = state.timelineMode === "quarter" ? 3 : 12;
  const start = state.timelineStart || addMonths(range.end, -(months - 1));
  const end = addMonths(start, months);
  end.setDate(0);
  return { start, end };
}

function setTimelineMode(mode) {
  state.timelineMode = mode;
  const range = allDateRange();
  if (mode === "all" || !range) {
    state.timelineStart = null;
  } else {
    state.timelineStart = addMonths(range.end, mode === "quarter" ? -2 : -11);
    state.timelineStart.setDate(1);
  }
  renderLibrary();
}

function panTimeline(direction) {
  if (state.timelineMode === "all") return;
  const range = allDateRange();
  if (!range) return;
  const step = state.timelineMode === "quarter" ? 3 : 12;
  const next = addMonths(state.timelineStart || range.start, step * direction);
  next.setDate(1);
  state.timelineStart = next;
  renderLibrary();
}

function addMonths(date, months) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function renderTimelineRange() {
  els.timelineButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.zoom === state.timelineMode);
  });
  const range =
    currentTimelineWindow() ||
    (state.view === "duration" ? durationDateRange(durationBooks()) : allDateRange());
  if (!range) {
    els.timelineRangeLabel.textContent = "No dated books";
    return;
  }
  els.timelineRangeLabel.textContent =
    state.timelineMode === "all"
      ? `${formatShortDate(range.start)} - ${formatShortDate(range.end)}`
      : `${formatShortDate(range.start)} - ${formatShortDate(range.end)}`;
}

function setAiLoading(loading, label = "Thinking...") {
  els.aiButtons.forEach((button) => {
    button.disabled = loading;
  });
  els.followupChips.querySelectorAll("button").forEach((button) => {
    button.disabled = loading;
  });
  els.aiQuestionForm.querySelector("button").disabled = loading;
  els.aiStatus.textContent = loading ? label : "Ask about your reading history, patterns, recent books, or next reads.";
}

async function runAiAction(action, question = "") {
  if (!state.books.length) return;
  setPage("librarian");
  const userText = question || presetLabel(action);
  addChatMessage("user", { summary: userText });
  setAiLoading(true);
  const pendingId = addChatMessage("assistant", {
    loading: true,
    summary: "Reading the shelf...",
  });

  try {
    const response = await fetch("/api/ai", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, question, sessionId: state.sessionId }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || payload.error || "AI request failed.");
    replaceChatMessage(pendingId, payload.result);
    renderFollowups(payload.followups || payload.result.actions || []);
  } catch (error) {
    replaceChatMessage(pendingId, {
      title: "AI request failed",
      summary: error.message || "Something went wrong.",
      bullets: [],
      actions: ["Try library snapshot"],
    });
    renderFollowups(["Try library snapshot", "Summarize recent reads"]);
  } finally {
    setAiLoading(false);
  }
}

function getSessionId() {
  const existing = localStorage.getItem(SESSION_STORAGE_KEY);
  if (existing) return existing;
  const id = `bookshelf-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  localStorage.setItem(SESSION_STORAGE_KEY, id);
  return id;
}

function presetLabel(action) {
  return {
    snapshot: "Give me a library snapshot.",
    recent: "Summarize recently read books.",
    trends: "What taste trends do you see?",
    recommendations: "Help find next reads.",
  }[action] || "Ask the librarian.";
}

function addChatMessage(role, content) {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  state.chat.push({ id, role, content });
  saveChat();
  renderChat();
  return id;
}

function replaceChatMessage(id, content) {
  const message = state.chat.find((item) => item.id === id);
  if (message) message.content = content;
  saveChat();
  renderChat();
}

function saveChat() {
  const storable = state.chat
    .filter((message) => !message.content.loading)
    .slice(-24);
  localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(storable));
}

function loadChat() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY) || "[]");
    if (Array.isArray(parsed)) state.chat = parsed.filter((item) => item.role && item.content).slice(-24);
  } catch {
    state.chat = [];
  }
}

function renderChat() {
  const opening = `
    <article class="chat-message assistant">
      <span>Librarian</span>
      <div>
        <p>I can read across the shelf, compare ratings, spot patterns, and suggest what to explore next.</p>
      </div>
    </article>
  `;
  els.chatLog.innerHTML =
    opening +
    state.chat
      .map((message) => {
        const content = normalizeChatContent(message.content);
        return `
          <article class="chat-message ${message.role}${content.loading ? " loading" : ""}">
            <span>${message.role === "user" ? "You" : "Librarian"}</span>
            <div>
              ${
                content.loading
                  ? `<p class="thinking-line"><span aria-hidden="true"></span>${escapeHtml(content.summary)}</p>`
                  : `
                    ${content.title ? `<h3>${escapeHtml(content.title)}</h3>` : ""}
                    <p>${escapeHtml(content.summary)}</p>
                  `
              }
              ${
                !content.loading && content.bullets.length
                  ? `<ul>${content.bullets.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
                  : ""
              }
            </div>
          </article>
        `;
      })
      .join("");
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

function normalizeChatContent(content) {
  return {
    loading: Boolean(content.loading),
    title: smartTrim(cleanDisplayText(content.title || ""), 90),
    summary: smartTrim(cleanDisplayText(content.summary || ""), 620),
    bullets: normalizeDisplayList(content.bullets),
  };
}

function normalizeDisplayList(value) {
  if (Array.isArray(value)) return value.flatMap(normalizeDisplayList);
  if (!value) return [];
  return String(value)
    .replace(/<\/?bullet>/gi, "\n")
    .replace(/<\/?li>/gi, "\n")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/(?:^|\n)\s*[-*•]\s+/g, "\n")
    .replace(/(?:^|\n)\s*\d+[.)]\s+/g, "\n")
    .split(/\n+/)
    .map(cleanDisplayText)
    .filter(Boolean);
}

function cleanDisplayText(value) {
  return String(value || "")
    .replace(/<\/?bullet>/gi, " ")
    .replace(/<\/?li>/gi, " ")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-*•]\s+/, "")
    .replace(/^\s*\d+[.)]\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function smartTrim(value, limit) {
  const text = String(value || "").trim();
  if (text.length <= limit) return text;
  const truncated = text.slice(0, limit + 1);
  const sentenceEnd = Math.max(
    truncated.lastIndexOf(". "),
    truncated.lastIndexOf("! "),
    truncated.lastIndexOf("? "),
  );
  if (sentenceEnd > limit * 0.55) return truncated.slice(0, sentenceEnd + 1).trim();
  const wordEnd = truncated.lastIndexOf(" ");
  return `${truncated.slice(0, wordEnd > 0 ? wordEnd : limit).trim()}...`;
}

function renderFollowups(followups) {
  const items = (Array.isArray(followups) ? followups : []).filter(Boolean).slice(0, 4);
  els.followupChips.innerHTML = items
    .map((item) => `<button type="button" data-followup="${escapeHtml(item)}">${escapeHtml(item)}</button>`)
    .join("");
  els.followupChips.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      els.aiQuestion.value = "";
      runAiAction("question", button.dataset.followup);
    });
  });
}

function setPage(page, updateHash = true) {
  state.page = page;
  els.pageButtons.forEach((button) => button.classList.toggle("active", button.dataset.page === page));
  els.pagePanels.forEach((panel) => panel.classList.toggle("active", panel.dataset.pagePanel === page));
  if (updateHash && page === "librarian") window.location.hash = "#/librarian";
  if (updateHash && page === "books" && window.location.hash === "#/librarian") window.location.hash = "";
}

function renderRoute() {
  if (window.location.hash === "#/librarian") {
    setPage("librarian", false);
    closeBookRoute();
    return;
  }

  const match = window.location.hash.match(/^#\/book\/(.+)$/);
  if (!match) {
    closeBookRoute();
    return;
  }

  const id = decodeURIComponent(match[1]);
  const book = state.books.find((item) => item.id === id);
  if (!book) {
    closeBookRoute();
    return;
  }

  state.selectedId = id;
  renderBookDetail(book);
  els.bookRoute.classList.add("open");
  els.bookRoute.setAttribute("aria-hidden", "false");
  document.body.classList.add("overlay-open");
  renderLibrary();
}

function closeBookRoute() {
  state.selectedId = null;
  els.bookRoute.classList.remove("open");
  els.bookRoute.setAttribute("aria-hidden", "true");
  if (!state.filtersOpen) document.body.classList.remove("overlay-open");
  if (state.books.length) renderLibrary();
}

function renderBookDetail(book) {
  const flags = [
    book.category,
    book.band,
    book.series ? `${book.series} #${book.seriesNumber}` : "",
    book.shelves,
    book.romance ? "Romance" : "",
    book.fantasy ? "Fantasy/paranormal" : "",
    book.dark ? "Dark/thriller" : "",
  ].filter(Boolean);

  els.bookDetail.innerHTML = `
    <aside class="detail-cover">
      <button class="detail-back" type="button" data-close-book>Back to shelf</button>
      <img src="${escapeHtml(book.cover)}" alt="${escapeHtml(book.title)} cover" />
    </aside>
    <article class="detail-main">
      <p class="kicker">Book Details</p>
      <h2>${escapeHtml(book.baseTitle)}</h2>
      <p class="byline">by ${escapeHtml(book.author)}</p>

      <div class="detail-grid" aria-label="Book metrics">
        <article>
          <strong>${"★".repeat(book.rating) || "-"}</strong>
          <span>Your rating</span>
        </article>
        <article>
          <strong>${book.avgRating ? book.avgRating.toFixed(2) : "-"}</strong>
          <span>Goodreads avg</span>
        </article>
        <article>
          <strong>${book.delta ? `${book.delta > 0 ? "+" : ""}${book.delta.toFixed(2)}` : "-"}</strong>
          <span>Rating delta</span>
        </article>
        <article>
          <strong>${escapeHtml(book.pages || "-")}</strong>
          <span>Pages</span>
        </article>
      </div>

      <div class="meta">
        ${book.readDate ? `<span class="pill">Read ${escapeHtml(book.readDate)}</span>` : ""}
        ${book.addedDate ? `<span class="pill">Added ${escapeHtml(book.addedDate)}</span>` : ""}
        ${book.year ? `<span class="pill">Published ${escapeHtml(book.year)}</span>` : ""}
        ${book.isbn ? `<span class="pill">ISBN ${escapeHtml(book.isbn)}</span>` : ""}
        ${flags.map((flag) => `<span class="pill">${escapeHtml(flag)}</span>`).join("")}
      </div>

      <p class="section-title">Your Review</p>
      ${book.review.trim() ? `<p class="review">${escapeHtml(book.review)}</p>` : `<p>No review text scraped yet.</p>`}

      <p class="section-title">Goodreads Description</p>
      <p>${escapeHtml(book.description || "No description scraped.")}</p>

      <div class="links">
        <a href="${escapeHtml(book.goodreadsBook)}" target="_blank" rel="noreferrer">Open book</a>
        <a href="${escapeHtml(book.goodreadsReview)}" target="_blank" rel="noreferrer">Open review</a>
      </div>
    </article>
  `;

  els.bookDetail.querySelector("[data-close-book]").addEventListener("click", () => {
    window.location.hash = "";
  });
}

function setFiltersOpen(open) {
  state.filtersOpen = open;
  els.filterDrawer.classList.toggle("open", open);
  els.filterDrawer.setAttribute("aria-hidden", open ? "false" : "true");
  els.filterButton.setAttribute("aria-expanded", open ? "true" : "false");
  els.scrim.hidden = !open;
  document.body.classList.toggle("overlay-open", open || els.bookRoute.classList.contains("open"));
}

function clearFilters() {
  els.searchInput.value = "";
  els.categoryFilter.value = "";
  els.ratingFilter.value = "0";
  els.reviewedOnly.checked = false;
  els.romanceOnly.checked = false;
  els.fantasyOnly.checked = false;
  els.darkOnly.checked = false;
  applyFilters();
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function init() {
  const response = await fetch(DATA_URL);
  const csv = await response.text();
  state.books = parseCsv(csv).map(normalizeBook).filter((book) => book.title && book.cover);
  loadChat();
  renderSummary();
  populateCategories();
  applyFilters();
  renderChat();
  renderRoute();
}

[els.searchInput, els.categoryFilter, els.ratingFilter, els.sortSelect, els.reviewedOnly, els.romanceOnly, els.fantasyOnly, els.darkOnly].forEach(
  (el) => el.addEventListener("input", applyFilters),
);

els.viewButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.view = button.dataset.view;
    els.viewButtons.forEach((item) => item.classList.toggle("active", item === button));
    renderLibrary();
  });
});

els.pageButtons.forEach((button) => {
  button.addEventListener("click", () => setPage(button.dataset.page));
});

els.timelineButtons.forEach((button) => {
  button.addEventListener("click", () => setTimelineMode(button.dataset.zoom));
});

els.timelinePanButtons.forEach((button) => {
  button.addEventListener("click", () => panTimeline(Number(button.dataset.pan)));
});

els.filterButton.addEventListener("click", () => setFiltersOpen(true));
els.closeFilters.addEventListener("click", () => setFiltersOpen(false));
els.scrim.addEventListener("click", () => setFiltersOpen(false));
els.clearFilters.addEventListener("click", clearFilters);

window.addEventListener("hashchange", renderRoute);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (state.filtersOpen) setFiltersOpen(false);
    else if (els.bookRoute.classList.contains("open")) window.location.hash = "";
  }
});

els.profileForm.addEventListener("submit", (event) => {
  event.preventDefault();
  els.syncStatus.textContent =
    "Prototype scrape preview: fetch Goodreads RSS pages, normalize the 27 fields, then refresh this shelf.";
});

els.aiButtons.forEach((button) => {
  button.addEventListener("click", () => {
    els.aiQuestion.value = "";
    runAiAction(button.dataset.aiAction);
  });
});

els.aiQuestionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const question = els.aiQuestion.value.trim();
  if (!question) return;
  els.aiQuestion.value = "";
  runAiAction("question", question);
});

init().catch((error) => {
  els.library.innerHTML = `<div class="no-results">Could not load the Goodreads export.</div>`;
  els.syncStatus.textContent = error.message;
});
