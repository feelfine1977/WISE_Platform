"""The backup and restore operations of a local workspace, over the import operations' open workspaces."""
from __future__ import annotations

from dataclasses import dataclass
import logging

from .boundary import SCHEMA_VERSION, read_object
from .generated import workspace_backup as generated
from .generated.workspace_backup import (BackUpWorkspaceAnswer, BackUpWorkspaceRequest, RestoreWorkspaceAnswer, RestoreWorkspaceRequest,
                                         WorkspaceBackupRefusal)
from .imports import Imports
from .strict_reading import alternatives_of, read_strictly
from .workspace import Problem
from .workspace_backup import back_up, restore

logger = logging.getLogger(__name__)

BACK_UP = "back_up_workspace"
RESTORE = "restore_workspace"
STATUS = {"invalid_request": 400, "unsupported_schema": 400, "workspace_unavailable": 404, "workspace_not_writable": 403, "workspace_incompatible": 409,
          "workspace_busy": 409, "destination_unavailable": 409, "backup_unavailable": 404, "backup_damaged": 422, "computation_failed": 500}
RETRYABLE = frozenset({"workspace_unavailable", "workspace_not_writable", "workspace_busy", "computation_failed"})


@dataclass(frozen=True)
class BackupReply:
    status: int
    body: dict


def refused(operation: str, code: str, message: str, given: dict, field: str | None = None) -> BackupReply:
    if code not in STATUS:
        code, message, field = "computation_failed", "The workspace could not be backed up or restored.", None
    body = WorkspaceBackupRefusal(schema_version=SCHEMA_VERSION, message_type="workspace_backup_refusal",
                                  request_id=given.get("request_id") if isinstance(given.get("request_id"), str) else None,
                                  query_revision=given.get("query_revision") if type(given.get("query_revision")) is int else None,
                                  operation=operation, code=code, message=message, field=field, retryable=code in RETRYABLE).model_dump(mode="json")
    return BackupReply(STATUS[code], body)


def _parse(body: bytes, model, operation: str) -> dict | BackupReply:
    given = read_object(body)
    if isinstance(given, str):
        return refused(operation, "invalid_request", given, {})
    version = given.get("schema_version")
    if type(version) is int and version != SCHEMA_VERSION:
        return refused(operation, "unsupported_schema", "This application reads schema version one.", given, "schema_version")
    checked = read_strictly(given, model, alternatives_of(generated))
    if isinstance(checked, list):
        failure = checked[0]
        return refused(operation, "invalid_request", "The request is not valid at " + (failure.field or "the request") + ": " + failure.reason + ".", given, failure.field)
    return given


class WorkspaceBackups:
    def __init__(self, imports: Imports) -> None:
        self._imports = imports

    def back_up(self, body: bytes) -> BackupReply:
        given = _parse(body, BackUpWorkspaceRequest, BACK_UP)
        if isinstance(given, BackupReply):
            return given
        try:
            workspace = self._imports.opened_workspace(given["workspace_id"])
            if isinstance(workspace, Problem):
                return refused(BACK_UP, workspace.code, workspace.message, given, "workspace_id")
            done = back_up(workspace, given["destination"])
            if isinstance(done, Problem):
                return refused(BACK_UP, done.code, done.message, given, done.field)
            answer = {"schema_version": SCHEMA_VERSION, "message_type": "back_up_workspace_answer", "request_id": given["request_id"],
                      "query_revision": given["query_revision"], **done}
            return BackupReply(200, BackUpWorkspaceAnswer.model_validate(answer).model_dump(mode="json"))
        except Exception:
            logger.exception("The backup failed unexpectedly")
            return refused(BACK_UP, "computation_failed", "The workspace could not be backed up. Retry; if it fails again, the application needs repair.", given)

    def restore(self, body: bytes) -> BackupReply:
        given = _parse(body, RestoreWorkspaceRequest, RESTORE)
        if isinstance(given, BackupReply):
            return given
        try:
            done = restore(given["backup_path"], given["destination"], self._imports.forbidden_folders())
            if isinstance(done, Problem):
                return refused(RESTORE, done.code, done.message, given, done.field)
            answer = {"schema_version": SCHEMA_VERSION, "message_type": "restore_workspace_answer", "request_id": given["request_id"],
                      "query_revision": given["query_revision"], **done}
            return BackupReply(200, RestoreWorkspaceAnswer.model_validate(answer).model_dump(mode="json"))
        except Exception:
            logger.exception("The restore failed unexpectedly")
            return refused(RESTORE, "computation_failed", "The workspace could not be restored. Retry; if it fails again, the application needs repair.", given)
