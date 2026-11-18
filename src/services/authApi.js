import * as mockAuthApi from './mock/mockAuthApi.js';
import * as supabaseAuthApi from './supabaseAuthApi.js';
import * as supabaseVaultApi from './supabaseVaultApi.js';
import * as supabaseFilesApi from './supabaseFilesApi.js';
import * as supabaseSharingApi from './supabaseSharingApi.js';

export const USING_MOCK = import.meta.env?.VITE_USE_MOCK !== 'false';

export const authApi = USING_MOCK
  ? { ...mockAuthApi, getCurrentSession: async () => null }
  : { ...supabaseAuthApi, ...supabaseVaultApi, ...supabaseFilesApi, ...supabaseSharingApi };
