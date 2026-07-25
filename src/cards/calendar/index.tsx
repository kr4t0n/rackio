import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { z } from "zod";
import { CloseIcon } from "@/app/icons";
import { Field, TextInput } from "@/board/settings-fields";
import type { CalendarEvent } from "@/lib/api";
import {
  clearCalendarConnection,
  fetchCalendarConnection,
  fetchCalendarEvents,
  saveCalendarConnection,
} from "@/lib/api";
import type {
  CardComponentProps,
  CardDefinition,
  CardSettingsProps,
} from "../registry";

const configSchema = z.object({});
type CalendarConfig = z.infer<typeof configSchema>;

/* ---------- date helpers ---------- */

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}
function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function formatTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
function formatDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

interface HydratedEvent extends Omit<CalendarEvent, "start" | "end"> {
  start: Date;
  end: Date;
}

function useEvents() {
  const query = useQuery({
    queryKey: ["calendar"],
    queryFn: fetchCalendarEvents,
    refetchInterval: 10 * 60_000,
    staleTime: 9 * 60_000,
  });
  const events: HydratedEvent[] = (query.data?.events ?? []).map((event) => ({
    ...event,
    start: new Date(event.start),
    end: new Date(event.end),
  }));
  return { feed: query.data, events };
}

/* ---------- event details dialog ---------- */

function EventDialog({
  event,
  onClose,
}: {
  event: HydratedEvent | null;
  onClose: () => void;
}) {
  const reducedMotion = useReducedMotion();
  return createPortal(
    <AnimatePresence>
      {event && (
        <div
          className="fixed inset-0 z-50 grid place-items-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Event details"
        >
          <motion.div
            className="absolute inset-0 bg-[color-mix(in_oklch,var(--bg)_72%,transparent)] backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="relative w-[min(390px,100%)] rounded-[18px] border border-border bg-surface p-[18px] shadow-[0_24px_70px_color-mix(in_oklch,var(--bg)_75%,transparent)]"
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: "spring", duration: 0.35, bounce: 0.15 }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="m-0 mb-1 font-mono text-[9px] font-[550] tracking-[0.08em] uppercase text-muted">
                  Event details
                </p>
                <h2 className="m-0 font-display text-[22px] leading-[1.08] font-semibold tracking-[-0.02em]">
                  {event.title}
                </h2>
              </div>
              <button
                type="button"
                aria-label="Close event details"
                onClick={onClose}
                className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-xl border border-border bg-[color-mix(in_oklch,var(--surface)_84%,var(--fg)_4%)] transition-colors hover:bg-[color-mix(in_oklch,var(--surface)_72%,var(--fg)_10%)] [&_svg]:h-4 [&_svg]:w-4 [&_svg]:stroke-[1.7]"
              >
                <CloseIcon />
              </button>
            </div>
            <div className="mt-4 grid gap-2.5">
              <div className="grid grid-cols-[58px_minmax(0,1fr)] gap-2.5 text-[13px] leading-[1.4]">
                <span className="font-mono text-[9px] tracking-[0.06em] text-muted uppercase">
                  When
                </span>
                <span>
                  {event.allDay
                    ? `${formatDate(event.start)} · all day`
                    : `${formatDate(event.start)}, ${formatTime(event.start)}–${formatTime(event.end)}`}
                </span>
              </div>
              {event.location ? (
                <div className="grid grid-cols-[58px_minmax(0,1fr)] gap-2.5 text-[13px] leading-[1.4]">
                  <span className="font-mono text-[9px] tracking-[0.06em] text-muted uppercase">
                    Where
                  </span>
                  <span className="min-w-0 break-words">{event.location}</span>
                </div>
              ) : null}
            </div>
            {event.notes ? (
              <p className="m-0 mt-3.5 line-clamp-6 text-[12.5px] leading-[1.5] text-muted">
                {event.notes}
              </p>
            ) : null}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* ---------- panels ---------- */

function MonthPanel({
  visibleMonth,
  selectedDate,
  today,
  eventDays,
  onNavigate,
  onSelect,
}: {
  visibleMonth: Date;
  selectedDate: Date;
  today: Date;
  eventDays: Set<string>;
  onNavigate: (next: Date) => void;
  onSelect: (date: Date) => void;
}) {
  const mondayOffset = (visibleMonth.getDay() + 6) % 7;
  const first = addDays(visibleMonth, -mondayOffset);
  const cells = Array.from({ length: 42 }, (_, index) => addDays(first, index));
  const navClass =
    "relative grid h-7 w-7 cursor-pointer place-items-center rounded-lg border border-border bg-[color-mix(in_oklch,var(--surface)_84%,var(--fg)_4%)] transition-colors hover:bg-[color-mix(in_oklch,var(--surface)_72%,var(--fg)_10%)] after:absolute after:-inset-2 after:content-[''] [&_svg]:h-3 [&_svg]:w-3 [&_svg]:stroke-[1.7]";

  return (
    <section className="grid min-h-0 grid-rows-[28px_22px_minmax(0,1fr)]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 font-display text-[15px] leading-none font-semibold tracking-[-0.01em]">
          {new Intl.DateTimeFormat(undefined, {
            month: "long",
            year: "numeric",
          }).format(visibleMonth)}
        </h2>
        <div className="flex gap-4">
          <button
            type="button"
            aria-label="Previous month"
            className={navClass}
            onClick={() =>
              onNavigate(
                new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1),
              )
            }
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <button
            type="button"
            className="relative min-h-7 cursor-pointer rounded-lg border border-border bg-[color-mix(in_oklch,var(--surface)_84%,var(--fg)_4%)] px-2.5 text-[10px] font-[550] tracking-[0.02em] transition-colors after:absolute after:-inset-2 after:content-[''] hover:bg-[color-mix(in_oklch,var(--surface)_72%,var(--fg)_10%)]"
            onClick={() => {
              onNavigate(new Date(today.getFullYear(), today.getMonth(), 1));
              onSelect(today);
            }}
          >
            Today
          </button>
          <button
            type="button"
            aria-label="Next month"
            className={navClass}
            onClick={() =>
              onNavigate(
                new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1),
              )
            }
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 pt-2" aria-hidden="true">
        {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => (
          <span
            key={index}
            className="text-center font-mono text-[9px] leading-[14px] font-[550] tracking-[0.08em] uppercase text-muted"
          >
            {day}
          </span>
        ))}
      </div>
      <div className="grid min-h-0 grid-cols-7 grid-rows-6">
        {cells.map((date) => {
          const isToday = sameDay(date, today);
          const isSelected = sameDay(date, selectedDate);
          const outside = date.getMonth() !== visibleMonth.getMonth();
          return (
            <button
              key={date.toISOString()}
              type="button"
              aria-label={formatDate(date)}
              aria-pressed={isSelected}
              onClick={() => onSelect(date)}
              className={`relative min-h-0 min-w-0 cursor-pointer rounded-[9px] p-[5px] text-left font-mono text-[11px] leading-none tabular-nums transition-colors ${
                isToday
                  ? "bg-accent font-semibold text-bg"
                  : outside
                    ? "text-[color-mix(in_oklch,var(--muted)_45%,transparent)] hover:bg-[color-mix(in_oklch,var(--fg)_7%,transparent)]"
                    : "text-fg hover:bg-[color-mix(in_oklch,var(--fg)_7%,transparent)]"
              } ${
                isSelected && !isToday
                  ? "bg-[color-mix(in_oklch,var(--fg)_8%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--fg)_50%,transparent)]"
                  : ""
              }`}
            >
              {date.getDate()}
              {eventDays.has(date.toDateString()) ? (
                <span className="absolute right-1.5 bottom-1.5 h-1 w-1 rounded-full bg-current opacity-70" />
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function WeekStrip({
  today,
  selectedDate,
  onSelect,
}: {
  today: Date;
  selectedDate: Date;
  onSelect: (date: Date) => void;
}) {
  const days = Array.from({ length: 12 }, (_, offset) => addDays(today, offset));
  return (
    <div className="grid h-full min-h-0 grid-cols-4 grid-rows-3 gap-1">
      {days.map((date, offset) => {
        const isToday = offset === 0;
        const isSelected = sameDay(date, selectedDate);
        return (
          <button
            key={date.toISOString()}
            type="button"
            aria-label={`Show upcoming events from ${formatDate(date)}`}
            aria-pressed={isSelected}
            onClick={() => onSelect(date)}
            className={`grid min-h-0 min-w-0 cursor-pointer content-center rounded-[9px] border px-0.5 py-1 text-center transition-colors ${
              isToday
                ? "border-transparent bg-accent text-bg"
                : `border-border text-fg hover:bg-[color-mix(in_oklch,var(--fg)_7%,transparent)] ${
                    isSelected
                      ? "bg-[color-mix(in_oklch,var(--fg)_8%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--fg)_50%,transparent)]"
                      : ""
                  }`
            }`}
          >
            <span className="block text-[8px] font-semibold tracking-[0.06em] uppercase">
              {new Intl.DateTimeFormat(undefined, { weekday: "narrow" }).format(date)}
            </span>
            <span className="mt-1 block font-mono text-[12px] leading-none tabular-nums">
              {date.getDate()}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Agenda({
  events,
  selectedDate,
  count,
  columns,
  showHead,
  configured,
  onOpen,
}: {
  events: HydratedEvent[];
  selectedDate: Date;
  count: number;
  columns: 1 | 2;
  showHead: boolean;
  configured: boolean;
  onOpen: (event: HydratedEvent) => void;
}) {
  const upcoming = events
    .filter((event) => event.end >= selectedDate)
    .slice(0, count);
  return (
    <section className="min-h-0 min-w-0">
      {showHead && (
        <div className="mb-1.5 flex items-center justify-between gap-2.5">
          <h2 className="m-0 text-[11px] font-semibold tracking-[0.01em]">
            Upcoming ·{" "}
            {new Intl.DateTimeFormat(undefined, {
              month: "short",
              day: "numeric",
            }).format(selectedDate)}
          </h2>
        </div>
      )}
      <div
        className={`grid gap-1.5 ${columns === 2 ? "grid-cols-2" : "grid-cols-1"}`}
      >
        {upcoming.length === 0 ? (
          <p className="col-span-full m-0 flex h-11 items-center rounded-[10px] border border-border px-2.5 text-[10px] text-muted">
            {configured
              ? "No upcoming events"
              : "Connect an iCal feed in this card's settings"}
          </p>
        ) : (
          upcoming.map((event) => (
            <button
              key={event.id}
              type="button"
              onClick={() => onOpen(event)}
              className="h-11 min-w-0 cursor-pointer rounded-[10px] border border-border bg-[color-mix(in_oklch,var(--surface)_84%,var(--fg)_4%)] px-2 text-left transition-colors hover:bg-[color-mix(in_oklch,var(--surface)_72%,var(--fg)_10%)]"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 font-mono text-[9px] leading-[1.2] text-muted tabular-nums">
                  {event.allDay ? "all day" : formatTime(event.start)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[11px] leading-[1.15] font-[550]">
                    {event.title}
                  </span>
                  <span className="mt-0.5 block truncate text-[9px] leading-[1.15] text-muted">
                    {formatDate(event.start)}
                    {event.location ? ` · ${event.location}` : ""}
                  </span>
                </span>
              </span>
            </button>
          ))
        )}
      </div>
    </section>
  );
}

/* ---------- the card ---------- */

function CalendarCard({ footprint }: CardComponentProps<CalendarConfig>) {
  const today = startOfDay(new Date());
  const { feed, events } = useEvents();
  const [visibleMonth, setVisibleMonth] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const [selectedDate, setSelectedDate] = useState(today);
  const [openEvent, setOpenEvent] = useState<HydratedEvent | null>(null);
  const configured = feed?.configured ?? true;

  const eventDays = new Set(events.map((event) => event.start.toDateString()));

  const selectDay = (date: Date, followMonth = false) => {
    const day = startOfDay(date);
    setSelectedDate(day);
    if (
      followMonth &&
      (day.getMonth() !== visibleMonth.getMonth() ||
        day.getFullYear() !== visibleMonth.getFullYear())
    ) {
      setVisibleMonth(new Date(day.getFullYear(), day.getMonth(), 1));
    }
  };

  const header = (compact: boolean) => (
    <header className="flex min-w-0 items-center justify-between gap-3">
      <h1
        className={`m-0 font-display font-semibold tracking-[-0.015em] ${
          compact ? "text-[16px]" : "text-[21px] leading-[1.08]"
        }`}
      >
        Calendar
      </h1>
      {footprint === "small" && (
        <time className="shrink-0 rounded-[9px] bg-accent px-2 py-1.5 font-mono text-[10px] leading-[1.2] font-semibold tracking-[0.02em] whitespace-nowrap text-bg">
          {formatDate(today).replace(", ", " · ")}
        </time>
      )}
    </header>
  );

  if (footprint === "small") {
    return (
      <div className="flex h-full flex-col gap-2 p-3">
        {header(true)}
        <div className="min-h-0 flex-1">
          <Agenda
            events={events}
            selectedDate={selectedDate}
            count={3}
            columns={1}
            showHead={false}
            configured={configured}
            onOpen={setOpenEvent}
          />
        </div>
        <EventDialog event={openEvent} onClose={() => setOpenEvent(null)} />
      </div>
    );
  }

  if (footprint === "wide") {
    return (
      <div className="flex h-full flex-col gap-2 p-3">
        {header(true)}
        <div className="grid min-h-0 flex-1 grid-cols-[148px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-3">
          <div className="min-h-0 overflow-hidden border-r border-border pr-3">
            <WeekStrip
              today={today}
              selectedDate={selectedDate}
              onSelect={selectDay}
            />
          </div>
          <Agenda
            events={events}
            selectedDate={selectedDate}
            count={2}
            columns={1}
            showHead
            configured={configured}
            onOpen={setOpenEvent}
          />
        </div>
        <EventDialog event={openEvent} onClose={() => setOpenEvent(null)} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2.5 p-3.5">
      {header(false)}
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] gap-2">
        <MonthPanel
          visibleMonth={visibleMonth}
          selectedDate={selectedDate}
          today={today}
          eventDays={eventDays}
          onNavigate={setVisibleMonth}
          onSelect={(date) => selectDay(date, true)}
        />
        <Agenda
          events={events}
          selectedDate={selectedDate}
          count={4}
          columns={2}
          showHead={false}
          configured={configured}
          onOpen={setOpenEvent}
        />
      </div>
      <EventDialog event={openEvent} onClose={() => setOpenEvent(null)} />
    </div>
  );
}

/* ---------- settings ---------- */

// The calendar has no per-card config — its settings panel manages the
// shared feed subscription, so draft/onChange go unused.
function CalendarSettings(props: CardSettingsProps<CalendarConfig>) {
  void props;
  const queryClient = useQueryClient();
  const connection = useQuery({
    queryKey: ["calendar-connection"],
    queryFn: fetchCalendarConnection,
    staleTime: 60_000,
  });
  const [url, setUrl] = useState("");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["calendar-connection"] });
    queryClient.invalidateQueries({ queryKey: ["calendar"] });
  };
  const connect = useMutation({
    mutationFn: saveCalendarConnection,
    onSuccess: (result) => {
      if (result.ok) {
        setUrl("");
        invalidate();
      }
    },
  });
  const disconnect = useMutation({
    mutationFn: clearCalendarConnection,
    onSuccess: invalidate,
  });

  const status = connection.data;

  if (status?.source === "env") {
    return (
      <div className="rounded-xl border border-border bg-bg px-3.5 py-3 text-xs leading-[1.5] text-muted">
        Subscribed to <span className="text-fg">{status.host}</span> — managed
        by the server environment (CALENDAR_ICS_URL).
      </div>
    );
  }

  if (status?.configured) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-bg px-3.5 py-3">
        <div className="min-w-0 text-xs leading-[1.5] text-muted">
          Subscribed to <span className="text-fg">{status.host}</span>.
        </div>
        <button
          type="button"
          onClick={() => disconnect.mutate()}
          className="min-h-9 shrink-0 cursor-pointer rounded-lg border border-border px-3 text-[12px] font-[550] text-muted transition-colors hover:text-danger"
        >
          Disconnect
        </button>
      </div>
    );
  }

  const failure = connect.data?.ok === false ? connect.data.error : null;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-bg p-3.5">
      <p className="m-0 text-xs leading-[1.5] text-muted">
        Subscribe to an iCalendar feed (Google Calendar's secret address,
        Nextcloud, …). The URL is checked, then stored on the rackio server —
        private ICS links stay out of the board.
      </p>
      <Field label="Calendar URL">
        {(id) => (
          <TextInput
            id={id}
            value={url}
            placeholder="https://calendar.example.com/feed.ics"
            onChange={(event) => setUrl(event.target.value)}
          />
        )}
      </Field>
      {failure ? (
        <p className="m-0 text-xs text-danger">
          {failure === "not-ics"
            ? "That URL answered, but not with an iCalendar feed."
            : "Couldn't reach that URL — check the address."}
        </p>
      ) : connect.isError ? (
        <p className="m-0 text-xs text-danger">Connection check failed — try again.</p>
      ) : null}
      <button
        type="button"
        disabled={connect.isPending || !url.trim()}
        onClick={() => connect.mutate(url.trim())}
        className="min-h-10 cursor-pointer rounded-xl border border-transparent bg-fg px-4 text-[13px] font-[550] tracking-[0.02em] text-bg transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-40"
      >
        {connect.isPending ? "Checking feed…" : "Subscribe"}
      </button>
    </div>
  );
}

export const calendarCard: CardDefinition<CalendarConfig> = {
  type: "calendar",
  name: "Calendar",
  description: "Month view and upcoming events from an iCal subscription.",
  footprints: ["small", "big", "wide"],
  defaultFootprint: "big",
  defaultConfig: {},
  configSchema,
  Component: CalendarCard,
  Settings: CalendarSettings,
};
