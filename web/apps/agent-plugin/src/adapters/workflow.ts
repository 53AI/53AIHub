import request from '../utils/request';

export interface WorkflowRunRequest {
  conversation_id: string | number;
  model: string;
  parameters: Record<string, any>;
  stream: boolean;
}

export const workflowApi = {
  run(data: WorkflowRunRequest, options?: { signal?: AbortSignal }): Promise<any> {
    return request.post('/v1/workflow/run', data, {
      signal: options?.signal,
    });
  }
};
