"use client";

import { useRouter } from "next/navigation";
import { Menu, type MenuItem } from "@/components/ui/Menu";
import { logout } from "@/lib/auth/actions";
import { initials, ROLE_LABEL, useSession } from "@/lib/auth/session";

// Avatar pengguna yang login: nama + peran, dan tombol keluar.
export function UserMenu({ extraItems = [] }: { extraItems?: MenuItem[] }) {
  const session = useSession();
  const router = useRouter();
  if (!session) return null;
  const { displayName, role } = session.user;

  return (
    <div className="flex items-center gap-2.5">
      <div className="hidden text-right sm:block">
        <p className="text-[13px] leading-tight font-semibold text-fg">{displayName}</p>
        <p className="text-xs leading-tight text-fg-3">{ROLE_LABEL[role]}</p>
      </div>
      <Menu
        label={`Menu akun ${displayName}`}
        trigger={
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-soft text-[13px] font-semibold text-primary">
            {initials(displayName)}
          </span>
        }
        items={[
          ...extraItems,
          {
            label: "Keluar",
            danger: true,
            onSelect: () => {
              void logout();
              router.replace("/login");
            },
          },
        ]}
      />
    </div>
  );
}
