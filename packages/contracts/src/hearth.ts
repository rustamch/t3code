import * as Schema from "effect/Schema";

import { ThreadId } from "./baseSchemas.ts";

const NullableString = Schema.NullOr(Schema.String);

export const HearthProject = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  status: NullableString,
  repos: Schema.Array(Schema.String),
  paths: Schema.Array(Schema.String),
  now: NullableString,
  path: Schema.String,
  lead: NullableString,
});
export type HearthProject = typeof HearthProject.Type;

export const HearthAgent = Schema.Struct({
  ref: Schema.String,
  link: NullableString,
  project: Schema.String,
  title: Schema.String,
  purpose: Schema.String,
  status: Schema.Literals(["launched", "working", "blocked", "done", "abandoned"]),
  branch: NullableString,
  launched_at: Schema.String,
  path: Schema.String,
  role: NullableString,
});
export type HearthAgent = typeof HearthAgent.Type;

export const HearthInboxItem = Schema.Struct({
  kind: Schema.Literals(["blocked", "observation", "action"]),
  title: Schema.String,
  detail: NullableString,
  project: NullableString,
  path: Schema.String,
  link: NullableString,
  ref: NullableString,
  at: NullableString,
  line: Schema.optionalKey(Schema.Number),
});
export type HearthInboxItem = typeof HearthInboxItem.Type;

/** The `hearth.overview/1` document printed by `hearth agents overview`. */
export const HearthOverview = Schema.Struct({
  schema: Schema.Literal("hearth.overview/1"),
  owner: Schema.String,
  coordinator: NullableString,
  projects: Schema.Array(HearthProject),
  agents: Schema.Array(HearthAgent),
  inbox: Schema.Array(HearthInboxItem),
});
export type HearthOverview = typeof HearthOverview.Type;

export const HearthOverviewResult = Schema.Union([
  Schema.Struct({ state: Schema.Literal("ready"), overview: HearthOverview }),
  Schema.Struct({ state: Schema.Literal("unavailable"), reason: Schema.String }),
]);
export type HearthOverviewResult = typeof HearthOverviewResult.Type;

export const HearthLaunchInput = Schema.Struct({
  project: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
  title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  task: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(20_000)),
});
export type HearthLaunchInput = typeof HearthLaunchInput.Type;

export const HearthOpenLeadInput = Schema.Struct({
  project: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
});
export type HearthOpenLeadInput = typeof HearthOpenLeadInput.Type;

/** The owner's prompt for Keeper, the note `keeper.md`. A null version means it has no note yet. */
export const HearthKeeperPrompt = Schema.Struct({
  text: Schema.String,
  version: Schema.NullOr(Schema.Number),
});
export type HearthKeeperPrompt = typeof HearthKeeperPrompt.Type;

export const HearthSaveKeeperPromptInput = Schema.Struct({
  text: Schema.String.check(Schema.isMaxLength(100_000)),
  version: Schema.NullOr(Schema.Number),
});
export type HearthSaveKeeperPromptInput = typeof HearthSaveKeeperPromptInput.Type;

export const HearthThreadResult = Schema.Struct({ threadId: ThreadId });
export type HearthThreadResult = typeof HearthThreadResult.Type;

export class HearthError extends Schema.TaggedError<HearthError>()("HearthError", {
  message: Schema.String,
}) {}
