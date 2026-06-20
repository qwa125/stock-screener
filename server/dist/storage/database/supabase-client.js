"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadEnv = loadEnv;
exports.getSupabaseCredentials = getSupabaseCredentials;
exports.getSupabaseServiceRoleKey = getSupabaseServiceRoleKey;
exports.getSupabaseClient = getSupabaseClient;
const supabase_js_1 = require("@supabase/supabase-js");
const child_process_1 = require("child_process");
const coze_coding_dev_sdk_1 = require("coze-coding-dev-sdk");
let envLoaded = false;
function loadEnv() {
    if (envLoaded || (process.env.COZE_SUPABASE_URL && process.env.COZE_SUPABASE_ANON_KEY)) {
        return;
    }
    try {
        try {
            require('dotenv').config();
            if (process.env.COZE_SUPABASE_URL && process.env.COZE_SUPABASE_ANON_KEY) {
                envLoaded = true;
                return;
            }
        }
        catch {
        }
        const pythonCode = `
import os
import sys
try:
    from coze_workload_identity import Client
    client = Client()
    env_vars = client.get_project_env_vars()
    client.close()
    for env_var in env_vars:
        print(f"{env_var.key}={env_var.value}")
except Exception as e:
    print(f"# Error: {e}", file=sys.stderr)
`;
        const output = (0, child_process_1.execSync)(`python3 -c '${pythonCode.replace(/'/g, "'\"'\"'")}'`, {
            encoding: 'utf-8',
            timeout: 10000,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        const lines = output.trim().split('\n');
        for (const line of lines) {
            if (line.startsWith('#'))
                continue;
            const eqIndex = line.indexOf('=');
            if (eqIndex > 0) {
                const key = line.substring(0, eqIndex);
                let value = line.substring(eqIndex + 1);
                if ((value.startsWith("'") && value.endsWith("'")) ||
                    (value.startsWith('"') && value.endsWith('"'))) {
                    value = value.slice(1, -1);
                }
                if (!process.env[key]) {
                    process.env[key] = value;
                }
            }
        }
        envLoaded = true;
    }
    catch {
    }
}
function getSupabaseCredentials() {
    loadEnv();
    const url = process.env.COZE_SUPABASE_URL;
    const anonKey = process.env.COZE_SUPABASE_ANON_KEY || '';
    if (!url) {
        throw new Error('COZE_SUPABASE_URL is not set');
    }
    return { url, anonKey };
}
function getSupabaseServiceRoleKey() {
    loadEnv();
    return process.env.COZE_SUPABASE_SERVICE_ROLE_KEY;
}
function getSupabaseClient(token) {
    const { url, anonKey } = getSupabaseCredentials();
    let key;
    if (token) {
        key = anonKey;
    }
    else {
        const serviceRoleKey = getSupabaseServiceRoleKey();
        key = serviceRoleKey ?? anonKey;
    }
    const globalOptions = {};
    if (token) {
        globalOptions.headers = { Authorization: `Bearer ${token}` };
    }
    try {
        const buffer = (0, coze_coding_dev_sdk_1.getReportBuffer)();
        if (buffer) {
            globalOptions.fetch = (0, coze_coding_dev_sdk_1.createWrappedFetch)(buffer, 'supabase');
        }
    }
    catch {
    }
    return (0, supabase_js_1.createClient)(url, key, {
        global: globalOptions,
        db: {
            timeout: 60000,
        },
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    });
}
