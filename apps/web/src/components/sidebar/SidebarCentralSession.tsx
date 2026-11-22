import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { useNavigate } from "@tanstack/react-router";
import { FlameIcon } from "lucide-react";
import { useGT } from "gt-react";
import { useEffect } from "react";

import { cn } from "~/lib/utils";
import {
  updateClientSettings,
  useClientSettings,
  useClientSettingsHydrated,
} from "../../hooks/useSettings";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useUiStateStore } from "../../uiStateStore";
import { resolveSidebarFolderDot, resolveThreadLastVisitedAt } from "../Sidebar.logic";

const CENTRAL_THREAD_PREFIX = "hearth-central-";

export const isCentralThread = (thread: { readonly id: string }) =>
  thread.id.startsWith(CENTRAL_THREAD_PREFIX);

const DOT_CLASS_NAME = {
  attention: "bg-warning",
  failed: "bg-error",
  unread: "bg-success",
  working: "bg-info animate-pulse",
} as const;

/** Keeper, the one thread above every project, always first in the sidebar. */
export function SidebarCentralSession(props: {
  readonly threads: readonly EnvironmentThreadShell[];
  readonly routeThreadKey: string | null;
  readonly onNavigate?: () => void;
}) {
  const gt = useGT();
  const navigate = useNavigate();
  const defaultsApplied = useClientSettings((settings) => settings.hearthSidebarDefaultsApplied);
  const settingsHydrated = useClientSettingsHydrated();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a one-time write to saved settings, which must wait for hydration.
  useEffect(() => {
    // Before hydration the default is showing, and a write would overwrite saved settings.
    if (!settingsHydrated || defaultsApplied !== false) return;
    void updateClientSettings({ boringSidebarEnabled: true, hearthSidebarDefaultsApplied: true });
  }, [defaultsApplied, settingsHydrated]);
  const environmentId = usePrimaryEnvironmentId();
  const openCentral = useAtomCommand(serverEnvironment.hearthOpenCentral, { reportFailure: false });
  const lastVisitedById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const thread =
    props.threads.find(
      (item) =>
        item.environmentId === environmentId && isCentralThread(item) && item.archivedAt === null,
    ) ?? null;
  const threadKey =
    thread === null ? null : scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
  const isActive = threadKey !== null && threadKey === props.routeThreadKey;
  const dot =
    thread === null || threadKey === null || isActive
      ? null
      : resolveSidebarFolderDot([
          {
            ...thread,
            lastVisitedAt: resolveThreadLastVisitedAt(
              thread.lastVisitedAt,
              lastVisitedById[threadKey],
            ),
          },
        ]);

  const open = async () => {
    if (environmentId === null) return;
    props.onNavigate?.();
    if (thread !== null) {
      await navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId: thread.id },
      });
      return;
    }
    const opened = await openCentral({ environmentId, input: {} });
    if (opened._tag === "Success") {
      await navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId: opened.value.threadId },
      });
      return;
    }
    // The Hearth page says why it could not connect.
    await navigate({ to: "/hearth" });
  };

  return (
    <button
      type="button"
      data-testid="sidebar-central-session"
      aria-current={isActive ? "page" : undefined}
      onClick={() => void open()}
      className={cn(
        "mb-2 flex w-full cursor-pointer items-center gap-2.5 rounded-lg border px-2 py-1.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        isActive
          ? "border-primary/70 bg-primary/20"
          : "border-primary/30 bg-primary/10 hover:border-primary/50 hover:bg-primary/15",
      )}
    >
      <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <FlameIcon className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1 truncate font-semibold text-sidebar-foreground text-sm">
        {gt("Keeper")}
      </span>
      {dot ? (
        <span className={cn("size-2 shrink-0 rounded-full", DOT_CLASS_NAME[dot])} aria-hidden />
      ) : null}
    </button>
  );
}
