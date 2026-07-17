import service from "../../config";
import { handleError } from "../../errorHandler";
import type {
  OpenClawSession,
  OpenClawPaginationParams,
  ConversationControlParams as OpenClawControlParams,
} from "@km/shared-business/chat";

export type { OpenClawSession, OpenClawControlParams };

function buildPaginationParams(params: OpenClawPaginationParams = {}) {
  const query: Record<string, number> = {};
  if (typeof params.limit === "number" && params.limit > 0) {
    query.limit = params.limit;
  }
  if (typeof params.offset === "number" && params.offset > 0) {
    query.offset = params.offset;
  }
  if (params.fresh) {
    query.fresh = 1;
  }
  return query;
}

export const openclawApi = {
  conversations(agentId: string | number, params: OpenClawPaginationParams = {}) {
    return service
      .get(`/api/openclaw/agents/${agentId}/conversations`, {
        params: buildPaginationParams(params),
        requiresAuth: true,
      })
      .catch(handleError);
  },

  currentConversation(agentId: string | number, options?: { ignoreMessage?: boolean; fresh?: boolean }) {
    return service
      .get(`/api/openclaw/agents/${agentId}/conversations/current`, {
        params: options?.fresh ? { fresh: 1 } : undefined,
        requiresAuth: true,
      })
      .catch((error) => handleError(error, { ignoreMessage: options?.ignoreMessage }));
  },

  messages(agentId: string | number, conversationId: string, params: OpenClawPaginationParams = {}) {
    return service
      .get(
        `/api/openclaw/agents/${agentId}/conversations/${encodeURIComponent(conversationId)}/messages`,
        {
          params: buildPaginationParams(params),
          requiresAuth: true,
        }
      )
      .catch(handleError);
  },

  events(agentId: string | number, conversationId: string, params: OpenClawPaginationParams & { after_seq?: number } = {}) {
    return service
      .get(
        `/api/openclaw/agents/${agentId}/conversations/${encodeURIComponent(conversationId)}/events`,
        {
          params: {
            ...buildPaginationParams(params),
            ...(typeof params.after_seq === "number" && params.after_seq > 0 ? { after_seq: params.after_seq } : {}),
          },
          requiresAuth: true,
        }
      )
      .catch(handleError);
  },

  snapshot(agentId: string | number, conversationId: string, params: { after_seq?: number; fresh?: boolean } = {}) {
    return service
      .get(
        `/api/openclaw/agents/${agentId}/conversations/${encodeURIComponent(conversationId)}/snapshot`,
        {
          params: {
            ...(params.fresh ? { fresh: 1 } : {}),
            ...(typeof params.after_seq === "number" && params.after_seq > 0 ? { after_seq: params.after_seq } : {}),
          },
          requiresAuth: true,
        }
      )
      .catch(handleError);
  },

  control(agentId: string | number, conversationId: string, params: OpenClawControlParams) {
    return service
      .post(
        `/api/openclaw/agents/${agentId}/conversations/${encodeURIComponent(conversationId)}/control`,
        params,
        { requiresAuth: true }
      )
      .catch(handleError);
  },

  status(agentId: string | number, options?: { ignoreMessage?: boolean }) {
    return service
      .get(`/api/openclaw/agents/${agentId}/status`, { requiresAuth: true })
      .catch((error) => handleError(error, { ignoreMessage: options?.ignoreMessage }));
  },

  config(agentId: string | number, options?: { ignoreMessage?: boolean }) {
    return service
      .get(`/api/openclaw/agents/${agentId}/config`, { requiresAuth: true })
      .catch((error) => handleError(error, { ignoreMessage: options?.ignoreMessage }));
  },

  skills(agentId: string | number, options?: { ignoreMessage?: boolean }) {
    return service
      .get(`/api/openclaw/agents/${agentId}/skills`, { requiresAuth: true })
      .catch((error) => handleError(error, { ignoreMessage: options?.ignoreMessage }));
  },

  ensureSkill(agentId: string | number, skillId: string | number) {
    return service
      .post(`/api/openclaw/agents/${agentId}/skills/${encodeURIComponent(String(skillId))}/ensure`, {}, { requiresAuth: true })
      .catch(handleError);
  },

  cronTasks(agentId: string | number, params: OpenClawPaginationParams = {}, options?: { ignoreMessage?: boolean }) {
    return service
      .get(`/api/openclaw/agents/${agentId}/cron-tasks`, {
        params: buildPaginationParams(params),
        requiresAuth: true,
      })
      .catch((error) => handleError(error, { ignoreMessage: options?.ignoreMessage }));
  },
};

export default openclawApi;
