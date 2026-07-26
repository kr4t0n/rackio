import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Field, TextInput } from "@/board/settings-fields";
import type { DockerHubState, DockerImage } from "@/lib/api";
import {
  clearDockerHubConnection,
  fetchDockerHubConnection,
  fetchDockerHubState,
  saveDockerHubConnection,
} from "@/lib/api";
import type {
  CardComponentProps,
  CardDefinition,
  CardSettingsProps,
} from "../registry";

const configSchema = z.object({});
type DockerHubConfig = z.infer<typeof configSchema>;

function useDockerHub() {
  return useQuery({
    queryKey: ["dockerhub"],
    queryFn: fetchDockerHubState,
    refetchInterval: 5 * 60_000,
    staleTime: 4 * 60_000,
  });
}

function formatSize(bytes?: number): string {
  if (!bytes) return "—";
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (mb < 100) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${Math.round(mb)} MB`;
}

/** "sha256:9c3f…2a17" — enough to eyeball against a local image. */
function shortDigest(digest?: string): string {
  if (!digest) return "—";
  const [algorithm, hex] = digest.includes(":")
    ? digest.split(":")
    : ["sha256", digest];
  return hex && hex.length > 12
    ? `${algorithm}:${hex.slice(0, 4)}…${hex.slice(-4)}`
    : digest;
}

function formatAge(iso?: string): string {
  if (!iso) return "—";
  const pushed = Date.parse(iso);
  if (Number.isNaN(pushed)) return "—";
  const minutes = Math.round((Date.now() - pushed) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.round(days / 30);
  return months < 12
    ? `${months} month${months === 1 ? "" : "s"} ago`
    : `${Math.round(months / 12)}y ago`;
}

function CubeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-[17px] w-[17px] fill-none stroke-current stroke-[1.7] [stroke-linecap:round] [stroke-linejoin:round]"
    >
      <path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5v-7Z" />
      <path d="m4.5 8.7 7.5 4.2 7.5-4.2M12 13v7M8 6.2l8 4.5" />
    </svg>
  );
}

/** One row: image name on the left, the tag worth pulling on the right. */
function ImageRow({
  image,
  size,
  onOpen,
}: {
  image: DockerImage;
  size: "small" | "wide" | "big";
  onOpen: (image: DockerImage) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(image)}
      className={`grid min-h-0 min-w-0 cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 overflow-hidden border border-border bg-[color-mix(in_oklch,var(--bg)_20%,var(--surface)_80%)] text-left text-fg transition-colors hover:border-[color-mix(in_oklch,var(--accent)_40%,var(--border))] hover:bg-[color-mix(in_oklch,var(--surface)_88%,var(--fg)_3%)] ${
        size === "wide" ? "rounded-[10px] px-[11px] py-[7px]" : "rounded-[11px] px-3 py-2.5"
      }`}
    >
      <span
        className={`min-w-0 truncate font-[550] ${
          size === "wide" ? "text-[10px]" : "text-[12px]"
        }`}
      >
        {image.name}
      </span>
      <span className="grid min-w-0 justify-items-end gap-[3px]">
        <span className="font-mono text-[7px] leading-none font-[550] tracking-[0.07em] text-muted uppercase">
          Latest tag
        </span>
        <span
          className={`min-w-0 truncate font-mono leading-none font-semibold ${
            size === "small" ? "text-[12px]" : size === "wide" ? "text-[9px]" : "text-[11px]"
          }`}
        >
          {image.tag}
        </span>
      </span>
    </button>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-[34px] items-center justify-between gap-3 border-b border-border text-[10px]">
      <span className="text-muted">{label}</span>
      <strong className="max-w-[64%] truncate font-mono text-[10px] leading-none font-semibold tabular-nums">
        {value}
      </strong>
    </div>
  );
}

/**
 * Image detail sheet. A native <dialog> rather than the board's flip overlay:
 * it lives in the top layer, so the card's grid transform and overflow can't
 * clip it, and Esc / backdrop dismissal come for free.
 */
function ImageDetail({
  image,
  onClose,
}: {
  image: DockerImage;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const commandRef = useRef<HTMLElement>(null);
  const [copyLabel, setCopyLabel] = useState("Copy");

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  const copy = async () => {
    // navigator.clipboard is secure-context only, and rackio is usually
    // reached over plain http on the tailnet — select the text instead so
    // the command is still one keystroke away.
    try {
      await navigator.clipboard.writeText(image.pullCommand);
      setCopyLabel("Copied");
      return;
    } catch {
      /* falls through to selection */
    }
    const node = commandRef.current;
    const selection = window.getSelection();
    if (node && selection) {
      const range = document.createRange();
      range.selectNodeContents(node);
      selection.removeAllRanges();
      selection.addRange(range);
      setCopyLabel("Selected");
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onClose={() => {
        // close() fires its event asynchronously, so StrictMode's
        // mount/unmount/mount has already re-opened the dialog by the time the
        // teardown's event lands — reporting that as a dismissal would close
        // the sheet the instant it opened. Only a real dismissal (Esc,
        // backdrop, the close button) leaves the dialog actually closed.
        if (!dialogRef.current?.open) onClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
      aria-label={`${image.name} image details`}
      className="m-auto w-[min(376px,calc(100%-14px))] max-w-none overflow-auto rounded-[18px] border border-border bg-surface p-0 text-fg shadow-[0_24px_70px_color-mix(in_oklch,var(--bg)_75%,transparent)] backdrop:bg-[color-mix(in_oklch,var(--bg)_75%,transparent)] backdrop:backdrop-blur-[5px]"
    >
      <div className="p-[17px]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="m-0 mb-px truncate font-mono text-[8px] leading-[1.35] font-[550] tracking-[0.08em] text-muted uppercase">
              Image details · {image.isPrivate ? "Private" : "Public"}
            </p>
            <h2 className="m-0 font-display text-[21px] leading-[1.08] font-semibold tracking-[-0.02em] break-all">
              {image.name}:{image.tag}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close image details"
            className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-xl border border-border bg-[color-mix(in_oklch,var(--surface)_84%,var(--fg)_4%)] text-lg leading-none transition-colors hover:bg-[color-mix(in_oklch,var(--surface)_74%,var(--fg)_10%)]"
          >
            ×
          </button>
        </div>
        <p className="m-0 mt-[9px] text-[11px] leading-[1.5] text-muted">
          {image.description ?? "No description on Docker Hub."}
        </p>

        <div className="mt-3 border-t border-border">
          <DetailRow label="Visibility" value={image.isPrivate ? "Private" : "Public"} />
          <DetailRow label="Digest" value={shortDigest(image.digest)} />
          <DetailRow label="Size" value={formatSize(image.sizeBytes)} />
          <DetailRow
            label="Architecture"
            value={image.architectures.join(" · ") || "—"}
          />
          <DetailRow label="Updated" value={formatAge(image.updatedAt)} />
        </div>

        <div className="mt-3.5 rounded-[11px] border border-border bg-[color-mix(in_oklch,var(--bg)_28%,var(--surface)_72%)] p-2.5">
          <div className="flex items-center justify-between gap-2.5">
            <span className="font-mono text-[7px] leading-none font-[550] tracking-[0.07em] text-muted uppercase">
              Pull command
            </span>
            <button
              type="button"
              onClick={copy}
              className="min-h-11 cursor-pointer rounded-[10px] border border-border bg-[color-mix(in_oklch,var(--surface)_84%,var(--fg)_4%)] px-3 text-[9px] font-semibold tracking-[0.02em] transition-colors hover:bg-[color-mix(in_oklch,var(--surface)_74%,var(--fg)_10%)]"
            >
              {copyLabel}
            </button>
          </div>
          <code
            ref={commandRef}
            className="mt-[9px] block overflow-auto font-mono text-[9px] leading-[1.45] whitespace-nowrap text-fg"
          >
            {image.pullCommand}
          </code>
        </div>

        <a
          href={image.webUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 block text-[10px] text-muted no-underline transition-colors hover:text-fg"
        >
          Open on Docker Hub →
        </a>
      </div>
    </dialog>
  );
}

function EmptyState({ state }: { state?: DockerHubState }) {
  const [title, caption] = !state
    ? ["Reaching Docker Hub…", ""]
    : !state.configured
      ? [
          "Not connected",
          "Open this card's settings (edit mode → gear) to point it at a Docker Hub namespace.",
        ]
      : state.error === "unauthorized"
        ? ["Access denied", "Docker Hub rejected those credentials."]
        : state.error === "not-found"
          ? ["No such namespace", "Docker Hub doesn't know that user or organisation."]
          : state.error === "unreachable"
            ? ["Docker Hub unreachable", "The registry didn't answer — is this host online?"]
            : ["No images yet", "That namespace has no repositories with tags."];
  return (
    <div className="flex h-full min-h-0 flex-col justify-end">
      <p className="m-0 text-[17px] leading-[1.2] tracking-[-0.02em]">{title}</p>
      {caption ? (
        <p className="m-0 mt-1.5 max-w-[32ch] text-xs leading-[1.45] text-muted">
          {caption}
        </p>
      ) : null}
    </div>
  );
}

function DockerHubCard({ footprint }: CardComponentProps<DockerHubConfig>) {
  const query = useDockerHub();
  const [detail, setDetail] = useState<DockerImage | null>(null);
  const state = query.data;
  const images = state?.images ?? [];
  const live = Boolean(state?.configured && !state.error && images.length > 0);
  const compact = footprint !== "big";
  // Each footprint keeps whole rows: two, three, four.
  const rows = footprint === "small" ? 2 : footprint === "wide" ? 3 : 4;

  const header = (
    <header className="flex min-w-0 items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-[9px]">
        <span
          className={`grid shrink-0 place-items-center rounded-[9px] border border-border bg-[color-mix(in_oklch,var(--surface)_78%,var(--fg)_5%)] ${
            compact ? "h-[25px] w-[25px]" : "h-[29px] w-[29px]"
          }`}
        >
          <CubeIcon />
        </span>
        <div className="min-w-0">
          {footprint === "big" && (
            <p className="m-0 mb-px max-w-[23ch] truncate font-mono text-[8px] leading-[1.35] font-[550] tracking-[0.08em] text-muted uppercase">
              {state?.namespace ?? "Registry"} ·{" "}
              {state?.authenticated ? "Signed in" : "Public"}
            </p>
          )}
          <h1
            className={`m-0 truncate font-display font-semibold tracking-[-0.015em] ${
              footprint === "big"
                ? "text-[20px] leading-[1.05]"
                : footprint === "wide"
                  ? "text-[17px]"
                  : "text-[16px]"
            }`}
          >
            {state?.label ?? "Docker Hub"}
          </h1>
        </div>
      </div>
      {footprint !== "small" && live && (
        <span className="flex min-w-0 items-center gap-1.5 font-mono text-[8px] leading-none font-[550] tracking-[0.05em] text-muted uppercase">
          <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-accent shadow-[0_0_0_3px_color-mix(in_oklch,var(--accent)_14%,transparent)]" />
          <span className="truncate">{state?.namespace}</span>
        </span>
      )}
    </header>
  );

  if (!live) {
    return (
      <div className="flex h-full flex-col gap-2 p-3">
        {header}
        <EmptyState state={state} />
      </div>
    );
  }

  return (
    <div
      className={`grid h-full grid-rows-[auto_minmax(0,1fr)] ${
        footprint === "big"
          ? "gap-2.5 p-3.5"
          : footprint === "wide"
            ? "gap-2 px-[13px] py-[11px]"
            : "gap-2 p-[11px]"
      }`}
    >
      {header}
      <section
        aria-label="Docker Hub images"
        className={`grid min-h-0 min-w-0 grid-cols-1 ${
          footprint === "wide" ? "gap-[5px]" : "gap-1.5"
        }`}
        style={{ gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
      >
        {images.slice(0, rows).map((image) => (
          <ImageRow
            key={image.name}
            image={image}
            size={footprint}
            onOpen={setDetail}
          />
        ))}
      </section>
      {detail && <ImageDetail image={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function DockerHubSettings(props: CardSettingsProps<DockerHubConfig>) {
  void props; // the connection is shared server state, not per-card config
  const queryClient = useQueryClient();
  const connection = useQuery({
    queryKey: ["dockerhub-connection"],
    queryFn: fetchDockerHubConnection,
    staleTime: 60_000,
  });
  const [namespace, setNamespace] = useState("");
  const [username, setUsername] = useState("");
  const [token, setToken] = useState("");
  const [label, setLabel] = useState("");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["dockerhub-connection"] });
    queryClient.invalidateQueries({ queryKey: ["dockerhub"] });
  };
  const connect = useMutation({
    mutationFn: saveDockerHubConnection,
    onSuccess: (result) => {
      if (result.ok) {
        setToken("");
        invalidate();
      }
    },
  });
  const disconnect = useMutation({
    mutationFn: clearDockerHubConnection,
    onSuccess: invalidate,
  });

  const status = connection.data;

  if (status?.configured) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-bg px-3.5 py-3">
        <div className="min-w-0 text-xs leading-[1.5] text-muted">
          Reading <span className="break-all text-fg">{status.namespace}</span>
          {status.authenticated ? <> as {status.username}</> : <> anonymously</>}.
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
        Point the card at a Docker Hub user or organisation. Public images need
        no credentials; add an access token to see private ones. The token is
        checked, then stored on the rackio server — never in the board.
      </p>
      <Field label="Namespace" hint="Your Docker Hub user or organisation, e.g. kr4t0n.">
        {(id) => (
          <TextInput
            id={id}
            value={namespace}
            placeholder="kr4t0n"
            onChange={(event) => setNamespace(event.target.value)}
          />
        )}
      </Field>
      <Field label="Username" hint="Optional — only needed for private repositories.">
        {(id) => (
          <TextInput
            id={id}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        )}
      </Field>
      <Field
        label="Access token"
        hint="Docker Hub → Account settings → Personal access tokens (read-only is enough)."
      >
        {(id) => (
          <TextInput
            id={id}
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
        )}
      </Field>
      <Field label="Card label" hint="Optional — shown instead of “Docker Hub”.">
        {(id) => (
          <TextInput
            id={id}
            value={label}
            maxLength={40}
            placeholder="Docker Hub"
            onChange={(event) => setLabel(event.target.value)}
          />
        )}
      </Field>
      {failure ? (
        <p className="m-0 text-xs text-danger">
          {failure === "unauthorized"
            ? "Docker Hub rejected that username and token."
            : failure === "not-found"
              ? "Docker Hub has no such user or organisation — check the spelling."
              : failure === "incomplete-credentials"
                ? "Give both a username and a token, or neither for public images."
                : "Couldn't reach Docker Hub — is this host online?"}
        </p>
      ) : connect.isError ? (
        <p className="m-0 text-xs text-danger">Connection check failed — try again.</p>
      ) : null}
      <button
        type="button"
        disabled={connect.isPending || !namespace.trim()}
        onClick={() =>
          connect.mutate({
            namespace: namespace.trim(),
            ...(username.trim() ? { username: username.trim() } : {}),
            ...(token.trim() ? { token: token.trim() } : {}),
            ...(label.trim() ? { label: label.trim() } : {}),
          })
        }
        className="min-h-10 cursor-pointer rounded-xl border border-transparent bg-fg px-4 text-[13px] font-[550] tracking-[0.02em] text-bg transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-40"
      >
        {connect.isPending ? "Connecting…" : "Connect"}
      </button>
    </div>
  );
}

export const dockerHubCard: CardDefinition<DockerHubConfig> = {
  type: "dockerhub",
  name: "Docker Hub",
  description: "Images in a Docker Hub namespace and the tag to pull.",
  footprints: ["small", "big", "wide"],
  defaultFootprint: "big",
  defaultConfig: {},
  configSchema,
  Component: DockerHubCard,
  Settings: DockerHubSettings,
};
