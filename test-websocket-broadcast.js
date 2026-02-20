import { WebSocketServer } from 'ws';
import http from 'http';
import path from 'path';
import os from 'os';

const PORT = 8899;
const server = http.createServer();
const wss = new WebSocketServer({ server, clientTracking: true });

let broadcastedMessages = [];
let clientConnected = false;

wss.on('connection', (ws) => {
  clientConnected = true;
  console.log('[WS] Client connected');

  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    console.log('[WS] Client sent:', msg.type);
  });

  ws.on('close', () => {
    clientConnected = false;
    console.log('[WS] Client disconnected');
  });
});

function broadcastSync(event) {
  if (wss.clients.size === 0) return;
  const data = JSON.stringify(event);
  broadcastedMessages.push(event);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(data);
    }
  }
}

function broadcastModelProgress(progress) {
  const broadcastData = {
    type: 'model_download_progress',
    modelId: progress.type || 'unknown',
    bytesDownloaded: progress.bytesDownloaded || 0,
    bytesRemaining: progress.bytesRemaining || 0,
    totalBytes: progress.totalBytes || 0,
    downloadSpeed: progress.downloadSpeed || 0,
    eta: progress.eta || 0,
    retryCount: progress.retryCount || 0,
    currentGateway: progress.currentGateway || '',
    status: progress.status || (progress.done ? 'completed' : progress.downloading ? 'downloading' : 'paused'),
    percentComplete: progress.percentComplete || 0,
    completedFiles: progress.completedFiles || 0,
    totalFiles: progress.totalFiles || 0,
    timestamp: Date.now(),
    ...progress
  };
  broadcastSync(broadcastData);
}

server.listen(PORT, () => {
  console.log(`[Server] Listening on ws://localhost:${PORT}`);

  setTimeout(() => {
    console.log('\n[Test] Simulating model download progress...\n');

    broadcastModelProgress({
      type: 'stt',
      started: true,
      downloading: true,
      completedFiles: 0,
      totalFiles: 10
    });

    setTimeout(() => {
      broadcastModelProgress({
        type: 'stt',
        bytesDownloaded: 5242880,
        bytesRemaining: 20971520,
        totalBytes: 26214400,
        downloadSpeed: 1048576,
        eta: 20,
        retryCount: 0,
        currentGateway: 'https://huggingface.co/',
        status: 'downloading',
        percentComplete: 20,
        completedFiles: 2,
        totalFiles: 10
      });

      setTimeout(() => {
        broadcastModelProgress({
          type: 'stt',
          bytesDownloaded: 15728640,
          bytesRemaining: 10485760,
          totalBytes: 26214400,
          downloadSpeed: 2097152,
          eta: 5,
          retryCount: 0,
          currentGateway: 'https://huggingface.co/',
          status: 'downloading',
          percentComplete: 60,
          completedFiles: 6,
          totalFiles: 10
        });

        setTimeout(() => {
          broadcastModelProgress({
            type: 'stt',
            started: true,
            done: true,
            downloading: false,
            completedFiles: 10,
            totalFiles: 10,
            status: 'completed'
          });

          setTimeout(() => {
            console.log('\n[Test] Broadcasting complete. Results:\n');
            console.log(`Broadcasted messages: ${broadcastedMessages.length}`);
            console.log(`Client connected: ${clientConnected}`);

            console.log('\nMessage types:');
            broadcastedMessages.forEach((msg, idx) => {
              console.log(`  [${idx + 1}] Type: ${msg.type}`);
              console.log(`      Status: ${msg.status}`);
              console.log(`      Complete: ${msg.percentComplete || msg.completedFiles}%`);
              console.log(`      Speed: ${msg.downloadSpeed ? (msg.downloadSpeed / 1024 / 1024).toFixed(2) + 'MB/s' : 'N/A'}`);
              console.log(`      ETA: ${msg.eta || 0}s`);
            });

            const requiredFields = ['modelId', 'bytesDownloaded', 'bytesRemaining', 'downloadSpeed', 'eta', 'retryCount', 'currentGateway', 'status'];
            const allFieldsPresent = broadcastedMessages.every(msg =>
              requiredFields.every(field => field in msg)
            );

            console.log(`\nAll required fields present: ${allFieldsPresent ? 'PASS' : 'FAIL'}`);
            console.log(`Message count >= 3: ${broadcastedMessages.length >= 3 ? 'PASS' : 'FAIL'}`);

            server.close(() => {
              process.exit(allFieldsPresent && broadcastedMessages.length >= 3 ? 0 : 1);
            });
          }, 500);
        }, 500);
      }, 500);
    }, 500);
  }, 500);
});
