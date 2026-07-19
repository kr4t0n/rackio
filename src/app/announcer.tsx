import { useEffect, useState } from "react";

/**
 * Screen-reader announcements for board actions (add, remove, move, …).
 * `announce()` can be called from anywhere; <LiveAnnouncer /> renders the
 * aria-live region once at the app root.
 */

let emit: ((message: string) => void) | null = null;

export function announce(message: string): void {
  emit?.(message);
}

export function LiveAnnouncer() {
  const [message, setMessage] = useState("");

  useEffect(() => {
    emit = setMessage;
    return () => {
      emit = null;
    };
  }, []);

  return (
    <p aria-live="polite" className="sr-only">
      {message}
    </p>
  );
}
