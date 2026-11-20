import { redis } from './redis.js';

const createSessionScript = `
-- CREATE_SESSION_CACHE
local authState = redis.call('GET', KEYS[3])
if authState and authState ~= 'ACTIVE' then return 0 end
if not authState then redis.call('SET', KEYS[3], 'ACTIVE') end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
redis.call('SADD', KEYS[2], ARGV[3])
redis.call('EXPIRE', KEYS[2], ARGV[2])
return 1
`;

const validateSessionScript = `
-- VALIDATE_SESSION_CACHE
local session = redis.call('GET', KEYS[1])
if not session then return false end
local data = cjson.decode(session)
if redis.call('GET', 'user-auth-state:' .. data.userId) ~= 'ACTIVE' then return false end
return session
`;

const blockUserScript = `
-- BLOCK_USER_SESSIONS
local state = redis.call('GET', KEYS[1])
if state == 'ACTIVE' or not state then
  redis.call('SET', KEYS[1], 'DISABLING:' .. ARGV[1])
  return 'owner'
end
if string.sub(state, 1, 10) == 'DISABLING:' then return 'busy' end
return 'blocked'
`;

const releaseUserBlockScript = `
-- RELEASE_USER_BLOCK
if redis.call('GET', KEYS[1]) == 'DISABLING:' .. ARGV[1] then
  redis.call('SET', KEYS[1], 'ACTIVE')
  return 1
end
return 0
`;

const revokeUserSessionsScript = `
-- REVOKE_USER_SESSIONS
local state = redis.call('GET', KEYS[1])
if ARGV[1] == 'INACTIVE' then
  redis.call('SET', KEYS[1], 'INACTIVE')
elseif state and string.sub(state, 1, 10) == 'DISABLING:' then
  if ARGV[2] and state == 'DISABLING:' .. ARGV[2] then
    redis.call('SET', KEYS[1], 'ACTIVE')
  end
else
  redis.call('SET', KEYS[1], ARGV[1])
end
local hashes = redis.call('SMEMBERS', KEYS[2])
for _, hash in ipairs(hashes) do
  redis.call('DEL', 'session:' .. hash)
end
redis.call('DEL', KEYS[2])
return #hashes
`;

const revokeSessionScript = `
-- REVOKE_SINGLE_SESSION
redis.call('DEL', KEYS[1])
redis.call('SREM', KEYS[2], ARGV[1])
return 1
`;

export async function cacheSession({ userId, tokenHash, session, ttlSeconds }) {
  return redis.eval(createSessionScript, {
    keys: [`session:${tokenHash}`, `user-sessions:${userId}`, `user-auth-state:${userId}`],
    arguments: [JSON.stringify(session), String(ttlSeconds), tokenHash]
  });
}

export async function getAuthenticatedSession(tokenHash) {
  return redis.eval(validateSessionScript, {
    keys: [`session:${tokenHash}`],
    arguments: []
  });
}

export async function blockUserSessions(userId, operationId) {
  return redis.eval(blockUserScript, {
    keys: [`user-auth-state:${userId}`],
    arguments: [operationId]
  });
}

export async function releaseUserSessionBlock(userId, operationId) {
  return redis.eval(releaseUserBlockScript, {
    keys: [`user-auth-state:${userId}`],
    arguments: [operationId]
  });
}

export async function revokeUserSessionsInRedis(userId, authState, blockOperationId) {
  return redis.eval(revokeUserSessionsScript, {
    keys: [`user-auth-state:${userId}`, `user-sessions:${userId}`],
    arguments: [authState, blockOperationId ?? '']
  });
}

export async function revokeSessionInRedis(userId, tokenHash) {
  return redis.eval(revokeSessionScript, {
    keys: [`session:${tokenHash}`, `user-sessions:${userId}`],
    arguments: [tokenHash]
  });
}
