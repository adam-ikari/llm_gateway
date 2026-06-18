// ========== User ==========

export interface User {
  user_id: string;
  email: string;
  password_hash: string;
  created_at: number;
}

// ========== API Key ==========

export interface ApiKey {
  key_id: string;
  user_id: string;
  key_hash: string;
  key_prefix: string;
  name: string;
  is_active: boolean;
  created_at: number;
}

// ========== Endpoint ==========

export interface EndpointModel {
  name: string;
  real_model: string;
  context_window: number;
  max_output_tokens: number;
}

export interface Endpoint {
  endpoint_id: string;
  user_id: string;
  name: string;
  base_url: string;
  api_key: string;
  format: 'openai' | 'anthropic' | 'gemini';
  supported_models: EndpointModel[];
  created_at: number;
  updated_at: number;
}

// ========== Binding ==========

export interface Binding {
  key_id: string;
  model_name: string;
  endpoint_id: string;
  priority: number;
  request_types: string[];
}

// ========== Model Preset ==========

export interface ModelCapabilities {
  text: boolean;
  image: boolean;
  audio: boolean;
  video: boolean;
  file: boolean;
}

export interface ModelPreset {
  name: string;
  display_name: string;
  description: string;
  capabilities: ModelCapabilities;
  context_window: number;
  max_output_tokens: number;
  default_format: 'openai' | 'anthropic' | 'gemini';
}

// ========== Stats ==========

export interface StatsByEntity {
  requests: number;
  tokens: number;
  avg_response_time_ms: number;
  status_codes: Record<string, number>;
}

export interface Stats {
  total_requests: number;
  total_tokens: number;
  avg_response_time_ms: number;
  status_codes: Record<string, number>;
  by_key: Record<string, StatsByEntity>;
  by_model: Record<string, StatsByEntity>;
}

// ========== OpenAI-compatible types ==========

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | OpenAIContentPart[];
  name?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

export type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: string } }
  | { type: 'input_audio'; input_audio: { data: string; format: string } };

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  tools?: OpenAIToolDef[];
  tool_choice?: string | { type: string; function?: { name: string } };
}

export interface OpenAIToolDef {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface OpenAIChoice {
  index: number;
  message: {
    role: 'assistant';
    content: string | null;
    tool_calls?: OpenAIToolCall[];
  };
  finish_reason: string;
}

export interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface OpenAIResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: OpenAIChoice[];
  usage: OpenAIUsage;
}

// ========== Proxy ==========

export interface TransformedRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface RouteResult {
  endpoint: Endpoint;
  model: EndpointModel;
}

// ========== SSE Streaming ==========

export interface SSEEvent {
  event?: string;
  data: string;
}
