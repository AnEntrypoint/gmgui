#!/usr/bin/env node
/**
 * Example ACP Agent Client for GMGUI
 * Connects a Claude Agent Protocol client to gmgui server
 * 
 * Usage:
 *   node agent-client.js --id my-agent --gui http://localhost:3000 --endpoint ws://localhost:3001
 */

import WebSocket from 'ws';
import { pack, unpack } from 'msgpackr';
import { parseArgs } from 'util';

const { values } = parseArgs({
  options: {
    id: { type: 'string', short: 'i' },
    gui: { type: 'string', short: 'g', default: 'http://localhost:3000' },
    endpoint: { type: 'string', short: 'e', default: 'ws://localhost:3001' },
    verbose: { type: 'boolean', short: 'v', default: false },
  },
});

const AGENT_ID = values.id || `agent-${Date.now()}`;
const GUI_SERVER = values.gui;
const AGENT_ENDPOINT = values.endpoint;
const VERBOSE = values.verbose;

class ACPAgentClient {
  constructor(agentId, guiServer, agentEndpoint) {
    this.agentId = agentId;
    this.guiServer = guiServer;
    this.agentEndpoint = agentEndpoint;
    this.guiWs = null;
    this.agentWs = null;
    this.messageQueue = [];
    this.connected = false;
  }

  log(level, message, data = '') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}${data ? ` ${data}` : ''}`);
  }

  async connect() {
    try {
      // Connect to gmgui server
      const guiUrl = `ws://${this.guiServer.replace(/^https?:\/\//, '')}/agent/${this.agentId}`;
      this.log('info', `Connecting to gmgui at ${guiUrl}`);

      this.guiWs = new WebSocket(guiUrl);
      this.guiWs.binaryType = 'arraybuffer';

      this.guiWs.onopen = () => {
        this.log('success', `Connected to gmgui`);
        this.connected = true;
        this.flushQueue();
      };

      this.guiWs.onmessage = (event) => {
        try {
          const message = typeof event.data === 'string' 
            ? JSON.parse(event.data) 
            : unpack(new Uint8Array(event.data));
          this.handleGuiMessage(message);
        } catch (e) {
          this.log('error', 'Failed to parse message from gmgui', e.message);
        }
      };

      this.guiWs.onerror = (error) => {
        this.log('error', 'GUI WebSocket error', error.message);
      };

      this.guiWs.onclose = () => {
        this.log('warning', 'Disconnected from gmgui');
        this.connected = false;
        // Reconnect after 3 seconds
        setTimeout(() => this.connect(), 3000);
      };

      // Connect to ACP agent endpoint
      if (this.agentEndpoint) {
        this.connectToAgent();
      }
    } catch (error) {
      this.log('error', 'Connection failed', error.message);
      setTimeout(() => this.connect(), 5000);
    }
  }

  connectToAgent() {
    try {
      this.log('info', `Connecting to agent at ${this.agentEndpoint}`);
      
      this.agentWs = new WebSocket(this.agentEndpoint);
      this.agentWs.binaryType = 'arraybuffer';

      this.agentWs.onopen = () => {
        this.log('success', `Connected to agent endpoint`);
        this.sendToGui({
          type: 'status',
          status: 'agent_connected',
          endpoint: this.agentEndpoint,
        });
      };

      this.agentWs.onmessage = (event) => {
        try {
          const message = typeof event.data === 'string'
            ? JSON.parse(event.data)
            : unpack(new Uint8Array(event.data));
          this.sendToGui({
            type: 'agent_message',
            message,
            agentEndpoint: this.agentEndpoint,
          });
        } catch (e) {
          this.log('error', 'Failed to parse agent message', e.message);
        }
      };

      this.agentWs.onerror = (error) => {
        this.log('error', 'Agent WebSocket error', error.message);
      };

      this.agentWs.onclose = () => {
        this.log('warning', 'Disconnected from agent');
        this.sendToGui({
          type: 'status',
          status: 'agent_disconnected',
        });
      };
    } catch (error) {
      this.log('error', 'Agent connection failed', error.message);
    }
  }

  handleGuiMessage(message) {
    if (VERBOSE) {
      this.log('debug', 'Message from GUI', JSON.stringify(message).substring(0, 100));
    }

    if (message.type === 'message') {
      this.log('info', 'GUI message', message.content);
      
      // Forward to agent if connected
      if (this.agentWs && this.agentWs.readyState === WebSocket.OPEN) {
        this.agentWs.send(pack({
          type: 'client_message',
          content: message.content,
          clientId: this.agentId,
          timestamp: message.timestamp,
        }));
      }
    }
  }

  sendToGui(message) {
    if (!this.connected) {
      this.messageQueue.push(message);
      return;
    }

    try {
      message.agentId = this.agentId;
      message.timestamp = Date.now();

      if (this.guiWs && this.guiWs.readyState === WebSocket.OPEN) {
        this.guiWs.send(pack(message));
      }
    } catch (error) {
      this.log('error', 'Failed to send to GUI', error.message);
    }
  }

  flushQueue() {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      this.sendToGui(message);
    }
  }

  async run() {
    this.log('info', `Starting ACP agent client`);
    this.log('info', `Agent ID: ${this.agentId}`);
    this.log('info', `GUI Server: ${this.guiServer}`);
    this.log('info', `Agent Endpoint: ${this.agentEndpoint}`);

    this.connect();

    // Keep running
    await new Promise(() => {});
  }
}

const client = new ACPAgentClient(AGENT_ID, GUI_SERVER, AGENT_ENDPOINT);
client.run().catch(console.error);
