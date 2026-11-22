import type {
  HearthAgent,
  HearthInboxItem,
  HearthOverview,
  HearthProject,
} from "@t3tools/contracts";

export interface HearthProjectGroup {
  readonly id: string;
  readonly project: HearthProject | null;
  readonly agents: ReadonlyArray<HearthAgent>;
  readonly inbox: ReadonlyArray<HearthInboxItem>;
}

const OPEN_STATUS = new Set(["launched", "working", "blocked"]);

export const isOpenAgent = (agent: HearthAgent) => OPEN_STATUS.has(agent.status);

/** Every project once, active work first, plus any id only a session or inbox item names. */
export function groupHearthOverview(overview: HearthOverview): ReadonlyArray<HearthProjectGroup> {
  const ids = new Set(overview.projects.map((project) => project.id));
  for (const agent of overview.agents) ids.add(agent.project);
  for (const item of overview.inbox) if (item.project !== null) ids.add(item.project);
  const groups = [...ids].map((id) => ({
    id,
    project: overview.projects.find((project) => project.id === id) ?? null,
    agents: overview.agents.filter((agent) => agent.project === id),
    inbox: overview.inbox.filter((item) => item.project === id),
  }));
  const rank = (group: HearthProjectGroup) =>
    group.inbox.length > 0
      ? 0
      : group.agents.some(isOpenAgent)
        ? 1
        : group.project?.status === "active"
          ? 2
          : 3;
  return groups.toSorted((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
}

/** The thread id in a `t3:<id>` session ref, or null for a session outside T3. */
export const hearthThreadId = (ref: string | null) =>
  ref?.startsWith("t3:") && ref.length > 3 ? ref.slice(3) : null;
