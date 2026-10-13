import type { OpenDefaultWorkspaceRequest, OpenWorkspaceRequest } from '../../apps/web/src/generated/imports';

const automatic: OpenDefaultWorkspaceRequest = {
  schema_version: 1,
  message_type: 'open_default_workspace_request',
  request_id: 'first-use-1',
  query_revision: 1,
};
// @ts-expect-error An automatic request cannot pick a hidden alternate folder.
const hiddenPath: OpenDefaultWorkspaceRequest = { ...automatic, path: '/different/folder' };
// @ts-expect-error Explicit workspace opening still requires its path.
const missingPath: OpenWorkspaceRequest = { ...automatic, message_type: 'open_workspace_request' };
void automatic;
void hiddenPath;
void missingPath;
