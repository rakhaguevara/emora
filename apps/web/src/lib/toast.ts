"use client";

import { useSyncExternalStore } from "react";

export interface ToastItem {
  id: number;
  message: string;
  tone: "info" | "success" | "error";
  action?: { label: string; onClick: () => void };
}

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(message: string, tone: ToastItem["tone"] = "info", action?: ToastItem["action"]) {
  const id = nextId++;
  items = [...items, { id, message, tone, action }];
  emit();
  setTimeout(() => dismissToast(id), action ? 15000 : 4500);
}

export function dismissToast(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

export function useToasts(): ToastItem[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => items,
    () => items,
  );
}
