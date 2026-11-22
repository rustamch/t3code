import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, HearthOverview } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { FlameIcon, MessageSquareIcon, PlusIcon } from "lucide-react";
import { T, useGT } from "gt-react";
import { useState, type FormEvent } from "react";

import { usePrimaryEnvironmentId } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { Textarea } from "../ui/textarea";
import {
  groupHearthOverview,
  hearthThreadId,
  isOpenAgent,
  type HearthProjectGroup,
} from "./hearthGroups";

function failureMessage(result: unknown, fallback: string) {
  const failure = result as {
    readonly cause?: {
      readonly reasons?: ReadonlyArray<{ readonly error?: { readonly message?: unknown } }>;
    };
  };
  const message = failure.cause?.reasons?.[0]?.error?.message;
  return typeof message === "string" ? message : fallback;
}

function HearthProjectCard({
  group,
  environmentId,
  onOpen,
}: {
  group: HearthProjectGroup;
  environmentId: EnvironmentId;
  onOpen: (environmentId: EnvironmentId, threadId: string) => void;
}) {
  const gt = useGT();
  const [starting, setStarting] = useState(false);
  const [title, setTitle] = useState("");
  const [task, setTask] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const launch = useAtomCommand(serverEnvironment.hearthLaunch, { reportFailure: false });
  const open = group.agents.filter(isOpenAgent);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (title.trim() === "" || task.trim() === "" || busy) return;
    setBusy(true);
    setError(null);
    const result = await launch({
      environmentId,
      input: { project: group.id, title: title.trim(), task: task.trim() },
    });
    setBusy(false);
    if (result._tag === "Success") {
      onOpen(environmentId, result.value.threadId);
      return;
    }
    setError(failureMessage(result, gt("Could not start the session.")));
  };

  return (
    <section
      className="rounded-lg border border-border p-4"
      aria-label={group.project?.title ?? group.id}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-medium">{group.project?.title ?? group.id}</h3>
          <p className="truncate text-muted-foreground text-xs">
            {group.project === null
              ? gt("No project note")
              : group.project.paths.length === 0
                ? gt("No repository")
                : group.project.paths.join(", ")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {group.project?.status ? <Badge variant="outline">{group.project.status}</Badge> : null}
          <Button size="xs" variant="outline" onClick={() => setStarting((value) => !value)}>
            <PlusIcon />
            <T>Start work</T>
          </Button>
        </div>
      </div>
      {group.project?.now ? (
        <p className="mt-3 line-clamp-3 whitespace-pre-line text-muted-foreground text-sm">
          {group.project.now}
        </p>
      ) : null}
      {open.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {open.map((agent) => {
            const threadId = hearthThreadId(agent.ref);
            return (
              <li key={agent.ref} className="flex items-center justify-between gap-2 text-sm">
                {threadId === null ? (
                  <span className="truncate">{agent.title}</span>
                ) : (
                  <button
                    type="button"
                    className="truncate text-left hover:underline"
                    onClick={() => onOpen(environmentId, threadId)}
                  >
                    {agent.title}
                  </button>
                )}
                <Badge variant={agent.status === "blocked" ? "warning" : "secondary"}>
                  {agent.status}
                </Badge>
              </li>
            );
          })}
        </ul>
      ) : null}
      {starting ? (
        <form className="mt-3 space-y-2" onSubmit={(event) => void submit(event)}>
          <Input
            aria-label={gt("Session title")}
            placeholder={gt("Session title")}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <Textarea
            aria-label={gt("Task")}
            placeholder={gt("What should this session do?")}
            value={task}
            onChange={(event) => setTask(event.target.value)}
          />
          {error ? <p className="text-destructive-foreground text-xs">{error}</p> : null}
          <Button
            size="sm"
            type="submit"
            disabled={busy || title.trim() === "" || task.trim() === ""}
          >
            {busy ? gt("Starting…") : gt("Start session")}
          </Button>
        </form>
      ) : null}
    </section>
  );
}

function HearthInbox({
  overview,
  environmentId,
  onOpen,
}: {
  overview: HearthOverview;
  environmentId: EnvironmentId;
  onOpen: (environmentId: EnvironmentId, threadId: string) => void;
}) {
  const gt = useGT();
  const label = { blocked: gt("Blocked"), observation: gt("Observation"), action: gt("To do") };
  return (
    <section aria-label={gt("Inbox")}>
      <h2 className="mb-2 font-medium text-sm">
        <T>Inbox</T> <span className="text-muted-foreground">{overview.inbox.length}</span>
      </h2>
      {overview.inbox.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          <T>Nothing is waiting on you.</T>
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {overview.inbox.map((item) => {
            const threadId = item.kind === "blocked" ? hearthThreadId(item.ref) : null;
            return (
              <li
                key={`${item.kind}:${item.path}:${item.line ?? ""}`}
                className="flex items-start gap-3 p-3 text-sm"
              >
                <Badge variant={item.kind === "blocked" ? "warning" : "outline"}>
                  {label[item.kind]}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="break-words">{item.title}</p>
                  {item.detail ? (
                    <p className="text-muted-foreground text-xs">{item.detail}</p>
                  ) : null}
                  <p className="truncate text-muted-foreground text-xs">
                    {item.project ?? item.path}
                  </p>
                </div>
                {threadId === null ? null : (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => onOpen(environmentId, threadId)}
                  >
                    <T>Open</T>
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function HearthContent({ environmentId }: { environmentId: EnvironmentId }) {
  const gt = useGT();
  const navigate = useNavigate();
  const result = useAtomValue(serverEnvironment.hearthOverview({ environmentId, input: {} }));
  const openCentral = useAtomCommand(serverEnvironment.hearthOpenCentral, { reportFailure: false });
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openThread = (target: EnvironmentId, threadId: string) => {
    void navigate({ to: "/$environmentId/$threadId", params: { environmentId: target, threadId } });
  };
  const handleCentral = async () => {
    setOpening(true);
    setError(null);
    const opened = await openCentral({ environmentId, input: {} });
    setOpening(false);
    if (opened._tag === "Success") {
      openThread(environmentId, opened.value.threadId);
      return;
    }
    setError(failureMessage(opened, gt("Could not open the central session.")));
  };
  const value = AsyncResult.getOrElse(result, () => null);
  if (value === null) {
    return (
      <p className="text-muted-foreground text-sm">
        {AsyncResult.isFailure(result) ? gt("Could not read Hearth.") : gt("Loading Hearth…")}
      </p>
    );
  }
  if (value.state === "unavailable") {
    return (
      <div className="space-y-1 text-sm">
        <p className="font-medium">
          <T>Hearth is not connected</T>
        </p>
        <p className="text-muted-foreground">{value.reason}</p>
      </div>
    );
  }
  const groups = groupHearthOverview(value.overview);
  return (
    <div className="space-y-6">
      <section className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
        <div className="min-w-0">
          <h2 className="font-medium">
            <T>Central session</T>
          </h2>
          <p className="text-muted-foreground text-sm">
            <T>One thread above every project.</T>
          </p>
          {error ? <p className="mt-1 text-destructive-foreground text-xs">{error}</p> : null}
        </div>
        <Button disabled={opening} onClick={() => void handleCentral()}>
          <MessageSquareIcon />
          {opening ? gt("Opening…") : gt("Open")}
        </Button>
      </section>
      <HearthInbox overview={value.overview} environmentId={environmentId} onOpen={openThread} />
      <section aria-label={gt("Projects")} className="space-y-3">
        <h2 className="font-medium text-sm">
          <T>Projects</T>
        </h2>
        {groups.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            <T>No projects yet. Ask the central session to create one.</T>
          </p>
        ) : (
          groups.map((group) => (
            <HearthProjectCard
              key={group.id}
              group={group}
              environmentId={environmentId}
              onOpen={openThread}
            />
          ))
        )}
      </section>
    </div>
  );
}

export function HearthPage() {
  const environmentId = usePrimaryEnvironmentId();
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden">
      <ScrollArea className="h-full">
        <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
          <h1 className="flex items-center gap-2 font-semibold text-xl">
            <FlameIcon className="size-5" />
            <T>Hearth</T>
          </h1>
          {environmentId === null ? null : <HearthContent environmentId={environmentId} />}
        </main>
      </ScrollArea>
    </SidebarInset>
  );
}
