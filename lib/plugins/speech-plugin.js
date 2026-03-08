// Speech plugin - STT/TTS model management, download on startup

import path from 'path';

export default {
  name: 'speech',
  version: '1.0.0',
  dependencies: ['database'],

  async init(config, plugins) {
    const modelsDir = path.join(process.env.HOME || '/tmp', '.gmgui', 'models');
    let modelsReady = false;
    const downloadProgress = new Map();
    let voiceList = [];
    const modelCache = new Map();

    // Models would be downloaded here on startup
    modelsReady = true;
    voiceList = ['en-US', 'en-GB', 'es-ES', 'fr-FR', 'de-DE'];

    return {
      routes: [
        {
          method: 'POST',
          path: '/api/stt',
          handler: async (req, res) => {
            if (!modelsReady) return res.status(503).json({ error: 'Models loading' });
            res.json({ text: 'transcription-not-implemented' });
          },
        },
        {
          method: 'POST',
          path: '/api/tts',
          handler: async (req, res) => {
            if (!modelsReady) return res.status(503).json({ error: 'Models loading' });
            const { text } = req.body;
            res.json({ audio: 'base64-audio-not-implemented' });
          },
        },
        {
          method: 'GET',
          path: '/api/speech-status',
          handler: (req, res) => {
            res.json({ ready: modelsReady, progress: Object.fromEntries(downloadProgress) });
          },
        },
        {
          method: 'GET',
          path: '/api/voices',
          handler: (req, res) => {
            res.json({ voices: voiceList });
          },
        },
      ],
      wsHandlers: {
        model_download_progress: (data, clients) => {},
        voice_list: (data, clients) => {},
      },
      api: {
        getVoices: () => voiceList,
        isReady: () => modelsReady,
      },
      stop: async () => {},
    };
  },

  async reload(state) {
    return state;
  },

  async stop() {},
};
