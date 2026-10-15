"use client";

import { useSyncExternalStore } from "react";

// State antarmuka sementara (tidak disimpan): dialog feedback yang terbuka dan hold yang ditutup pengguna.
interface UiState {
  feedbackFor: string | null; // id event trip
  dismissedHolds: string[]; // `${jalurId}:${startedAt}`
}

let state: UiState = { feedbackFor: null, dismissedHolds: [] };
const listeners = new Set<() => void>();
const set = (next: Partial<UiState>) => {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
};

export const ui = {
  openFeedback: (eventId: string) => set({ feedbackFor: eventId }),
  closeFeedback: () => set({ feedbackFor: null }),
  dismissHold: (key: string) => set({ dismissedHolds: [...state.dismissedHolds, key] }),
  reopenHold: (key: string) => set({ dismissedHolds: state.dismissedHolds.filter((k) => k !== key) }),
};

export function useUi(): UiState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => state,
  );
}
