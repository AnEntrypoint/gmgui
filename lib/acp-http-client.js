/**
 * ACP HTTP Client with comprehensive request/response logging
 */

function logACPCall(method, url, requestData, responseData, error = null) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    method,
    url,
    request: requestData,
    response: responseData,
    error: error ? error.message : null
  };
  
  console.log('[ACP-HTTP]', JSON.stringify(logEntry, null, 2));
  return logEntry;
}

export async function fetchACPProvider(baseUrl, port) {
  const url = baseUrl + ':' + port + '/provider';
  const startTime = Date.now();
  
  try {
    console.log('[ACP-HTTP] → GET ' + url);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(3000)
    });
    
    const data = response.ok ? await response.json() : null;
    const duration = Date.now() - startTime;
    
    logACPCall('GET', url, {
      headers: { 'Accept': 'application/json' },
      timeout: 3000
    }, {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body: data,
      duration_ms: duration
    });
    
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    logACPCall('GET', url, { headers: { 'Accept': 'application/json' } }, null, error);
    return { ok: false, status: 0, data: null, error: error.message };
  }
}

export async function fetchACPAgents(baseUrl) {
  const endpoint = baseUrl.endsWith('/') ? baseUrl + 'agents/search' : baseUrl + '/agents/search';
  const requestBody = {};
  const startTime = Date.now();
  
  try {
    console.log('[ACP-HTTP] → POST ' + endpoint);
    console.log('[ACP-HTTP]   Request body: ' + JSON.stringify(requestBody));
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(5000)
    });
    
    const data = response.ok ? await response.json() : null;
    const duration = Date.now() - startTime;
    
    logACPCall('POST', endpoint, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: requestBody,
      timeout: 5000
    }, {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body: data,
      duration_ms: duration
    });
    
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    logACPCall('POST', endpoint, { body: requestBody }, null, error);
    return { ok: false, status: 0, data: null, error: error.message };
  }
}

export function extractCompleteAgentData(agent) {
  return {
    id: agent.agent_id || agent.id,
    name: agent.metadata?.ref?.name || agent.name || 'Unknown Agent',
    metadata: {
      ref: {
        name: agent.metadata?.ref?.name,
        version: agent.metadata?.ref?.version,
        url: agent.metadata?.ref?.url,
        tags: agent.metadata?.ref?.tags
      },
      description: agent.metadata?.description,
      author: agent.metadata?.author,
      license: agent.metadata?.license
    },
    specs: agent.specs ? {
      capabilities: agent.specs.capabilities,
      input_schema: agent.specs.input_schema || agent.specs.input,
      output_schema: agent.specs.output_schema || agent.specs.output,
      thread_state_schema: agent.specs.thread_state_schema || agent.specs.thread_state,
      config_schema: agent.specs.config_schema || agent.specs.config,
      custom_streaming_update_schema: agent.specs.custom_streaming_update_schema || agent.specs.custom_streaming_update
    } : null,
    custom_data: agent.custom_data,
    icon: agent.metadata?.ref?.name?.charAt(0) || 'A',
    protocol: 'acp'
  };
}
