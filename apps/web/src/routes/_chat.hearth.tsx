import { createFileRoute } from "@tanstack/react-router";

import { HearthPage } from "../components/hearth/HearthPage";

export const Route = createFileRoute("/_chat/hearth")({
  validateSearch: (raw: Record<string, unknown>): { readonly prompt?: true } =>
    raw.prompt === true ? { prompt: true } : {},
  component: HearthPage,
});
