const S2L = {
  's.start': 'streaming_start', 's.prog': 'streaming_progress',
  's.done': 'streaming_complete', 's.err': 'streaming_error',
  's.cancel': 'streaming_cancelled', 'conv.new': 'conversation_created',
  'conv.upd': 'conversation_updated', 'convs.upd': 'conversations_updated',
  'conv.del': 'conversation_deleted', 'msg.new': 'message_created',
  'q.stat': 'queue_status', 'q.upd': 'queue_updated',
  'rl.hit': 'rate_limit_hit', 'rl.clr': 'rate_limit_clear',
  'scr.start': 'script_started', 'scr.stop': 'script_stopped',
  'scr.out': 'script_output', 'mdl.prog': 'model_download_progress',
  'stt.prog': 'stt_progress', 'tts.prog': 'tts_setup_progress',
  'voice.ls': 'voice_list', 'sub.ok': 'subscription_confirmed',
  'term.out': 'terminal_output', 'term.exit': 'terminal_exit',
  'term.start': 'terminal_started'
};
const L2S = Object.fromEntries(Object.entries(S2L).map(([k, v]) => [v, k]));
const toLong = (s) => S2L[s] || s;
const toShort = (l) => L2S[l] || l;
if (typeof window !== 'undefined') window.wsEvents = { S2L, L2S, toLong, toShort };
export { S2L, L2S, toLong, toShort };
