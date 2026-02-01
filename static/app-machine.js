// App state machine using XState
// Manages: agent selection, conversation loading, message sending, session tracking

import { createMachine, assign, spawn } from 'https://esm.run/xstate@5';

/**
 * App State Machine
 *
 * States:
 * - idle: Waiting for user input
 * - loadingAgents: Fetching available agents
 * - agentSelected: Agent is selected and ready
 * - sendingMessage: Message is being sent to agent
 * - waitingForResponse: Waiting for agent response via WebSocket
 * - responseReceived: Got response from agent
 * - error: Error state
 */

const appMachine = createMachine({
  id: 'gmgui-app',
  initial: 'loadingAgents',
  context: {
    agents: [],
    selectedAgent: null,
    currentConversation: null,
    conversations: new Map(),
    currentSession: null,
    sessionConnections: new Map(),
    messages: [],
    error: null,
  },
  states: {
    loadingAgents: {
      on: {
        AGENTS_LOADED: {
          target: 'idle',
          actions: assign({
            agents: (context, event) => event.agents,
          }),
        },
        AGENTS_LOAD_FAILED: {
          target: 'error',
          actions: assign({
            error: (context, event) => event.error,
          }),
        },
      },
    },
    idle: {
      on: {
        SELECT_AGENT: {
          target: 'agentSelected',
          actions: assign({
            selectedAgent: (context, event) => event.agentId,
          }),
        },
        LOAD_CONVERSATION: {
          target: 'idle',
          actions: assign({
            currentConversation: (context, event) => event.conversationId,
            selectedAgent: null, // Reset agent when switching conversations
          }),
        },
      },
    },
    agentSelected: {
      on: {
        SEND_MESSAGE: {
          target: 'sendingMessage',
        },
        CHANGE_AGENT: {
          target: 'agentSelected',
          actions: assign({
            selectedAgent: (context, event) => event.agentId,
          }),
        },
        DESELECT_AGENT: {
          target: 'idle',
          actions: assign({
            selectedAgent: null,
          }),
        },
      },
    },
    sendingMessage: {
      on: {
        MESSAGE_SENT: {
          target: 'waitingForResponse',
          actions: assign({
            messages: (context, event) => [...context.messages, event.message],
            currentSession: (context, event) => event.sessionId,
          }),
        },
        MESSAGE_SEND_FAILED: {
          target: 'agentSelected',
          actions: assign({
            error: (context, event) => event.error,
          }),
        },
      },
    },
    waitingForResponse: {
      on: {
        SESSION_UPDATE: {
          actions: assign({
            // Handle progress updates without leaving state
            messages: (context, event) => {
              const lastMsg = context.messages[context.messages.length - 1];
              if (lastMsg && lastMsg.sessionId === event.sessionId) {
                const updated = [...context.messages];
                updated[updated.length - 1] = {
                  ...lastMsg,
                  progress: event.progress,
                };
                return updated;
              }
              return context.messages;
            },
          }),
        },
        RESPONSE_COMPLETED: {
          target: 'responseReceived',
          actions: assign({
            messages: (context, event) => {
              const lastMsg = context.messages[context.messages.length - 1];
              if (lastMsg && lastMsg.sessionId === event.sessionId) {
                const updated = [...context.messages];
                updated[updated.length - 1] = event.response;
                return updated;
              }
              return context.messages;
            },
          }),
        },
        RESPONSE_FAILED: {
          target: 'responseReceived',
          actions: assign({
            messages: (context, event) => {
              const lastMsg = context.messages[context.messages.length - 1];
              if (lastMsg && lastMsg.sessionId === event.sessionId) {
                const updated = [...context.messages];
                updated[updated.length - 1] = {
                  ...lastMsg,
                  role: 'error',
                  content: `Error: ${event.error}`,
                };
                return updated;
              }
              return context.messages;
            },
            error: (context, event) => event.error,
          }),
        },
      },
    },
    responseReceived: {
      on: {
        SEND_ANOTHER: {
          target: 'sendingMessage',
        },
        CHANGE_AGENT: {
          target: 'agentSelected',
          actions: assign({
            selectedAgent: (context, event) => event.agentId,
          }),
        },
        CHANGE_CONVERSATION: {
          target: 'idle',
          actions: assign({
            currentConversation: (context, event) => event.conversationId,
            selectedAgent: null,
            messages: [],
          }),
        },
      },
    },
    error: {
      on: {
        RETRY: {
          target: 'loadingAgents',
        },
        DISMISS_ERROR: {
          target: 'idle',
          actions: assign({
            error: null,
          }),
        },
      },
    },
  },
});

export { appMachine };
