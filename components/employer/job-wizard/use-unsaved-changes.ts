"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const UNSAVED_CHANGES_PROMPT =
  "Du hast ungespeicherte Änderungen. Möchtest du sie verwerfen und die Seite verlassen?";

export function useUnsavedChanges() {
  const [dirty, setDirtyState] = useState(false);
  const dirtyRef = useRef(false);

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    setDirtyState(true);
  }, []);

  const clearDirty = useCallback(() => {
    dirtyRef.current = false;
    setDirtyState(false);
  }, []);

  const confirmDiscard = useCallback(() => {
    if (!dirtyRef.current) return true;
    if (!window.confirm(UNSAVED_CHANGES_PROMPT)) return false;
    clearDirty();
    return true;
  }, [clearDirty]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = true;
    };
    const handleDocumentClick = (event: MouseEvent) => {
      if (
        !dirtyRef.current ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const element = event.target instanceof Element ? event.target : null;
      const anchor = element?.closest<HTMLAnchorElement>("a[href]");
      if (
        anchor === null ||
        anchor === undefined ||
        anchor.hasAttribute("download") ||
        (anchor.target !== "" && anchor.target !== "_self")
      ) {
        return;
      }
      const current = new URL(window.location.href);
      const destination = new URL(anchor.href, current);
      if (
        destination.origin === current.origin &&
        destination.pathname === current.pathname &&
        destination.search === current.search
      ) {
        return;
      }
      if (!confirmDiscard()) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleDocumentClick, true);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleDocumentClick, true);
    };
  }, [confirmDiscard]);

  return { clearDirty, dirty, markDirty };
}
