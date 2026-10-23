// Build-time stand-in for `@llamaindex/llama-deploy`, used only by Chat UI's
// `useChatWorkflow` hook. <ai-chat-widget> talks to cv-api through its own
// handler (useApplysyChat), so the workflow client is never called (see
// vite.config.mts `resolve.alias`).

function unavailable(): Promise<never> {
  return Promise.reject(new Error('llama-deploy is not bundled in <ai-chat-widget>'));
}

export const getTasksDeploymentsDeploymentNameTasksGet = unavailable;
export const createDeploymentTaskNowaitDeploymentsDeploymentNameTasksCreatePost = unavailable;
export const sendEventDeploymentsDeploymentNameTasksTaskIdEventsPost = unavailable;
export const createConfig = (config: unknown = {}) => config;
export const createClient = () => ({});
