import {
  CommandId,
  HearthError,
  HearthOverview,
  HearthKeeperPrompt,
  type HearthLaunchInput,
  type HearthOpenLeadInput,
  type HearthSaveKeeperPromptInput,
  type HearthOverview as HearthOverviewDocument,
  type HearthOverviewResult,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import * as NodeOS from "node:os";
import * as Config from "effect/Config";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import { hearthCentralInstructions } from "./hearthInstructions.ts";

const decodeOverview = Schema.decodeUnknownEffect(Schema.fromJsonString(HearthOverview));
const decodeKeeperPrompt = Schema.decodeUnknownEffect(Schema.fromJsonString(HearthKeeperPrompt));
const decodeSynced = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Schema.String)));
const encodeSynced = Schema.encodeSync(Schema.fromJsonString(Schema.Array(Schema.String)));
const decodeLaunched = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ ref: Schema.String })),
);
const READ_TIMEOUT = Duration.seconds(15);
const LAUNCH_TIMEOUT = Duration.minutes(2);
const MAX_CENTRAL_GENERATIONS = 100;
const RANDOM_PROJECT_ID = "random";
const RANDOM_PROJECT_NOTE = `---
title: Random
status: active
repos: []
paths: []
links: []
---

## What it is

Little one-off things that do not belong to another project.

## Now

## Blocked on
`;

const isHearthError = Schema.is(HearthError);
const failure = (message: string) => new HearthError({ message });

const commandMessage = (cause: unknown) =>
  String(cause).includes("ENOENT")
    ? "The hearth command is not installed."
    : "The hearth command could not run.";

/** Hearth quotes the whole command, brief included, before the reason it failed. */
export const hearthFailure = (stderr: string) => {
  const text = stderr.trim();
  const reason = text.slice(text.lastIndexOf("` failed: ") + 1).replace(/^ failed: /, "");
  return (
    (text.includes("` failed: ") ? reason : text).slice(-2_000) || "The hearth command failed."
  );
};

const optionalEnv = Effect.fn("HearthService.optionalEnv")(
  function* (name: string) {
    const value = yield* Config.String(name).pipe(Config.option, Config.map(Option.getOrUndefined));
    return value;
  },
  Effect.orElseSucceed(() => undefined),
);

/** `t3:<thread id>`, the only coordinator this app can open. */
export const threadOfRef = (ref: string | null): ThreadId | null =>
  ref?.startsWith("t3:") && ref.length > 3 ? ThreadId.make(ref.slice(3)) : null;

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const projects = yield* ProjectService.ProjectService;
  const launches = yield* ThreadLaunchService.ThreadLaunchService;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const providers = yield* ProviderRegistry.ProviderRegistry;
  const settings = yield* ServerSettings.ServerSettingsService;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const random = yield* SecureRandom.SecureRandom;
  const uuid = random.uuidV4().pipe(Effect.orDie);

  const home = NodeOS.homedir();
  const store =
    (yield* optionalEnv("HEARTH_STORE")) ?? path.join(home, ".local/share/hearth/store.sqlite");
  const configuredBin = yield* optionalEnv("HEARTH_BIN");
  const cargoBin = path.join(home, ".cargo/bin/hearth");

  const bin = Effect.gen(function* () {
    if (configuredBin !== undefined) return configuredBin;
    const installed = yield* fileSystem.exists(cargoBin).pipe(Effect.orElseSucceed(() => false));
    return installed ? cargoBin : "hearth";
  });

  const run = Effect.fn("HearthService.run")(function* (
    args: ReadonlyArray<string>,
    timeout: Duration.Duration,
    input?: string,
  ) {
    const program = yield* bin;
    const finished = yield* Effect.gen(function* () {
      const child = yield* spawner.spawn(
        ChildProcess.make(program, [...args], {
          shell: false,
          detached: false,
          stdin: input === undefined ? "ignore" : Stream.make(new TextEncoder().encode(input)),
          stdout: "pipe",
          stderr: "pipe",
          extendEnv: true,
          // `t3` run by Hearth must reach this server, not another install's.
          env: { T3CODE_HOME: config.baseDir },
        }),
      );
      const [stdout, stderr, exitCode] = yield* Effect.all(
        [
          child.stdout.pipe(Stream.decodeText(), Stream.mkString),
          child.stderr.pipe(Stream.decodeText(), Stream.mkString),
          child.exitCode,
        ],
        { concurrency: "unbounded" },
      );
      if (Number(exitCode) !== 0) return yield* failure(hearthFailure(stderr));
      return stdout;
    }).pipe(
      Effect.scoped,
      Effect.timeoutOption(timeout),
      Effect.mapError((cause) => (isHearthError(cause) ? cause : failure(commandMessage(cause)))),
    );
    if (Option.isNone(finished)) return yield* failure("The hearth command timed out.");
    return finished.value;
  });

  const readOverview = Effect.gen(function* () {
    const exists = yield* fileSystem.exists(store).pipe(Effect.orElseSucceed(() => false));
    if (!exists) return yield* failure(`No Hearth store at ${store}.`);
    const output = yield* run(["agents", "overview", "--store", store], READ_TIMEOUT);
    return yield* decodeOverview(output).pipe(
      Effect.mapError(() => failure("This version of hearth printed an unknown overview.")),
    );
  });

  // Which Hearth projects already got a T3 project, so one the owner removes stays removed.
  const syncedFile = path.join(config.baseDir, "hearth", "synced-projects.json");
  const legacyRandomMarker = path.join(config.baseDir, "hearth", "random-project-created");

  const readSynced = Effect.gen(function* () {
    const text = yield* fileSystem
      .readFileString(syncedFile)
      .pipe(Effect.orElseSucceed(() => "[]"));
    const ids = new Set(Option.getOrElse(decodeSynced(text), () => [] as ReadonlyArray<string>));
    const legacy = yield* fileSystem
      .exists(legacyRandomMarker)
      .pipe(Effect.orElseSucceed(() => false));
    if (legacy) ids.add(RANDOM_PROJECT_ID);
    return ids;
  });

  const managedRoot = (id: string) =>
    path.join(path.dirname(store), "plugins", "agents", "projects", id);

  const expandHome = (value: string) =>
    value.startsWith("~/") ? path.join(home, value.slice(2)) : value;

  const registerRoot = Effect.fn("HearthService.registerRoot")(function* (
    workspaceRoot: string,
    title: string,
  ) {
    const id = yield* uuid;
    const bootstrapped = yield* projects
      .bootstrap({
        commandId: CommandId.make(`hearth-project:${id}`),
        projectId: ProjectId.make(id),
        title,
        workspaceRoot,
      })
      .pipe(
        Effect.catchTags({
          ProjectConflictError: (conflict) =>
            Effect.succeed({ project: { id: conflict.conflictingProjectId } }),
        }),
      );
    // Pinned folders stay in the sidebar with no threads; the owner can unpin one.
    yield* projects.update({
      commandId: CommandId.make(`hearth-project-pin:${id}`),
      projectId: bootstrapped.project.id,
      pinned: true,
    });
  });

  const syncOverview = Effect.fn("HearthService.syncOverview")(function* (
    first: HearthOverviewDocument,
  ) {
    const synced = yield* readSynced;
    let current = first;
    if (
      !synced.has(RANDOM_PROJECT_ID) &&
      !current.projects.some((project) => project.id === RANDOM_PROJECT_ID)
    ) {
      // Without `--expect`, Hearth refuses to replace a note that already exists.
      yield* run(
        ["write", `projects/${RANDOM_PROJECT_ID}.md`, "--store", store],
        READ_TIMEOUT,
        RANDOM_PROJECT_NOTE,
      );
      current = yield* readOverview;
    }
    let changed = false;
    for (const project of current.projects) {
      if (synced.has(project.id) || project.status === "done" || project.status === "dropped") {
        continue;
      }
      const paths = project.paths.map(expandHome);
      if (paths.length === 0) {
        const root = managedRoot(project.id);
        yield* fileSystem.makeDirectory(root, { recursive: true });
        yield* registerRoot(root, project.title);
      } else {
        const present = yield* Effect.filter(paths, (candidate) => fileSystem.exists(candidate));
        // A checkout that is not on this machine is retried on a later sync.
        if (present.length !== paths.length) continue;
        for (const root of present) {
          yield* registerRoot(
            root,
            paths.length === 1 ? project.title : `${project.title} (${path.basename(root)})`,
          );
        }
      }
      synced.add(project.id);
      changed = true;
    }
    if (changed) {
      yield* fileSystem.makeDirectory(path.dirname(syncedFile), { recursive: true });
      yield* fileSystem.writeFileString(syncedFile, encodeSynced([...synced].toSorted()));
    }
  });

  const sync = readOverview.pipe(
    Effect.flatMap(syncOverview),
    Effect.as({ synced: true }),
    Effect.catchCause((cause) =>
      Effect.logDebug("Could not sync Hearth projects", cause).pipe(Effect.as({ synced: false })),
    ),
  );

  const overview: Effect.Effect<HearthOverviewResult> = readOverview.pipe(
    Effect.map((value) => ({ state: "ready" as const, overview: value })),
    Effect.catch((error: HearthError) =>
      Effect.succeed({ state: "unavailable" as const, reason: error.message }),
    ),
  );

  const liveThread = (threadId: ThreadId) =>
    threads.getThreadShell(threadId).pipe(
      Effect.map((shell) => (shell !== null && shell.deletedAt === null ? shell : null)),
      Effect.mapError(() => failure("Could not read Keeper.")),
    );

  const reopen = (threadId: ThreadId, archivedAt: unknown) =>
    archivedAt === null
      ? Effect.void
      : Effect.flatMap(uuid, (id) =>
          threads.dispatch({
            type: "thread.unarchive",
            commandId: CommandId.make(`hearth-central-unarchive:${id}`),
            threadId,
          }),
        ).pipe(
          Effect.asVoid,
          Effect.mapError(() => failure("Could not reopen Keeper.")),
        );

  const readKeeperPrompt = run(["agents", "prompt", "--store", store], READ_TIMEOUT).pipe(
    Effect.flatMap((output) =>
      decodeKeeperPrompt(output).pipe(
        Effect.mapError(() => failure("This version of hearth printed an unknown prompt.")),
      ),
    ),
  );

  const writeKeeperFiles = Effect.fn("HearthService.writeKeeperFiles")(function* (
    workspaceRoot: string,
  ) {
    const prompt = yield* readKeeperPrompt;
    const instructions = hearthCentralInstructions({
      bin: yield* bin,
      store,
      t3Home: config.baseDir,
      prompt: prompt.text,
    });
    yield* Effect.all([
      fileSystem.makeDirectory(workspaceRoot, { recursive: true }),
      fileSystem.writeFileString(path.join(workspaceRoot, "AGENTS.md"), instructions),
      fileSystem.writeFileString(path.join(workspaceRoot, "CLAUDE.md"), instructions),
    ]).pipe(Effect.mapError(() => failure("Could not prepare Keeper's folder.")));
  });

  const centralProject = Effect.gen(function* () {
    const workspaceRoot = path.join(config.baseDir, "hearth", "central");
    yield* writeKeeperFiles(workspaceRoot);
    const id = yield* uuid;
    const bootstrapped = yield* projects
      .bootstrap({
        commandId: CommandId.make(`hearth-central-project:${id}`),
        projectId: ProjectId.make(id),
        title: "Hearth",
        workspaceRoot,
      })
      .pipe(
        Effect.catchTags({
          ProjectConflictError: (conflict) =>
            Effect.succeed({ project: { id: conflict.conflictingProjectId } }),
        }),
        Effect.mapError(() => failure("Could not create Keeper's project.")),
      );
    return bootstrapped.project.id;
  });

  const centralModel = Effect.gen(function* () {
    const current = yield* settings.getSettings.pipe(
      Effect.mapError(() => failure("Could not read settings.")),
    );
    if (current.defaultModelSelection !== null) {
      return {
        modelSelection: current.defaultModelSelection,
        runtimeMode: current.defaultRuntimeMode,
      };
    }
    const available = yield* providers.getProviders;
    const provider = available.find(
      (item) =>
        item.enabled &&
        item.installed &&
        item.auth.status !== "unauthenticated" &&
        item.models.length > 0,
    );
    const model = provider?.models[0];
    if (provider === undefined || model === undefined) {
      return yield* failure("Set up a provider in Settings before opening Keeper.");
    }
    return {
      modelSelection: { instanceId: provider.instanceId, model: model.slug },
      runtimeMode: current.defaultRuntimeMode,
    };
  });

  // A stable id, so a retry after a failed step reuses the thread it already made.
  const nextCentralThread = Effect.gen(function* () {
    for (let generation = 0; generation < MAX_CENTRAL_GENERATIONS; generation += 1) {
      const threadId = ThreadId.make(`hearth-central-${generation}`);
      const shell = yield* threads
        .getThreadShell(threadId)
        .pipe(Effect.mapError(() => failure("Could not read Keeper.")));
      if (shell === null || shell.deletedAt === null) return threadId;
    }
    return yield* failure("Could not choose a thread for Keeper.");
  });

  const openCentral = Effect.gen(function* () {
    const current = yield* readOverview;
    const existing = threadOfRef(current.coordinator);
    if (existing !== null) {
      const shell = yield* liveThread(existing);
      if (shell !== null) {
        yield* reopen(existing, shell.archivedAt);
        return { threadId: existing };
      }
    }
    const projectId = yield* centralProject;
    const threadId = yield* nextCentralThread;
    const shell = yield* liveThread(threadId);
    if (shell === null) {
      const model = yield* centralModel;
      yield* launches
        .launch({
          commandId: CommandId.make(`hearth-central:${threadId}`),
          threadId,
          projectId,
          title: "Keeper",
          titleRenamed: true,
          modelSelection: model.modelSelection,
          runtimeMode: model.runtimeMode,
          interactionMode: "default",
          workspaceStrategy: { type: "root" },
          createdBy: "user",
          creationSource: "web",
        })
        .pipe(Effect.mapError(() => failure("Could not start Keeper.")));
    } else {
      yield* reopen(threadId, shell.archivedAt);
    }
    yield* run(["config", "--store", store, "coordinator", `t3:${threadId}`], READ_TIMEOUT);
    return { threadId };
  });

  const unusedCentralThread = Effect.gen(function* () {
    for (let generation = 0; generation < MAX_CENTRAL_GENERATIONS; generation += 1) {
      const threadId = ThreadId.make(`hearth-central-${generation}`);
      const shell = yield* threads
        .getThreadShell(threadId)
        .pipe(Effect.mapError(() => failure("Could not read Keeper.")));
      if (shell === null) return threadId;
    }
    return yield* failure("Could not choose a thread for Keeper.");
  });

  // The new Keeper is in place before the old one is archived, so a failure leaves one running.
  const restartKeeper = Effect.gen(function* () {
    const current = yield* readOverview;
    const previousId = threadOfRef(current.coordinator);
    const previous = previousId === null ? null : yield* liveThread(previousId);
    const projectId = yield* centralProject;
    const threadId = yield* unusedCentralThread;
    const model =
      previous === null
        ? yield* centralModel
        : { modelSelection: previous.modelSelection, runtimeMode: previous.runtimeMode };
    yield* launches
      .launch({
        commandId: CommandId.make(`hearth-central:${threadId}`),
        threadId,
        projectId,
        title: "Keeper",
        titleRenamed: true,
        modelSelection: model.modelSelection,
        runtimeMode: model.runtimeMode,
        interactionMode: "default",
        workspaceStrategy: { type: "root" },
        createdBy: "user",
        creationSource: "web",
      })
      .pipe(Effect.mapError(() => failure("Could not start Keeper.")));
    yield* run(["config", "--store", store, "coordinator", `t3:${threadId}`], READ_TIMEOUT);
    if (previous !== null && previousId !== null && previous.archivedAt === null) {
      const id = yield* uuid;
      yield* threads
        .dispatch({
          type: "thread.archive",
          commandId: CommandId.make(`hearth-central-archive:${id}`),
          threadId: previousId,
        })
        .pipe(
          Effect.asVoid,
          Effect.catchCause((cause) =>
            Effect.logWarning("Could not archive the previous Keeper", cause),
          ),
        );
    }
    return { threadId };
  });

  const saveKeeperPrompt = Effect.fn("HearthService.saveKeeperPrompt")(function* (
    input: HearthSaveKeeperPromptInput,
  ) {
    yield* run(
      [
        "write",
        "keeper.md",
        "--store",
        store,
        ...(input.version === null ? [] : ["--expect", String(input.version)]),
      ],
      READ_TIMEOUT,
      input.text,
    );
    yield* writeKeeperFiles(path.join(config.baseDir, "hearth", "central"));
    return yield* readKeeperPrompt;
  });

  const openLead = Effect.fn("HearthService.openLead")(function* (input: HearthOpenLeadInput) {
    const current = yield* readOverview;
    const project = current.projects.find((item) => item.id === input.project);
    if (project === undefined) return yield* failure(`No Hearth project \`${input.project}\`.`);
    const existing = threadOfRef(project.lead);
    if (existing !== null && (yield* liveThread(existing)) !== null) return { threadId: existing };
    return yield* launchSession({
      project: project.id,
      title: `${project.title} lead`,
      task: "Take the lead on this project. Read its note and decisions, then tell the owner where it stands and what you would do next.",
      lead: true,
    });
  });

  const launch = (input: HearthLaunchInput) => launchSession({ ...input, lead: false });

  const launchSession = Effect.fn("HearthService.launch")(function* (
    input: HearthLaunchInput & { readonly lead: boolean },
  ) {
    const output = yield* run(
      [
        "agents",
        "launch",
        "--store",
        store,
        `--project=${input.project}`,
        `--title=${input.title}`,
        `--task=${input.task}`,
        ...(input.lead ? ["--lead"] : []),
      ],
      LAUNCH_TIMEOUT,
    );
    const launched = yield* decodeLaunched(output).pipe(
      Effect.mapError(() => failure("Hearth started the session but printed an unknown result.")),
    );
    const threadId = threadOfRef(launched.ref);
    if (threadId === null) return yield* failure("Hearth started the session outside T3.");
    return { threadId };
  });

  return {
    overview,
    sync,
    openCentral,
    restartKeeper,
    readKeeperPrompt,
    saveKeeperPrompt,
    openLead,
    launch,
  } as const;
});
