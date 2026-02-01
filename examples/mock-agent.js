#!/usr/bin/env node
/**
 * Mock ACP Agent Server
 * Simulates an ACP agent endpoint for testing gmgui
 * 
 * Usage:
 *   node mock-agent.js --port 3001
 */

import http from 'http';
import { WebSocketServer } from 'ws';
import { pack, unpack } from 'msgpackr';
import { parseArgs } from 'util';

const { values } = parseArgs({
  options: {
    port: { type: 'string', short: 'p', default: '3001' },
    name: { type: 'string', short: 'n', default: 'Mock Agent' },
  },
});

const PORT = parseInt(values.port);
const AGENT_NAME = values.name;

class MockAgent {
  constructor(port, name) {
    this.port = port;
    this.name = name;
    this.clients = [];
    this.messageCount = 0;
  }

  log(level, message, data = '') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}${data ? ` ${data}` : ''}`);
  }

  start() {
    const server = http.createServer();
    const wss = new WebSocketServer({ server });

    wss.on('connection', (ws) => {
      this.log('success', 'New client connected');
      this.clients.push(ws);

      // Send welcome message
      this.sendMessage(ws, {
        type: 'welcome',
        agent: this.name,
        version: '1.0.0',
        capabilities: ['chat', 'code-execution', 'file-operations'],
      });

      ws.on('message', (data) => {
        try {
          const message = unpack(new Uint8Array(data));
          this.handleMessage(ws, message);
        } catch (e) {
          this.log('error', 'Failed to parse message', e.message);
        }
      });

      ws.on('close', () => {
        const idx = this.clients.indexOf(ws);
        if (idx > -1) this.clients.splice(idx, 1);
        this.log('warning', 'Client disconnected');
      });

      ws.on('error', (error) => {
        this.log('error', 'WebSocket error', error.message);
      });
    });

    server.listen(this.port, () => {
      this.log('info', `${this.name} listening on port ${this.port}`);
      this.log('info', `Connect with: node agent-client.js --endpoint ws://localhost:${this.port}`);
    });

    // Simulate agent activity
    this.simulateActivity();
  }

  handleMessage(ws, message) {
    this.log('info', `Received message type: ${message.type}`);

    if (message.type === 'client_message') {
      this.log('info', `Client message: ${message.content}`);
      
      // Simulate processing and response
      setTimeout(() => {
        this.sendMessage(ws, {
          type: 'response',
          content: `Agent processed: "${message.content}"`,
          clientId: message.clientId,
          processed: true,
        });
      }, 500);
    }
  }

  sendMessage(ws, message) {
    try {
      message.timestamp = Date.now();
      ws.send(pack(message));
      this.messageCount++;
    } catch (error) {
      this.log('error', 'Failed to send message', error.message);
    }
  }

  simulateActivity() {
    const activities = [
      { type: 'status', status: 'idle' },
      { type: 'status', status: 'processing' },
      { type: 'metric', metric: 'cpu_usage', value: Math.random() * 100 },
      { type: 'metric', metric: 'memory_usage', value: Math.random() * 100 },
      { type: 'log', level: 'info', message: 'Agent running normally' },
    ];

    setInterval(() => {
      const activity = activities[Math.floor(Math.random() * activities.length)];
      this.clients.forEach(ws => {
        if (ws.readyState === 1) {
          this.sendMessage(ws, activity);
        }
      });
    }, 5000);
  }
}

const agent = new MockAgent(PORT, AGENT_NAME);
agent.start();

// Graceful shutdown
process.on('SIGTERM', () => {
  agent.log('warning', 'Shutting down...');
  process.exit(0);
});
