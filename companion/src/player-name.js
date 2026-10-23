'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');

// The game applies its own name rules. A request belongs to exactly one live game session.
function createPlayerNameBridge(root, host) {
  let pending = false;
  return async body => {
    if (!['validate', 'apply'].includes(body.operation) || typeof body.name !== 'string'
      || !body.name.trim() || body.name.length > 128) throw new Error('invalid_player_name');
    if (pending) throw new Error('player_name_request_pending');
    const state = host.gameState();
    if (!state.running || !state.session_id || Math.abs(Date.now() - Date.parse(state.updated_at)) > 5000
      || !Number.isFinite(Date.parse(state.updated_at))) throw new Error('game_not_running');
    pending = true;
    const id = crypto.randomUUID();
    const request = path.join(root, 'player-name-request.json');
    const temporary = request + '.' + id;
    try {
      fs.writeFileSync(temporary, JSON.stringify({ schema_version: 1, request_id: id,
        session_id: state.session_id, operation: body.operation, expected_name: state.player_name,
        requested_name: body.name.trim(), created_at: new Date().toISOString() }));
      fs.renameSync(temporary, request);
      for (let i = 0; i < 80; i++) {
        await delay(100);
        let result;
        try { result = JSON.parse(fs.readFileSync(path.join(root, 'player-name-result.json'), 'utf8')); } catch {}
        if (result?.request_id !== id || result.session_id !== state.session_id) continue;
        if (result.success && result.changed && body.operation === 'apply')
          host.migrateMemory(result.old_name, result.applied_name);
        return result;
      }
      throw new Error('player_name_timeout');
    } finally {
      pending = false;
      try { fs.unlinkSync(temporary); } catch {}
      try {
        if (JSON.parse(fs.readFileSync(request, 'utf8')).request_id === id) fs.unlinkSync(request);
      } catch {}
    }
  };
}
module.exports = { createPlayerNameBridge };
