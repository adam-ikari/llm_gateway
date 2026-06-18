import type { Env } from '../index';
import type { User } from '../types';
import { kvGet, kvPut, generateId } from '../utils/kv';
import { hashPassword, verifyPassword, generateApiKey, hashApiKey, sha256Hash } from '../utils/crypto';
import { indexAdd } from '../utils/kv';

export interface RegisterInput {
  email: string;
  password: string;
}

export interface RegisterResult {
  user_id: string;
  api_key: string;
  email: string;
}

export async function registerUser(env: Env, input: RegisterInput): Promise<RegisterResult> {
  // Check if email already exists
  const emailHash = await sha256Hash(input.email.toLowerCase());
  const existingUserId = await kvGet<string>(env, `email_index/${emailHash}`);
  if (existingUserId) {
    throw new AuthError('Email already registered');
  }

  const userId = generateId('usr');
  const passwordHash = await hashPassword(input.password);

  const user: User = {
    user_id: userId,
    email: input.email.toLowerCase(),
    password_hash: passwordHash,
    created_at: Date.now(),
  };

  await kvPut(env, `users/${userId}`, user);
  await kvPut(env, `email_index/${emailHash}`, userId);

  // Create initial API key
  const { full, prefix } = generateApiKey();
  const keyHash = await hashApiKey(full);
  const keyId = generateId('key');

  const keyData = {
    key_id: keyId,
    user_id: userId,
    key_hash: keyHash,
    key_prefix: prefix,
    name: 'Default',
    is_active: true,
    created_at: Date.now(),
  };

  await kvPut(env, `keys/${keyId}`, keyData);
  await indexAdd(env, `key_index/${userId}`, keyId);
  await indexAdd(env, `key_prefix_index/${prefix}`, keyId);

  return { user_id: userId, api_key: full, email: user.email };
}

export async function loginUser(env: Env, input: RegisterInput): Promise<RegisterResult> {
  const emailHash = await sha256Hash(input.email.toLowerCase());
  const userId = await kvGet<string>(env, `email_index/${emailHash}`);
  if (!userId) {
    throw new AuthError('Invalid email or password');
  }

  const user = await kvGet<User>(env, `users/${userId}`);
  if (!user) {
    throw new AuthError('Invalid email or password');
  }

  const valid = await verifyPassword(input.password, user.password_hash);
  if (!valid) {
    throw new AuthError('Invalid email or password');
  }

  // Create a new API key for this session
  const { full, prefix } = generateApiKey();
  const keyHash = await hashApiKey(full);
  const keyId = generateId('key');

  const keyData = {
    key_id: keyId,
    user_id: userId,
    key_hash: keyHash,
    key_prefix: prefix,
    name: 'Login session',
    is_active: true,
    created_at: Date.now(),
  };

  await kvPut(env, `keys/${keyId}`, keyData);
  await indexAdd(env, `key_index/${userId}`, keyId);
  await indexAdd(env, `key_prefix_index/${prefix}`, keyId);

  return { user_id: userId, api_key: full, email: user.email };
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}
