/**
 * TYPES.TS - Complete type definitions for the separated data and sync system
 * Guarantees type safety across CLI tests, server, and client
 * Immutable by design - all structures are readonly
 */

// ============================================================================
// CONVERSATION TYPES
// ============================================================================

export interface Conversation {
  readonly id: string;
  readonly agentId: string;
  readonly title: string | null;
  readonly created_at: number;
  readonly updated_at: number;
  readonly status: ConversationStatus;
  readonly agentType?: string;
  readonly source?: 'gui' | 'imported';
  readonly externalId?: string;
  readonly firstPrompt?: string;
  readonly messageCount?: number;
  readonly projectPath?: string;
  readonly gitBranch?: string;
  readonly sourcePath?: string;
  readonly lastSyncedAt?: number;
}

export type ConversationStatus = 'active' | 'archived' | 'deleted';

export interface ConversationCreateInput {
  agentId: string;
  title?: string | null;
}

export interface ConversationUpdateInput {
  title?: string;
  status?: ConversationStatus;
}

// ============================================================================
// MESSAGE TYPES
// ============================================================================

export interface Message {
  readonly id: string;
  readonly conversationId: string;
  readonly role: MessageRole;
  readonly content: string;
  readonly created_at: number;
}

export type MessageRole = 'user' | 'assistant' | 'system';

export interface MessageCreateInput {
  conversationId: string;
  role: MessageRole;
  content: string;
  idempotencyKey?: string;
}

// ============================================================================
// SESSION TYPES (for message processing)
// ============================================================================

export interface Session {
  readonly id: string;
  readonly conversationId: string;
  readonly status: SessionStatus;
  readonly started_at: number;
  readonly completed_at?: number;
  readonly response?: SessionResponse;
  readonly error?: string;
}

export type SessionStatus = 'pending' | 'processing' | 'completed' | 'error' | 'cancelled';

export interface SessionResponse {
  readonly text: string;
  readonly messageId: string;
}

// ============================================================================
// SYNC STATE TYPES
// ============================================================================

export type SyncState = 'idle' | 'loading' | 'synced' | 'error' | 'offline' | 'reconciling';

export interface SyncStatus {
  readonly state: SyncState;
  readonly lastSyncTime?: number;
  readonly nextRetryTime?: number;
  readonly error?: string;
  readonly retryCount: number;
  readonly maxRetries: number;
}

export interface SyncEvent {
  readonly type: SyncEventType;
  readonly timestamp: number;
  readonly data: Record<string, unknown>;
}

export type SyncEventType =
  | 'conversation_created'
  | 'conversation_updated'
  | 'conversation_deleted'
  | 'message_created'
  | 'message_updated'
  | 'message_deleted'
  | 'sync_started'
  | 'sync_completed'
  | 'sync_failed'
  | 'offline_detected'
  | 'online_detected';

// ============================================================================
// PAGINATION TYPES
// ============================================================================

export interface PaginationParams {
  readonly limit: number;
  readonly offset: number;
}

export interface PaginatedResult<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly hasMore: boolean;
}

// ============================================================================
// IDEMPOTENCY TYPES
// ============================================================================

export interface IdempotencyKey {
  readonly key: string;
  readonly value: string;
  readonly created_at: number;
  readonly ttl: number;
}

// ============================================================================
// ERROR TYPES
// ============================================================================

export class SyncError extends Error {
  constructor(
    public code: string,
    public message: string,
    public retryable: boolean = false,
    public context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'SyncError';
  }
}

export type ErrorCode =
  | 'DATABASE_ERROR'
  | 'NETWORK_ERROR'
  | 'SYNC_CONFLICT'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'TIMEOUT'
  | 'UNKNOWN';

// ============================================================================
// STATE MACHINE CONTEXT
// ============================================================================

export interface SyncMachineContext {
  readonly conversationId?: string;
  readonly messageId?: string;
  readonly lastError?: Error;
  readonly retryCount: number;
  readonly syncData: Record<string, unknown>;
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

export interface ApiResponse<T> {
  readonly data?: T;
  readonly error?: string;
  readonly timestamp: number;
}

export interface ConversationsListResponse {
  readonly conversations: readonly Conversation[];
  readonly total: number;
}

export interface MessagesListResponse {
  readonly messages: readonly Message[];
  readonly total: number;
  readonly hasMore: boolean;
}

// ============================================================================
// VALIDATION RESULT TYPES
// ============================================================================

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ValidationError[];
}

export interface ValidationError {
  readonly field: string;
  readonly message: string;
  readonly value?: unknown;
}

// ============================================================================
// CONFLICT RESOLUTION TYPES
// ============================================================================

export type ConflictResolutionStrategy = 'last-write-wins' | 'server-wins' | 'client-wins';

export interface ConflictInfo {
  readonly localVersion: unknown;
  readonly remoteVersion: unknown;
  readonly resolution: ConflictResolutionStrategy;
}

// ============================================================================
// RECOVERY TYPES
// ============================================================================

export interface RecoveryCheckpoint {
  readonly timestamp: number;
  readonly synced: boolean;
  readonly data: Record<string, unknown>;
}

export interface RecoveryState {
  readonly lastCheckpoint?: RecoveryCheckpoint;
  readonly pendingOperations: readonly unknown[];
  readonly offline: boolean;
}

// ============================================================================
// STREAMING & EXECUTION TYPES
// ============================================================================

export type ContentBlockType = 'text' | 'image' | 'tool_use' | 'tool_result' | 'document';

export interface TextBlock {
  readonly type: 'text';
  readonly text: string;
}

export interface ImageBlock {
  readonly type: 'image';
  readonly source: {
    readonly type: 'url' | 'base64';
    readonly url?: string;
    readonly media_type?: string;
    readonly data?: string;
  };
}

export interface ToolUseBlock {
  readonly type: 'tool_use';
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
}

export interface ToolResultBlock {
  readonly type: 'tool_result';
  readonly tool_use_id: string;
  readonly content: string;
  readonly is_error?: boolean;
}

export interface DocumentBlock {
  readonly type: 'document';
  readonly source: {
    readonly type: 'url' | 'base64' | 'file';
    readonly url?: string;
    readonly media_type?: string;
    readonly data?: string;
  };
}

export type ContentBlock = TextBlock | ImageBlock | ToolUseBlock | ToolResultBlock | DocumentBlock;

export interface ClaudeMessage {
  readonly id: string;
  readonly type: 'message';
  readonly role: 'user' | 'assistant';
  readonly content: readonly ContentBlock[];
  readonly model?: string;
  readonly stop_reason?: 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence';
  readonly stop_sequence?: string;
  readonly usage?: {
    readonly input_tokens: number;
    readonly output_tokens: number;
  };
}

export interface ExecutionMetadata {
  readonly sessionId: string;
  readonly conversationId: string;
  readonly agentId: string;
  readonly startTime: number;
  readonly endTime?: number;
  readonly duration?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly toolCalls: number;
  readonly toolResults: number;
  readonly errorCount: number;
  readonly status: 'running' | 'completed' | 'error' | 'timeout' | 'interrupted';
  readonly errorMessage?: string;
}

export type StreamingEventType =
  | 'streaming_start'
  | 'content_block_start'
  | 'content_block_delta'
  | 'content_block_stop'
  | 'message_start'
  | 'message_delta'
  | 'message_stop'
  | 'streaming_error'
  | 'streaming_complete';

export interface StreamingEvent {
  readonly type: StreamingEventType;
  readonly timestamp: number;
  readonly sessionId: string;
  readonly conversationId: string;
  readonly data: Record<string, unknown>;
  readonly eventId?: string;
  readonly retryable?: boolean;
}

export interface StreamingStartEvent extends StreamingEvent {
  readonly type: 'streaming_start';
  readonly data: {
    readonly sessionId: string;
    readonly messageId: string;
    readonly agentId: string;
  };
}

export interface ContentBlockStartEvent extends StreamingEvent {
  readonly type: 'content_block_start';
  readonly data: {
    readonly index: number;
    readonly blockType: ContentBlockType;
  };
}

export interface ContentBlockDeltaEvent extends StreamingEvent {
  readonly type: 'content_block_delta';
  readonly data: {
    readonly index: number;
    readonly delta: {
      readonly type: 'text_delta' | 'input_json_delta';
      readonly text?: string;
      readonly partial_json?: string;
    };
  };
}

export interface ContentBlockStopEvent extends StreamingEvent {
  readonly type: 'content_block_stop';
  readonly data: {
    readonly index: number;
  };
}

export interface MessageStopEvent extends StreamingEvent {
  readonly type: 'message_stop';
  readonly data: {
    readonly messageId: string;
    readonly stopReason: string;
    readonly usage: {
      readonly inputTokens: number;
      readonly outputTokens: number;
    };
  };
}

export interface StreamingCompleteEvent extends StreamingEvent {
  readonly type: 'streaming_complete';
  readonly data: {
    readonly sessionId: string;
    readonly messageId: string;
    readonly eventCount: number;
    readonly totalDuration: number;
    readonly metadata: ExecutionMetadata;
  };
}

export interface StreamingErrorEvent extends StreamingEvent {
  readonly type: 'streaming_error';
  readonly data: {
    readonly sessionId: string;
    readonly error: string;
    readonly code?: string;
    readonly recoverable: boolean;
  };
}
