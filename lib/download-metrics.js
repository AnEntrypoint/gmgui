import fs from 'fs';
import path from 'path';
import os from 'os';

const METRICS_PATH = path.join(os.homedir(), '.gmgui', 'models', '.metrics.json');

export function recordMetric(metric) {
  const metricsDir = path.dirname(METRICS_PATH);
  if (!fs.existsSync(metricsDir)) {
    fs.mkdirSync(metricsDir, { recursive: true });
  }

  let metrics = [];
  if (fs.existsSync(METRICS_PATH)) {
    try {
      metrics = JSON.parse(fs.readFileSync(METRICS_PATH, 'utf8'));
    } catch (e) {
      metrics = [];
    }
  }

  metrics.push({
    ...metric,
    timestamp: new Date().toISOString()
  });

  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  metrics = metrics.filter(m => new Date(m.timestamp).getTime() > oneDayAgo);

  fs.writeFileSync(METRICS_PATH, JSON.stringify(metrics, null, 2));
}

export function getMetrics() {
  if (!fs.existsSync(METRICS_PATH)) {
    return [];
  }
  return JSON.parse(fs.readFileSync(METRICS_PATH, 'utf8'));
}

export function getMetricsSummary() {
  const metrics = getMetrics();

  const summary = {
    total: metrics.length,
    cache_hits: metrics.filter(m => m.layer === 'cache' && m.status === 'hit').length,
    huggingface: {
      success: metrics.filter(m => m.layer === 'huggingface' && m.status === 'success').length,
      error: metrics.filter(m => m.layer === 'huggingface' && m.status === 'error').length,
      avg_latency: 0
    }
  };

  const hfSuccess = metrics.filter(m => m.layer === 'huggingface' && m.status === 'success');
  if (hfSuccess.length > 0) {
    summary.huggingface.avg_latency = Math.round(
      hfSuccess.reduce((sum, m) => sum + m.latency_ms, 0) / hfSuccess.length
    );
  }

  return summary;
}

export function resetMetrics() {
  if (fs.existsSync(METRICS_PATH)) {
    fs.unlinkSync(METRICS_PATH);
  }
}
