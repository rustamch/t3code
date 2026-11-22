import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, HearthKeeperPrompt, HearthOverview } from "@t3tools/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import {
  FlameIcon,
  MessageSquareIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  UsersIcon,
} from "lucide-react";
import { T, useGT } from "gt-react";
import { useState, type FormEvent } from "react";

import { readLocalApi } from "../../localApi";
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
  quickLaunchTitle,
  RANDOM_PROJECT_ID,
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
  const openLead = useAtomCommand(serverEnvironment.hearthOpenLead, { reportFailure: false });
  const [leadBusy, setLeadBusy] = useState(false);
  const open = group.agents.filter(isOpenAgent);
  const handleLead = async () => {
    setLeadBusy(true);
    setError(null);
    const result = await openLead({ environmentId, input: { project: group.id } });
    setLeadBusy(false);
    if (result._tag === "Success") {
      onOpen(environmentId, result.value.threadId);
      return;
    }
    setError(failureMessage(result, gt("Could not open the lead.")));
  };
  const isRandom = group.id === RANDOM_PROJECT_ID;

  const quickLaunch = async (event: FormEvent) => {
    event.preventDefault();
    const text = task.trim();
    if (text === "" || busy) return;
    setBusy(true);
    setError(null);
    const result = await launch({
      environmentId,
      input: { project: group.id, title: quickLaunchTitle(text), task: text },
    });
    setBusy(false);
    if (result._tag === "Success") {
      setTask("");
      onOpen(environmentId, result.value.threadId);
      return;
    }
    setError(failureMessage(result, gt("Could not start the session.")));
  };

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
          {group.project === null || isRandom ? null : (
            <Button
              size="xs"
              variant="outline"
              disabled={leadBusy}
              onClick={() => void handleLead()}
            >
              <UsersIcon />
              {group.project.lead === null ? gt("Start lead") : gt("Open lead")}
            </Button>
          )}
          {isRandom ? null : (
            <Button size="xs" variant="outline" onClick={() => setStarting((value) => !value)}>
              <PlusIcon />
              <T>Start work</T>
            </Button>
          )}
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
                <span className="flex shrink-0 items-center gap-1">
                  {agent.role === "lead" ? <Badge variant="info">{gt("Lead")}</Badge> : null}
                  <Badge variant={agent.status === "blocked" ? "warning" : "secondary"}>
                    {agent.status}
                  </Badge>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {isRandom ? (
        <form className="mt-3 space-y-2" onSubmit={(event) => void quickLaunch(event)}>
          <div className="flex items-center gap-2">
            <Input
              aria-label={gt("A little thing to do")}
              placeholder={gt("A little thing to do…")}
              value={task}
              onChange={(event) => setTask(event.target.value)}
            />
            <Button size="sm" type="submit" disabled={busy || task.trim() === ""}>
              {busy ? gt("Starting…") : gt("Launch")}
            </Button>
          </div>
          {error ? <p className="text-destructive-foreground text-xs">{error}</p> : null}
        </form>
      ) : null}
      {error && !starting && !isRandom ? (
        <p className="mt-2 text-destructive-foreground text-xs">{error}</p>
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

function KeeperPromptForm({
  environmentId,
  prompt,
  onSaved,
  onRestart,
  onClose,
}: {
  environmentId: EnvironmentId;
  prompt: HearthKeeperPrompt;
  onSaved: (prompt: HearthKeeperPrompt) => void;
  onRestart: () => Promise<void>;
  onClose: () => void;
}) {
  const gt = useGT();
  const save = useAtomCommand(serverEnvironment.hearthSaveKeeperPrompt, { reportFailure: false });
  const [text, setText] = useState(prompt.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = text !== prompt.text;
  const persist = async () => {
    setBusy(true);
    setError(null);
    const result = await save({ environmentId, input: { text, version: prompt.version } });
    setBusy(false);
    if (result._tag === "Success") {
      onSaved(result.value);
      return true;
    }
    setError(failureMessage(result, gt("Could not save the prompt.")));
    return false;
  };
  return (
    <div className="mt-4 space-y-2 border-border border-t pt-4">
      <label className="block font-medium text-sm" htmlFor="keeper-prompt">
        <T>Keeper prompt</T>
      </label>
      <p className="text-muted-foreground text-xs">
        <T>
          Keeper follows this in every conversation. A running Keeper picks it up when restarted.
        </T>
      </p>
      <Textarea
        id="keeper-prompt"
        rows={8}
        value={text}
        placeholder={gt("How should Keeper work with you?")}
        onChange={(event) => setText(event.target.value)}
      />
      {error ? <p className="text-destructive-foreground text-xs">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy || !changed} onClick={() => void persist()}>
          {gt("Save")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !changed}
          onClick={() => {
            void persist().then((saved) => (saved ? onRestart() : undefined));
          }}
        >
          {gt("Save and restart")}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onClose}>
          {gt("Close")}
        </Button>
      </div>
    </div>
  );
}

function KeeperPromptEditor({
  environmentId,
  onRestart,
  onClose,
}: {
  environmentId: EnvironmentId;
  onRestart: () => Promise<void>;
  onClose: () => void;
}) {
  const gt = useGT();
  const result = useAtomValue(
    serverEnvironment.hearthReadKeeperPrompt({ environmentId, input: {} }),
  );
  const [saved, setSaved] = useState<HearthKeeperPrompt | null>(null);
  const prompt = saved ?? AsyncResult.getOrElse(result, () => null);
  if (prompt === null) {
    return (
      <p className="mt-4 text-muted-foreground text-sm">
        {AsyncResult.isFailure(result) ? gt("Could not load the prompt.") : gt("Loading prompt…")}
      </p>
    );
  }
  return (
    <KeeperPromptForm
      key={String(prompt.version)}
      environmentId={environmentId}
      prompt={prompt}
      onSaved={setSaved}
      onRestart={onRestart}
      onClose={onClose}
    />
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
  const restartKeeper = useAtomCommand(serverEnvironment.hearthRestartKeeper, {
    reportFailure: false,
  });
  const search = useSearch({ from: "/_chat/hearth" });
  const [editingPrompt, setEditingPrompt] = useState(search.prompt === true);
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
    setError(failureMessage(opened, gt("Could not open Keeper.")));
  };
  const handleRestart = async () => {
    const api = readLocalApi();
    if (!api) return;
    const confirmed = await api.dialogs.confirm(
      gt("Restart Keeper? The current conversation is archived and a new one starts."),
    );
    if (!confirmed) return;
    setOpening(true);
    setError(null);
    const restarted = await restartKeeper({ environmentId, input: {} });
    setOpening(false);
    if (restarted._tag === "Success") {
      openThread(environmentId, restarted.value.threadId);
      return;
    }
    setError(failureMessage(restarted, gt("Could not restart Keeper")));
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
      <section className="rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-medium">
              <T>Keeper</T>
            </h2>
            <p className="text-muted-foreground text-sm">
              <T>Your main thread for everything.</T>
            </p>
            {error ? <p className="mt-1 text-destructive-foreground text-xs">{error}</p> : null}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditingPrompt((open) => !open)}>
              <PencilIcon />
              {gt("Edit prompt")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={opening}
              onClick={() => void handleRestart()}
            >
              <RotateCcwIcon />
              {gt("Restart")}
            </Button>
            <Button size="sm" disabled={opening} onClick={() => void handleCentral()}>
              <MessageSquareIcon />
              {opening ? gt("Opening…") : gt("Open")}
            </Button>
          </div>
        </div>
        {editingPrompt ? (
          <KeeperPromptEditor
            environmentId={environmentId}
            onRestart={handleRestart}
            onClose={() => setEditingPrompt(false)}
          />
        ) : null}
      </section>
      <HearthInbox overview={value.overview} environmentId={environmentId} onOpen={openThread} />
      <section aria-label={gt("Projects")} className="space-y-3">
        <h2 className="font-medium text-sm">
          <T>Projects</T>
        </h2>
        {groups.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            <T>No projects yet. Ask Keeper to create one.</T>
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
