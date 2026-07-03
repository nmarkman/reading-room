const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const FOLLOWUP_MODEL = process.env.ANTHROPIC_FOLLOWUP_MODEL || "claude-haiku-4-5-20251001";
const BOOKS_CSV_PATH = join(process.cwd(), "data", "lindsay-goodreads-read.csv");

let cachedBooks = null;
const sessions = new Map();

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured." });
      return;
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const action = String(body.action || "snapshot");
    const question = String(body.question || "").slice(0, 500);
    const sessionId = cleanDisplayText(body.sessionId || "default").slice(0, 160) || "default";
    const books = loadBooks();
    const history = normalizeHistory(sessionHistory(sessionId));

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 900,
        tools: [bookshelfInsightTool()],
        tool_choice: { type: "tool", name: "render_bookshelf_insight" },
        messages: [{ role: "user", content: buildPrompt(action, books, question, history) }],
      }),
    });

    const raw = await response.text();
    if (!response.ok) {
      res.status(response.status).json({ error: "Anthropic request failed.", detail: safeError(raw) });
      return;
    }

    const result = extractToolInput(JSON.parse(raw));
    const followups = await generateFollowups({ result, action, question, books, apiKey });
    appendSessionTurn(sessionId, "user", { summary: question || action });
    appendSessionTurn(sessionId, "assistant", result);

    res.status(200).json({
      model: ANTHROPIC_MODEL,
      followupModel: FOLLOWUP_MODEL,
      sessionId,
      result,
      followups,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "AI request failed." });
  }
};

function loadBooks() {
  if (cachedBooks) return cachedBooks;
  cachedBooks = parseCsv(readFileSync(BOOKS_CSV_PATH, "utf8")).map(normalizeBook).filter((book) => book.title);
  return cachedBooks;
}

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

function normalizeBook(row) {
  return {
    title: row.Title,
    author: row.Author,
    rating: Number(row["Lindsay Rating"] || 0),
    avgRating: Number(row["Goodreads Avg Rating"] || 0),
    category: row["Inferred Category"] || "Unsorted",
    readDate: row["Read Date"],
    addedDate: row["Date Added"],
    pages: row.Pages,
    series: row.Series,
    review: row["Review Text"],
    description: row.Description,
  };
}

function buildPrompt(action, books, question, history) {
  const sorted = [...books].sort((a, b) => String(b.readDate || "").localeCompare(String(a.readDate || "")));
  const compactBooks = sorted.slice(0, 80).map((book) => ({
    title: book.title,
    author: book.author,
    rating: book.rating,
    avgRating: book.avgRating,
    category: book.category,
    readDate: book.readDate,
    addedDate: book.addedDate,
    pages: book.pages,
    series: book.series,
    review: book.review ? book.review.slice(0, 500) : "",
    description: book.description ? book.description.slice(0, 260) : "",
  }));

  const actionGuide = {
    snapshot: "Give a warm, concise reading-library snapshot with 3 reader-facing observations.",
    recent: "Summarize recently read books in natural language and mention a few titles that stand out.",
    trends: "Describe reading taste patterns in conversational terms, using book titles as examples.",
    recommendations: "Suggest 5 next-book directions based on the reader's taste. Do not claim live web browsing.",
    question: "Answer the user's custom question about this reading history.",
  };

  return [
    "You are an AI reading companion inside a private bookshelf app for a reader.",
    "Use the supplied reading history privately as context. Be concrete and cite book titles as evidence.",
    "Keep the tone smart, warm, and useful. Sound like a thoughtful librarian, not a data analyst.",
    "Do not mention technical implementation details, spreadsheets, scraping, schemas, JSON, columns, field names, features, or internal labels.",
    "Avoid phrases like 'the data shows', 'the dataset', 'field', 'category count', 'rating distribution', or 'features'. Say things naturally, like 'your recent reads', 'your five-star books', or 'your shelf'.",
    "Keep the summary to 2-4 complete sentences. Put extra detail in bullets rather than making one long paragraph.",
    "Use conversation history to resolve follow-up references like 'that one', 'it', 'the last book', or 'why did I rate it that way'.",
    "If the user asks a follow-up, answer in context instead of restarting from scratch.",
    "Never include XML/HTML tags, Markdown bullets, or numbered-list prefixes inside field values.",
    "Each bullet and action must be plain sentence text in its own array item.",
    "Call the `render_bookshelf_insight` tool with the result. Do not answer in text.",
    "",
    `Task: ${actionGuide[action] || actionGuide.snapshot}`,
    question ? `User question: ${question}` : "",
    history.length ? `Conversation history JSON: ${JSON.stringify(history)}` : "",
    `Shelf stats JSON: ${JSON.stringify(summarizeBooks(books))}`,
    `Books JSON: ${JSON.stringify(compactBooks)}`,
  ].join("\n");
}

function summarizeBooks(books) {
  const countBy = (field) =>
    books.reduce((counts, book) => {
      const key = book[field] || "Unknown";
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {});

  return {
    totalBooks: books.length,
    fiveStars: books.filter((book) => Number(book.rating) === 5).length,
    reviewed: books.filter((book) => String(book.review || "").trim()).length,
    categories: countBy("category"),
    ratings: books.reduce((counts, book) => {
      const key = String(book.rating || "Unrated");
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {}),
    recentTitles: books
      .filter((book) => book.readDate)
      .sort((a, b) => String(b.readDate).localeCompare(String(a.readDate)))
      .slice(0, 12)
      .map((book) => `${book.title} (${book.rating} stars, ${book.readDate})`),
  };
}

function bookshelfInsightTool() {
  return {
    name: "render_bookshelf_insight",
    description: "Render a concise bookshelf insight for the UI.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["title", "summary", "bullets", "actions"],
      properties: {
        title: { type: "string", maxLength: 80 },
        summary: { type: "string", maxLength: 520 },
        bullets: { type: "array", minItems: 3, maxItems: 5, items: { type: "string", maxLength: 170 } },
        actions: { type: "array", minItems: 2, maxItems: 4, items: { type: "string", maxLength: 80 } },
      },
    },
  };
}

function followupTool() {
  return {
    name: "render_followups",
    description: "Render short suggested follow-up questions for a reading app chat.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["followups"],
      properties: {
        followups: { type: "array", minItems: 3, maxItems: 4, items: { type: "string", maxLength: 70 } },
      },
    },
  };
}

function extractToolInput(message) {
  const block = (message.content || []).find(
    (item) => item.type === "tool_use" && item.name === "render_bookshelf_insight",
  );
  if (block?.input) return normalizeInsight(block.input);

  const text = (message.content || []).filter((item) => item.type === "text").map((item) => item.text).join("\n").trim();
  if (!text) throw new Error("No insight returned.");
  return normalizeInsight({ title: "Shelf insight", summary: smartTrim(text, 520), bullets: [], actions: [] });
}

function normalizeInsight(input) {
  const bullets = normalizeListField(input.bullets);
  const actions = normalizeListField(input.actions);
  return {
    title: smartTrim(cleanDisplayText(input.title || "Shelf insight"), 90),
    summary: smartTrim(cleanDisplayText(input.summary || ""), 620),
    bullets: bullets.map((item) => smartTrim(cleanDisplayText(item), 190)).filter(Boolean).slice(0, 5),
    actions: (actions.length ? actions : ["Find similar books", "Summarize recent reads", "Show taste trends"])
      .map((item) => smartTrim(cleanDisplayText(item), 90))
      .filter(Boolean)
      .slice(0, 4),
  };
}

async function generateFollowups({ result, action, question, books, apiKey }) {
  const fallback = result.actions?.length
    ? result.actions
    : ["What should I read next?", "What changed recently?", "Show my strongest taste signal"];
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: FOLLOWUP_MODEL,
        max_tokens: 300,
        tools: [followupTool()],
        tool_choice: { type: "tool", name: "render_followups" },
        messages: [
          {
            role: "user",
            content: [
              "Create short follow-up chips for this bookshelf chat. They should invite useful next questions, not repeat the same request.",
              `Previous action: ${action}`,
              question ? `User question: ${question}` : "",
              `Assistant result: ${JSON.stringify(result)}`,
              `Shelf facts: ${JSON.stringify(summarizeBooks(books))}`,
            ].join("\n"),
          },
        ],
      }),
    });
    if (!response.ok) return fallback;
    return extractFollowups(JSON.parse(await response.text()), fallback);
  } catch {
    return fallback;
  }
}

function extractFollowups(message, fallback) {
  const block = (message.content || []).find((item) => item.type === "tool_use" && item.name === "render_followups");
  return Array.isArray(block?.input?.followups)
    ? block.input.followups.map((item) => cleanDisplayText(item).slice(0, 80)).slice(0, 4)
    : fallback;
}

function sessionHistory(sessionId) {
  if (!sessions.has(sessionId)) sessions.set(sessionId, []);
  return sessions.get(sessionId);
}

function appendSessionTurn(sessionId, role, content) {
  const history = sessionHistory(sessionId);
  history.push({
    role,
    title: cleanDisplayText(content.title || "").slice(0, 120),
    summary: cleanDisplayText(content.summary || "").slice(0, 500),
    bullets: normalizeListField(content.bullets).slice(0, 3),
  });
  sessions.set(sessionId, history.slice(-20));
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((turn) => turn && (turn.role === "user" || turn.role === "assistant"))
    .slice(-10)
    .map((turn) => ({
      role: turn.role,
      title: cleanDisplayText(turn.title || "").slice(0, 120),
      summary: cleanDisplayText(turn.summary || "").slice(0, 500),
      bullets: normalizeListField(turn.bullets).slice(0, 3),
    }))
    .filter((turn) => turn.summary || turn.title || turn.bullets.length);
}

function normalizeListField(value) {
  if (Array.isArray(value)) return value.flatMap((item) => normalizeListField(item));
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
  const sentenceEnd = Math.max(truncated.lastIndexOf(". "), truncated.lastIndexOf("! "), truncated.lastIndexOf("? "));
  if (sentenceEnd > limit * 0.55) return truncated.slice(0, sentenceEnd + 1).trim();
  const wordEnd = truncated.lastIndexOf(" ");
  return `${truncated.slice(0, wordEnd > 0 ? wordEnd : limit).trim()}...`;
}

function safeError(raw) {
  try {
    const parsed = JSON.parse(raw);
    return parsed.error?.message || parsed.message || "Unknown API error.";
  } catch {
    return raw.slice(0, 300);
  }
}
