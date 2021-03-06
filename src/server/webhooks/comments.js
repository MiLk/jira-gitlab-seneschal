// @flow
import type { WebhookProcessResponseType } from './queue';
import linkIssues from './linkIssues';

export default async function processWebhookComment(
  jiraApi: *,
  gitlabApi: *,
  baseUrl: string,
  jiraProjectIds: string[],
  commentBody: *
): ?WebhookProcessResponseType {
  const { id, note, noteable_type: type } = commentBody.object_attributes;
  // $FlowFixMe Async Promise/Object type conflict
  if (type !== 'MergeRequest') return null;

  const { issues, newText } = linkIssues(jiraProjectIds, baseUrl, note);

  const metadata = {
    projectId: commentBody.project.id,
    projectNamespace: commentBody.project.path_with_namespace,
    mergeRequestId: commentBody.merge_request.iid,
    issues
  };

  await gitlabApi.MergeRequestNotes.edit(
    metadata.projectId,
    metadata.mergeRequestId,
    id,
    {
      body: newText
    }
  );
  // $FlowFixMe Async Promise/Object type conflict
  return metadata;
}
