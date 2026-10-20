import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { BackUpWorkspaceRequest, RestoreWorkspaceRequest } from "../generated/workspace-backup";
import { workspaceId } from "../test/imports";
import { backupContract, type BackupClient } from "./backupClient";
import { WorkspaceBackup } from "./WorkspaceBackup";

const counts = { sources: 1, preparations: 1, definitions: 0, score_runs: 0, artifacts: 0, revisions: 2, investigations: 1 };

describe("#26 backing up and restoring the workspace in use", () => {
  it("backs up into a folder, says what is not backed up, restores a checked backup and opens it on request", async () => {
    const asked: (BackUpWorkspaceRequest | RestoreWorkspaceRequest)[] = [];
    const client: BackupClient = {
      backUp: async (request) => {
        asked.push(request);
        return { ok: true, answer: { schema_version: 1, message_type: "back_up_workspace_answer", request_id: request.request_id, query_revision: request.query_revision,
          workspace_id: workspaceId, path: "/backups/one", file_count: 7, byte_count: 900, counts, omitted: ["settings/document-folder.json"] } };
      },
      restore: async (request) => {
        asked.push(request);
        return { ok: true, answer: { schema_version: 1, message_type: "restore_workspace_answer", request_id: request.request_id, query_revision: request.query_revision,
          workspace_id: workspaceId, path: "/restored", file_count: 7, counts, warnings: ["The backup was made with analytics version 0.1."] } };
      },
    };
    const onOpen = vi.fn();
    render(<WorkspaceBackup workspaceId={workspaceId} onOpen={onOpen} client={client} />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Back up or restore"));
    await user.type(screen.getByLabelText(/^Backup folder/), "/backups/one");
    await user.click(screen.getByRole("button", { name: "Back up this workspace" }));
    expect(backupContract.backUpRequest(asked[0])).toBe(true);
    expect(await screen.findByText(/^Backed up into \/backups\/one: 7 files, 1 source, 1 reading, 1 saved investigation, 2 revisions, 0 score runs\./)).toBeTruthy();
    expect(screen.getByText(/Not backed up: the folder of record documents/)).toBeTruthy();
    await user.type(screen.getByLabelText(/^Backup to restore/), "/backups/one");
    await user.type(screen.getByLabelText(/^Restore into/), "/restored");
    await user.click(screen.getByRole("button", { name: "Restore the backup" }));
    expect(backupContract.restoreRequest(asked[1])).toBe(true);
    expect(await screen.findByText(/^Restored and checked into \/restored/)).toBeTruthy();
    expect(screen.getByText("The backup was made with analytics version 0.1.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Open the restored workspace" }));
    expect(onOpen).toHaveBeenCalledWith("/restored");
  });

  it("says that nothing was backed up or restored when it is refused", async () => {
    const client: BackupClient = {
      backUp: async () => ({ ok: false, message: "A save in this workspace is still being written. Back up again in a moment." }),
      restore: async () => ({ ok: false, message: "sources/x.csv of the backup is not the file that was backed up: its checksum differs. Restore another backup." }),
    };
    render(<WorkspaceBackup workspaceId={workspaceId} onOpen={() => undefined} client={client} />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Back up or restore"));
    await user.type(screen.getByLabelText(/^Backup folder/), "/b");
    await user.click(screen.getByRole("button", { name: "Back up this workspace" }));
    expect((await screen.findByRole("alert")).textContent).toBe("No backup was made. A save in this workspace is still being written. Back up again in a moment.");
    await user.type(screen.getByLabelText(/^Backup to restore/), "/b");
    await user.type(screen.getByLabelText(/^Restore into/), "/r");
    await user.click(screen.getByRole("button", { name: "Restore the backup" }));
    expect((await screen.findAllByRole("alert"))[1].textContent).toContain("Nothing was restored. sources/x.csv of the backup is not the file that was backed up");
    expect(screen.queryByRole("button", { name: "Open the restored workspace" })).toBeNull();
  });
});
