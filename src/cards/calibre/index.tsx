import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { ExternalLinkIcon } from "@/app/icons";
import { Field, TextInput } from "@/board/settings-fields";
import type { CalibreBook, CalibreShelf } from "@/lib/api";
import {
  calibreCoverUrl,
  clearCalibreConnection,
  fetchCalibreConnection,
  fetchCalibreShelf,
  saveCalibreConnection,
} from "@/lib/api";
import type {
  CardComponentProps,
  CardDefinition,
  CardSettingsProps,
} from "../registry";

const configSchema = z.object({
  source: z.enum(["new", "hot"]),
});

type CalibreConfig = z.infer<typeof configSchema>;

const SOURCE_COPY: Record<CalibreConfig["source"], { title: string; label: string }> = {
  new: { title: "Latest additions", label: "Newest" },
  hot: { title: "Popular now", label: "Most read" },
};

function useShelf(source: CalibreConfig["source"]) {
  return useQuery({
    queryKey: ["calibre", source],
    queryFn: () => fetchCalibreShelf(source),
    refetchInterval: 5 * 60_000,
    staleTime: 4 * 60_000,
  });
}

function bookLink(shelf: CalibreShelf, book: CalibreBook): string | undefined {
  return shelf.webUrl ? `${shelf.webUrl}/book/${book.id}` : undefined;
}

function Cover({
  book,
  link,
  className = "",
}: {
  book: CalibreBook;
  link?: string;
  className?: string;
}) {
  const image = (
    <img
      src={calibreCoverUrl(book.id)}
      alt=""
      loading="lazy"
      className="h-full w-full object-cover"
    />
  );
  const frame = `block aspect-2/3 w-full overflow-hidden rounded-lg bg-[color-mix(in_oklch,var(--fg)_8%,transparent)] shadow-[0_9px_18px_color-mix(in_oklch,var(--bg)_54%,transparent),0_0_0_1px_color-mix(in_oklch,var(--fg)_10%,transparent)] transition-transform duration-150 ${className}`;
  return link ? (
    <a
      href={link}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open ${book.title} in Calibre-Web`}
      className={`${frame} hover:-translate-y-0.5`}
    >
      {image}
    </a>
  ) : (
    <span className={frame}>{image}</span>
  );
}

function EmptyState({ shelf }: { shelf?: CalibreShelf }) {
  const [state, caption] = !shelf
    ? ["Opening the library…", ""]
    : !shelf.configured
      ? [
          "Not connected",
          "Open this card's settings (edit mode → gear) to connect Calibre-Web.",
        ]
      : shelf.error === "unauthorized"
        ? ["Sign-in failed", "Update the credentials in this card's settings."]
        : shelf.error === "unreachable"
          ? ["Library unreachable", "Calibre-Web didn't answer — is it up?"]
          : shelf.error === "not-opds"
            ? ["Wrong address", "That URL isn't a Calibre-Web catalog — reconnect in settings."]
            : ["No books yet", "Add books to the library to see them here."];
  return (
    <div className="flex h-full min-h-0 flex-col justify-end">
      <p className="m-0 text-[17px] leading-[1.2] tracking-[-0.02em]">{state}</p>
      {caption ? (
        <p className="m-0 mt-1.5 max-w-[32ch] text-xs leading-[1.45] text-muted">
          {caption}
        </p>
      ) : null}
    </div>
  );
}

function Header({
  title,
  webUrl,
  compact,
}: {
  title: string;
  webUrl?: string;
  compact: boolean;
}) {
  return (
    <header className="flex items-center justify-between gap-3.5">
      <div className="min-w-0">
        {!compact && (
          <p className="m-0 mb-[3px] font-mono text-[10px] font-[550] tracking-[0.08em] uppercase text-muted">
            Calibre · Library
          </p>
        )}
        <h2
          className={`m-0 truncate font-display font-semibold tracking-[-0.015em] ${
            compact ? "text-[15px]" : "text-[21px] leading-[1.1]"
          }`}
        >
          {title}
        </h2>
      </div>
      {webUrl ? (
        <a
          href={webUrl}
          target="_blank"
          rel="noreferrer"
          aria-label="Open full library in Calibre-Web"
          className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-xl border border-border bg-[color-mix(in_oklch,var(--surface)_86%,var(--fg)_4%)] text-fg transition-colors hover:bg-[color-mix(in_oklch,var(--surface)_76%,var(--fg)_10%)] [&_svg]:h-4 [&_svg]:w-4 [&_svg]:stroke-[1.7]"
        >
          <ExternalLinkIcon />
        </a>
      ) : null}
    </header>
  );
}

function Feature({
  shelf,
  label,
  coverClass,
  titleClass,
  showAuthor,
}: {
  shelf: CalibreShelf;
  label: string;
  coverClass: string;
  titleClass: string;
  showAuthor: boolean;
}) {
  const book = shelf.books?.[0];
  if (!book) return null;
  const link = bookLink(shelf, book);
  return (
    <div className="flex min-h-0 items-center gap-3.5 rounded-[14px] border border-border bg-[color-mix(in_oklch,var(--bg)_30%,var(--surface)_70%)] p-2.5">
      <div className={coverClass}>
        <Cover book={book} link={link} />
      </div>
      <div className="min-w-0">
        <p className="m-0 mb-1 text-[9px] font-semibold tracking-[0.08em] uppercase text-muted">
          {label}
        </p>
        <h3 className={`m-0 font-display font-semibold tracking-[-0.02em] ${titleClass}`}>
          {link ? (
            <a href={link} target="_blank" rel="noreferrer" className="text-fg no-underline hover:underline">
              {book.title}
            </a>
          ) : (
            book.title
          )}
        </h3>
        {showAuthor && book.author ? (
          <p className="m-0 mt-1 truncate text-xs text-muted">{book.author}</p>
        ) : null}
      </div>
    </div>
  );
}

function ShelfStrip({
  shelf,
  count,
  showTitles,
}: {
  shelf: CalibreShelf;
  count: number;
  showTitles: boolean;
}) {
  const books = shelf.books?.slice(1, 1 + count) ?? [];
  if (books.length === 0) return null;
  return (
    <div
      className="grid gap-2.5"
      style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
    >
      {books.map((book) => (
        <div key={book.id} className="min-w-0">
          <Cover book={book} link={bookLink(shelf, book)} />
          {showTitles ? (
            <p className="m-0 mt-1.5 truncate text-[11px] leading-[1.25] tracking-[0.01em] text-muted">
              {book.title}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function CalibreCard({ config, footprint }: CardComponentProps<CalibreConfig>) {
  const query = useShelf(config.source);
  const shelf = query.data;
  const copy = SOURCE_COPY[config.source];
  const hasBooks = Boolean(shelf?.books?.length);

  if (footprint === "small") {
    return (
      <div className="flex h-full flex-col gap-2.5 p-3.5">
        <Header title="Library" webUrl={shelf?.webUrl} compact />
        {hasBooks && shelf ? (
          <div className="flex min-h-0 flex-1 flex-col justify-end">
            <Feature
              shelf={shelf}
              label={copy.label}
              coverClass="w-[3.2rem] shrink-0"
              titleClass="text-[15px] leading-[1.15] line-clamp-2"
              showAuthor={false}
            />
          </div>
        ) : (
          <EmptyState shelf={shelf} />
        )}
      </div>
    );
  }

  if (footprint === "wide") {
    return (
      <div className="flex h-full flex-col gap-2.5 p-3.5">
        <Header title={copy.title} webUrl={shelf?.webUrl} compact />
        {hasBooks && shelf ? (
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.45fr)_minmax(118px,0.75fr)] gap-3">
            <Feature
              shelf={shelf}
              label={copy.label}
              coverClass="w-[3.2rem] shrink-0"
              titleClass="text-[15px] leading-[1.15] line-clamp-2"
              showAuthor
            />
            <div className="min-h-0 overflow-hidden border-l border-border pl-3">
              <p className="m-0 mb-1.5 text-[11px] font-semibold tracking-[-0.005em]">
                On the shelf
              </p>
              <ShelfStrip shelf={shelf} count={3} showTitles={false} />
            </div>
          </div>
        ) : (
          <EmptyState shelf={shelf} />
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 p-[18px]">
      <Header title={copy.title} webUrl={shelf?.webUrl} compact={false} />
      {hasBooks && shelf ? (
        <div className="flex min-h-0 flex-1 flex-col justify-between gap-4">
          <Feature
            shelf={shelf}
            label={copy.label}
            coverClass="w-[92px] shrink-0"
            titleClass="text-[24px] leading-[1.08]"
            showAuthor
          />
          <div>
            <div className="mb-2.5 flex items-center justify-between">
              <p className="m-0 text-[13px] font-semibold tracking-[-0.005em]">
                On the shelf
              </p>
              <span className="font-mono text-[10px] tracking-[0.04em] text-muted uppercase">
                {(shelf.books?.length ?? 1) - 1} books
              </span>
            </div>
            <ShelfStrip shelf={shelf} count={5} showTitles />
          </div>
        </div>
      ) : (
        <EmptyState shelf={shelf} />
      )}
    </div>
  );
}

function ConnectionForm() {
  const queryClient = useQueryClient();
  const connection = useQuery({
    queryKey: ["calibre-connection"],
    queryFn: fetchCalibreConnection,
    staleTime: 60_000,
  });
  const [baseUrl, setBaseUrl] = useState("");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["calibre-connection"] });
    queryClient.invalidateQueries({ queryKey: ["calibre"] });
  };

  const connect = useMutation({
    mutationFn: saveCalibreConnection,
    onSuccess: (result) => {
      if (result.ok) {
        setPassword("");
        invalidate();
      }
    },
  });
  const disconnect = useMutation({
    mutationFn: clearCalibreConnection,
    onSuccess: invalidate,
  });

  const status = connection.data;

  if (status?.source === "env") {
    return (
      <div className="rounded-xl border border-border bg-bg px-3.5 py-3 text-xs leading-[1.5] text-muted">
        Connected to <span className="text-fg">{status.baseUrl}</span> — managed
        by the server environment (CALIBRE_* variables).
      </div>
    );
  }

  if (status?.configured) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-bg px-3.5 py-3">
        <div className="min-w-0 text-xs leading-[1.5] text-muted">
          Connected to <span className="break-all text-fg">{status.baseUrl}</span>
          {status.user ? <> as {status.user}</> : null}.
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
  const submitting = connect.isPending;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-bg p-3.5">
      <p className="m-0 text-xs leading-[1.5] text-muted">
        Connect your Calibre-Web. Credentials are checked against the library,
        then stored on the rackio server — never in the board.
      </p>
      <Field label="Server URL">
        {(id) => (
          <TextInput
            id={id}
            value={baseUrl}
            placeholder="https://books.example.com"
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        )}
      </Field>
      <Field label="Username">
        {(id) => (
          <TextInput id={id} value={user} onChange={(e) => setUser(e.target.value)} />
        )}
      </Field>
      <Field label="Password">
        {(id) => (
          <TextInput
            id={id}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
      </Field>
      {failure ? (
        <p className="m-0 text-xs text-danger">
          {failure === "unauthorized"
            ? "Calibre-Web rejected those credentials."
            : failure === "not-opds"
              ? "That URL answered, but not with a Calibre-Web catalog — check the address."
              : "Couldn't reach that server — check the URL."}
        </p>
      ) : connect.isError ? (
        <p className="m-0 text-xs text-danger">Connection check failed — try again.</p>
      ) : connect.data?.ok ? (
        <p className="m-0 text-xs text-success">
          Connected · {connect.data.books} books found.
        </p>
      ) : null}
      <button
        type="button"
        disabled={submitting || !baseUrl.trim() || !user.trim()}
        onClick={() =>
          connect.mutate({ baseUrl: baseUrl.trim(), user: user.trim(), password })
        }
        className="min-h-10 cursor-pointer rounded-xl border border-transparent bg-fg px-4 text-[13px] font-[550] tracking-[0.02em] text-bg transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-40"
      >
        {submitting ? "Connecting…" : "Connect"}
      </button>
    </div>
  );
}

function CalibreSettings({ draft, onChange }: CardSettingsProps<CalibreConfig>) {
  return (
    <div className="flex flex-col gap-4">
      <ConnectionForm />
      <div>
        <p className="m-0 mb-1.5 text-[11px] font-semibold tracking-[0.08em] uppercase text-muted">
          Featured shelf
        </p>
        <div
          className="flex gap-[3px] rounded-xl border border-border bg-bg p-[3px]"
          role="group"
          aria-label="Featured shelf source"
        >
          {(["new", "hot"] as const).map((source) => (
            <button
              key={source}
              type="button"
              aria-pressed={draft.source === source}
              onClick={() => onChange({ source })}
              className={`min-h-10 flex-1 cursor-pointer rounded-[9px] text-[13px] font-[550] tracking-[0.02em] transition-colors ${
                draft.source === source
                  ? "bg-fg text-bg"
                  : "text-muted hover:text-fg"
              }`}
            >
              {source === "new" ? "Latest additions" : "Popular now"}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export const calibreCard: CardDefinition<CalibreConfig> = {
  type: "calibre",
  name: "Calibre library",
  description: "Fresh reads from Calibre-Web, with deep links into the shelf.",
  footprints: ["small", "big", "wide"],
  defaultFootprint: "wide",
  defaultConfig: { source: "new" },
  configSchema,
  Component: CalibreCard,
  Settings: CalibreSettings,
};
