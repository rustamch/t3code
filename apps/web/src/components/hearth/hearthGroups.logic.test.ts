import type { HearthAgent, HearthOverview } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { groupHearthOverview, hearthThreadId, quickLaunchTitle } from "./hearthGroups";

const project = (id: string, status = "active") => ({
  id,
  title: id,
  status,
  repos: [],
  paths: [],
  now: null,
  path: `projects/${id}.md`,
});
const agent = (projectId: string, status: HearthAgent["status"]): HearthAgent => ({
  ref: `t3:${projectId}`,
  link: null,
  project: projectId,
  title: "t",
  purpose: "p",
  status,
  branch: null,
  launched_at: "2026-11-22T00:00:00Z",
  path: `agents/${projectId}.md`,
});

describe("groupHearthOverview", () => {
  it("puts what waits on the owner first and keeps sessions of unlisted projects", () => {
    const overview: HearthOverview = {
      schema: "hearth.overview/1",
      owner: "alex",
      coordinator: null,
      projects: [
        project("idle"),
        project("paused", "paused"),
        project("random"),
        project("waiting"),
      ],
      agents: [agent("running", "working")],
      inbox: [
        {
          kind: "action",
          title: "pick",
          detail: null,
          project: "waiting",
          path: "projects/waiting.md",
          link: null,
          ref: null,
          at: null,
        },
      ],
    };
    const groups = groupHearthOverview(overview);
    expect(groups.map((group) => group.id)).toEqual([
      "random",
      "waiting",
      "running",
      "idle",
      "paused",
    ]);
    expect(groups[2]?.project).toBeNull();
  });

  it("titles a quick launch from its first line, within the limit", () => {
    expect(quickLaunchTitle("  rename the file\nand more")).toBe("rename the file");
    expect(quickLaunchTitle("x".repeat(80))).toBe(`${"x".repeat(59)}…`);
  });

  it("reads only T3 session refs", () => {
    expect(hearthThreadId("t3:abc")).toBe("abc");
    expect(hearthThreadId("codex:abc")).toBeNull();
    expect(hearthThreadId(null)).toBeNull();
  });
});
