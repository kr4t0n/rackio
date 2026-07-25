/**
 * Minimal ICS feed for developing the calendar card without a real
 * subscription: a handful of upcoming rack-flavored events plus a weekly
 * recurrence. node scripts/mock-ical.mjs → http://localhost:8094/feed.ics
 */
import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 8094);

function icsDate(daysFromNow, hour, minute) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  date.setHours(hour, minute, 0, 0);
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function event(uid, daysFromNow, hour, minute, durationMin, summary, location, description, extra = "") {
  const start = icsDate(daysFromNow, hour, minute);
  const end = icsDate(daysFromNow, hour, minute + durationMin);
  return `BEGIN:VEVENT
UID:${uid}@rackio-mock
DTSTART:${start}
DTEND:${end}
SUMMARY:${summary}
LOCATION:${location}
DESCRIPTION:${description}
${extra}END:VEVENT`;
}

const feed = () => `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//rackio//mock//EN
${event("maintenance", 1, 18, 0, 60, "Rack maintenance window", "Home rack", "Review service updates and restart sequence.")}
${event("backup", 2, 9, 30, 30, "Backup verification", "Storage service", "Confirm the latest snapshot can be restored.", "RRULE:FREQ=WEEKLY;COUNT=6\n")}
${event("calibre-sync", 4, 20, 0, 30, "Calibre metadata sync", "Calibre-Web", "Review newly imported titles.")}
${event("ups-test", 7, 11, 0, 45, "UPS battery test", "Rack utility", "Run the scheduled battery health check.")}
${event("network", 11, 17, 30, 45, "Network rules review", "Router service", "Review pending firewall changes.")}
END:VCALENDAR
`;

createServer((req, res) => {
  if (req.url === "/feed.ics") {
    res.setHeader("Content-Type", "text/calendar");
    return res.end(feed());
  }
  res.statusCode = 404;
  res.end("not found");
}).listen(port, () => {
  console.log(`mock ical feed on http://localhost:${port}/feed.ics`);
});
