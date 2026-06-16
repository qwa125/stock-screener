import { SupabaseClient } from '@supabase/supabase-js';
interface SupabaseCredentials {
    url: string;
    anonKey: string;
}
declare function loadEnv(): void;
declare function getSupabaseCredentials(): SupabaseCredentials;
declare function getSupabaseServiceRoleKey(): string | undefined;
declare function getSupabaseClient(token?: string): SupabaseClient;
export { loadEnv, getSupabaseCredentials, getSupabaseServiceRoleKey, getSupabaseClient };
