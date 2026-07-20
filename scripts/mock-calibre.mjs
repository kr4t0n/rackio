/**
 * Minimal Calibre-Web OPDS mock for developing the calibre card without a
 * real library. Serves /opds/new, /opds/hot, and SVG covers, with optional
 * basic auth (MOCK_USER/MOCK_PASSWORD).
 *
 *   node scripts/mock-calibre.mjs            # http://localhost:8093
 *   CALIBRE_BASE_URL=http://localhost:8093 npm run dev:server
 */
import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 8093);
const user = process.env.MOCK_USER;
const password = process.env.MOCK_PASSWORD;

const BOOKS = [
  { id: 12, title: "The Time Machine", author: "H. G. Wells", hue: 210 },
  { id: 18, title: "The War of the Worlds", author: "H. G. Wells", hue: 10 },
  { id: 24, title: "The Picture of Dorian Gray", author: "Oscar Wilde", hue: 280 },
  { id: 31, title: "The Yellow Wallpaper", author: "Charlotte Perkins Gilman", hue: 48 },
  { id: 36, title: "Frankenstein", author: "Mary Shelley", hue: 150 },
  { id: 42, title: "The Souls of Black Folk", author: "W. E. B. Du Bois", hue: 330 },
  { id: 47, title: "Meditations", author: "Marcus Aurelius", hue: 90 },
  { id: 53, title: "The Art of War", author: "Sun Tzu", hue: 20 },
  { id: 58, title: "Walden", author: "Henry David Thoreau", hue: 130 },
  { id: 61, title: "The Prince", author: "Niccolò Machiavelli", hue: 250 },
];

function feed(title, books) {
  const entries = books
    .map(
      (b) => `  <entry>
    <title>${b.title}</title>
    <id>urn:uuid:mock-${b.id}</id>
    <author><name>${b.author}</name></author>
    <link rel="http://opds-spec.org/image" href="/opds/cover/${b.id}" type="image/svg+xml"/>
  </entry>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>urn:uuid:mock-feed</id>
  <title>${title}</title>
${entries}
</feed>`;
}

function cover(book) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${book.hue} 45% 32%)"/>
      <stop offset="1" stop-color="hsl(${(book.hue + 40) % 360} 50% 16%)"/>
    </linearGradient>
  </defs>
  <rect width="400" height="600" fill="url(#g)"/>
  <rect x="24" y="24" width="352" height="552" fill="none" stroke="hsl(${book.hue} 60% 70% / .5)" stroke-width="2"/>
  <text x="48" y="120" fill="#f4f2ec" font-family="Georgia, serif" font-size="34" font-weight="bold">
    ${book.title
      .split(" ")
      .reduce((lines, word) => {
        const last = lines[lines.length - 1];
        if (last && (last + " " + word).length <= 16) lines[lines.length - 1] = `${last} ${word}`;
        else lines.push(word);
        return lines;
      }, [])
      .map((line, i) => `<tspan x="48" dy="${i === 0 ? 0 : 42}">${line}</tspan>`)
      .join("")}
  </text>
  <text x="48" y="540" fill="#f4f2ecbb" font-family="Georgia, serif" font-size="20">${book.author}</text>
</svg>`;
}

createServer((req, res) => {
  if (user) {
    const expected = `Basic ${Buffer.from(`${user}:${password ?? ""}`).toString("base64")}`;
    if (req.headers.authorization !== expected) {
      res.statusCode = 401;
      return res.end("Unauthorized Access");
    }
  }
  const url = new URL(req.url, "http://mock");
  const coverMatch = url.pathname.match(/^\/opds\/cover\/(\d+)$/);
  if (coverMatch) {
    const book = BOOKS.find((b) => b.id === Number(coverMatch[1]));
    if (!book) {
      res.statusCode = 404;
      return res.end();
    }
    res.setHeader("Content-Type", "image/svg+xml");
    return res.end(cover(book));
  }
  if (url.pathname === "/opds/new") {
    res.setHeader("Content-Type", "application/atom+xml");
    return res.end(feed("Recently added", BOOKS));
  }
  if (url.pathname === "/opds/hot") {
    res.setHeader("Content-Type", "application/atom+xml");
    return res.end(feed("Hot books", [...BOOKS].reverse()));
  }
  res.statusCode = 404;
  res.end("not found");
}).listen(port, () => {
  console.log(`mock calibre-web on http://localhost:${port}`);
});
