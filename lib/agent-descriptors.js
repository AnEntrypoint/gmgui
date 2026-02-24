const agentDescriptorCache = new Map();

function generateClaudeCodeDescriptor(agent) {
  return {
    metadata: {
      ref: {
        name: agent.name,
        version: '1.0.0',
        url: agent.path
      },
      description: 'Claude Code is an AI coding agent that can read, write, and execute code with streaming output support. It provides comprehensive code editing, file management, and terminal execution capabilities.'
    },
    specs: {
      capabilities: {
        threads: true,
        interrupts: false,
        callbacks: false,
        streaming: {
          values: false,
          custom: true
        }
      },
      input: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'The user prompt or instruction to send to the agent'
          },
          model: {
            type: 'string',
            description: 'Optional model identifier to use for this run'
          }
        },
        required: ['content']
      },
      output: {
        type: 'object',
        properties: {
          result: {
            type: 'string',
            description: 'The final response or result from the agent'
          },
          events: {
            type: 'array',
            description: 'Stream of execution events (tool calls, outputs, etc.)',
            items: { type: 'object' }
          }
        }
      },
      custom_streaming_update: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['text', 'tool_use', 'tool_result', 'error']
          },
          data: { type: 'object' }
        }
      },
      thread_state: {
        type: 'object',
        description: 'Conversation history with messages and session state',
        properties: {
          messages: {
            type: 'array',
            items: { type: 'object' }
          },
          sessionId: { type: 'string' }
        }
      },
      config: {
        type: 'object',
        properties: {
          workingDirectory: {
            type: 'string',
            description: 'Working directory for file operations'
          },
          model: {
            type: 'string',
            description: 'Default model to use'
          }
        }
      }
    }
  };
}

function generateGeminiDescriptor(agent) {
  return {
    metadata: {
      ref: {
        name: agent.name,
        version: '1.0.0',
        url: agent.path
      },
      description: 'Gemini CLI is Google AI coding agent with streaming support, code execution, and file management capabilities.'
    },
    specs: {
      capabilities: {
        threads: true,
        interrupts: false,
        callbacks: false,
        streaming: {
          values: false,
          custom: true
        }
      },
      input: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'The user prompt or instruction to send to the agent'
          },
          model: {
            type: 'string',
            description: 'Optional model identifier to use for this run'
          }
        },
        required: ['content']
      },
      output: {
        type: 'object',
        properties: {
          result: {
            type: 'string',
            description: 'The final response or result from the agent'
          },
          events: {
            type: 'array',
            description: 'Stream of execution events',
            items: { type: 'object' }
          }
        }
      },
      custom_streaming_update: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          data: { type: 'object' }
        }
      },
      thread_state: {
        type: 'object',
        description: 'Conversation history and session state',
        properties: {
          messages: {
            type: 'array',
            items: { type: 'object' }
          }
        }
      },
      config: {
        type: 'object',
        properties: {
          workingDirectory: {
            type: 'string',
            description: 'Working directory for file operations'
          },
          model: {
            type: 'string',
            description: 'Model identifier'
          }
        }
      }
    }
  };
}

function generateOpenCodeDescriptor(agent) {
  return {
    metadata: {
      ref: {
        name: agent.name,
        version: '1.0.0',
        url: agent.path
      },
      description: 'OpenCode is a multi-provider AI coding agent with streaming support and comprehensive code manipulation capabilities.'
    },
    specs: {
      capabilities: {
        threads: true,
        interrupts: false,
        callbacks: false,
        streaming: {
          values: false,
          custom: true
        }
      },
      input: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'The user prompt or instruction'
          },
          model: {
            type: 'string',
            description: 'Model identifier'
          }
        },
        required: ['content']
      },
      output: {
        type: 'object',
        properties: {
          result: { type: 'string' },
          events: {
            type: 'array',
            items: { type: 'object' }
          }
        }
      },
      custom_streaming_update: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          data: { type: 'object' }
        }
      },
      thread_state: {
        type: 'object',
        properties: {
          messages: {
            type: 'array',
            items: { type: 'object' }
          }
        }
      },
      config: {
        type: 'object',
        properties: {
          workingDirectory: { type: 'string' },
          model: { type: 'string' }
        }
      }
    }
  };
}

function generateGenericDescriptor(agent) {
  return {
    metadata: {
      ref: {
        name: agent.name,
        version: '1.0.0',
        url: agent.path
      },
      description: `${agent.name} is an AI coding agent with basic streaming and execution capabilities.`
    },
    specs: {
      capabilities: {
        threads: true,
        interrupts: false,
        callbacks: false,
        streaming: {
          values: false,
          custom: true
        }
      },
      input: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'User prompt or instruction'
          }
        },
        required: ['content']
      },
      output: {
        type: 'object',
        properties: {
          result: { type: 'string' }
        }
      },
      custom_streaming_update: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          data: { type: 'object' }
        }
      },
      thread_state: {
        type: 'object',
        properties: {
          messages: {
            type: 'array',
            items: { type: 'object' }
          }
        }
      },
      config: {
        type: 'object',
        properties: {
          workingDirectory: { type: 'string' }
        }
      }
    }
  };
}

function generateAgentDescriptor(agent) {
  switch (agent.id) {
    case 'claude-code':
      return generateClaudeCodeDescriptor(agent);
    case 'gemini':
      return generateGeminiDescriptor(agent);
    case 'opencode':
      return generateOpenCodeDescriptor(agent);
    default:
      return generateGenericDescriptor(agent);
  }
}

export function initializeDescriptors(agents) {
  agentDescriptorCache.clear();
  for (const agent of agents) {
    const descriptor = generateAgentDescriptor(agent);
    agentDescriptorCache.set(agent.id, descriptor);
  }
  return agentDescriptorCache.size;
}

export function getAgentDescriptor(agentId) {
  return agentDescriptorCache.get(agentId) || null;
}

export function getAllDescriptors() {
  return Object.fromEntries(agentDescriptorCache);
}
