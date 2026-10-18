import { api } from "../api";
import type { Role } from "../auth/session";

// Panggilan backend khusus admin (apps/api/src/admin/*). Semua butuh sesi admin.

export interface AdminUser {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  active: boolean;
  created_at: string;
  last_login_at: string | null;
}

export interface DeviceThresholds {
  volt_min: number;
  volt_max: number;
  current_max: number;
  power_max: number;
  temp_max: number;
  freq_min: number;
  freq_max: number;
  pf_min: number;
  energy_hourly_max_wh: number;
}

export type DeviceMode = "auto" | "semi_auto";

export interface AdminDevice {
  id: string;
  name: string;
  location: string | null;
  thresholds: DeviceThresholds;
  mode: DeviceMode;
  last_seen: string | null;
  created_at: string;
}

export interface AuditCommand {
  id: number;
  ts: string;
  device_id: string;
  action: "on" | "off";
  source: "user" | "recommendation" | "auto" | "local";
  status: "pending" | "sent" | "acked" | "failed";
  actor: string;
  actor_role: "operator" | "admin" | "system";
  reason: string | null;
  mode: DeviceMode | null;
}

export interface AuditModeChange {
  id: number;
  ts: string;
  device_id: string;
  mode: DeviceMode;
  prev_mode: DeviceMode | null;
  actor: string;
  actor_role: "operator" | "admin" | "system";
}

const enc = encodeURIComponent;

export const adminApi = {
  listUsers: () => api<AdminUser[]>("GET", "/api/admin/users"),
  createUser: (b: { username: string; display_name: string; role: Role; password: string }) =>
    api<{ user: AdminUser; pin: string | null }>("POST", "/api/admin/users", b),
  updateUser: (id: string, b: { display_name?: string; active?: boolean }) =>
    api<AdminUser>("PATCH", `/api/admin/users/${enc(id)}`, b),
  resetPassword: (id: string, password: string) => api("POST", `/api/admin/users/${enc(id)}/password`, { password }),
  resetPin: (id: string) => api<{ pin: string }>("POST", `/api/admin/users/${enc(id)}/pin`),
  deleteUser: (id: string) => api("DELETE", `/api/admin/users/${enc(id)}`),

  listDevices: () => api<AdminDevice[]>("GET", "/api/admin/devices"),
  createDevice: (b: { id: string; name: string; location: string }) => api<AdminDevice>("POST", "/api/admin/devices", b),
  updateDevice: (id: string, b: { name?: string; location?: string; thresholds?: DeviceThresholds }) =>
    api<AdminDevice>("PATCH", `/api/admin/devices/${enc(id)}`, b),
  setMode: (id: string, mode: DeviceMode) => api("POST", `/api/admin/devices/${enc(id)}/mode`, { mode }),

  audit: (limit = 100) =>
    api<{ commands: AuditCommand[]; mode_changes: AuditModeChange[] }>("GET", `/api/admin/audit?limit=${limit}`),
};
