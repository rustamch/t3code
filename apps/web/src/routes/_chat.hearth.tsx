import { createFileRoute } from "@tanstack/react-router";

import { HearthPage } from "../components/hearth/HearthPage";

export const Route = createFileRoute("/_chat/hearth")({
  component: HearthPage,
});
