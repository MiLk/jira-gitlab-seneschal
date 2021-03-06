// @flow
import kebabCase from 'lodash/kebabCase';
import {
  isValidSecretKey,
  isValidWebhookType,
  registerProject,
  setWebhookClientKey
} from '../apis/webhooks';
import { enqueueWebhook, processQueue } from './queue';
import gitlabApi from '../apis/gitlab';
import type { GitlabCredential } from '../apis/credentials';
import { getCredential } from '../apis/credentials';
import { encrypt } from '../lowdb';
import type { WebhookProjectStatusType } from '../apis/webhooks';

const GITLAB_SECRET_TOKEN_PASSWORD = 'D+_"WqXsx_#]indVNBP?M3*7?/bnt&hB';

export async function createWebhooks(
  encryptionKey: string,
  gitlabProjectId: string,
  selfBaseUrl: string,
  clientKey: string
): WebhookProjectStatusType {
  const { appUrl }: GitlabCredential = (getCredential(
    encryptionKey,
    'gitlab'
  ): any);
  const gitlab = gitlabApi(encryptionKey);
  const currentProjectWebhooks = await gitlab.ProjectHooks.all(gitlabProjectId);

  const key = `${kebabCase(
    appUrl.replace(/^http(s|):\/\//, '')
  )}-${gitlabProjectId}`;
  const secretKey = encrypt(key, GITLAB_SECRET_TOKEN_PASSWORD);

  const webhookUrl = `${selfBaseUrl}/webhooks/${key}`;
  const webhookSettings = {
    merge_requests_events: true,
    note_events: true,
    token: secretKey,
    // These should be all defaulted but here for easy reference
    push_events: false,
    tag_push_events: false,
    repository_update_events: false,
    enable_ssl_verification: false,
    issues_events: false,
    confidential_issues_events: false,
    confidential_note_events: null,
    pipeline_events: false,
    wiki_page_events: false,
    job_events: false
  };

  const existingWebhook = currentProjectWebhooks.find(
    ({ url }) => url === webhookUrl
  );
  if (existingWebhook) {
    await gitlab.ProjectHooks.edit(
      gitlabProjectId,
      existingWebhook.id,
      webhookUrl,
      webhookSettings
    );
  } else {
    await gitlab.ProjectHooks.add(gitlabProjectId, webhookUrl, webhookSettings);
  }

  const { web_url, name_with_namespace } = await gitlab.Projects.show(
    gitlabProjectId
  );
  registerProject(
    encryptionKey,
    gitlabProjectId,
    name_with_namespace,
    `${web_url}/settings/integrations`
  );
  setWebhookClientKey(encryptionKey, key, secretKey, clientKey);

  // $FlowFixMe
  return {
    id: gitlabProjectId,
    name: name_with_namespace,
    url: web_url,
    status: 'pending'
  };
}

export default function webhooksSetup(
  encryptionKey: string,
  jiraAddon: *,
  expressApp: *
) {
  // start the process running to pick up any that were left over after last shutdown.
  processQueue(encryptionKey, jiraAddon);
  expressApp.post('/webhooks/:key', (req, res) => {
    res.status(200);
    try {
      const { key } = req.params;
      const secretKey = req.get('X-Gitlab-Token');
      const webhookEventType = req.body.object_kind;
      if (
        isValidWebhookType(webhookEventType) &&
        secretKey &&
        isValidSecretKey(encryptionKey, key, secretKey)
      ) {
        enqueueWebhook(encryptionKey, jiraAddon, {
          key,
          secretKey,
          body: req.body
        });
      }
      return res.send('success');
    } catch (error) {
      console.error(error);
      // Webhooks must be successful or they retry!
      return res.send('failed with error logged');
    }
  });
}
