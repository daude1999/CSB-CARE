"use client";

import { useEffect } from "react";

/** After an observation is saved, forgets the unsaved-form copy kept in this browser tab. */
export function ClearDraft({ serviceUserId }: { serviceUserId: string }) {
  useEffect(() => {
    try {
      sessionStorage.removeItem(`bm-draft:${serviceUserId}`);
    } catch {
      /* storage unavailable */
    }
  }, [serviceUserId]);
  return null;
}
