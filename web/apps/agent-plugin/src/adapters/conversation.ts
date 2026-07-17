import type { IConversationApi, ChatCompletionParams } from "@km/shared-business";
import request from "../utils/request";
import { getCurrentAccessToken } from "../stores/user";
import axios from "axios";

export const agentConversationApi: IConversationApi = {
  create(
    agentId: string,
    question: string,
    title?: string,
    type?: string
  ): Promise<any> {
    return request.post("/api/conversations", {
      agent_id: agentId,
      title: title || question,
      conversation_type: type ? Number(type) : 0,
    });
  },

  list(
    agentId: string,
    params?: { conversation_type?: string; offset?: number; limit?: number }
  ): Promise<any> {
    return request.get("/api/conversations", {
      params: { agent_id: agentId, ...params },
    });
  },

  messages(
    conversationId: string,
    params?: { offset?: number; limit?: number }
  ): Promise<any> {
    return request.get(`/api/conversations/${conversationId}/messages`, {
      params,
    });
  },

  edit(conversationId: string | number, data: { title: string }): Promise<any> {
    return request.put(`/api/conversations/${conversationId}`, data);
  },

  del(conversationId: string | number): Promise<any> {
    return request.delete(`/api/conversations/${conversationId}`);
  },

  async completions(
    params: ChatCompletionParams,
    options: {
      responseType: "stream";
      onDownloadProgress: (e: any) => void;
      signal?: AbortSignal;
    }
  ): Promise<any> {
    const token = getCurrentAccessToken();

    const response = await axios.request({
      method: "POST",
      url: "/v1/chat/completions",
      baseURL: request.defaults.baseURL,
      data: { ...params, source: "h5" },
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      responseType: "stream",
      onDownloadProgress: options.onDownloadProgress,
      signal: options.signal,
    });

    return response.data;
  },
};