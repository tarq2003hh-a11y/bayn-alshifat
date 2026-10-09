/**
 * بين الشفتات - إعدادات وتهيئة عميل Supabase
 * Bayn Al-Shifat - Supabase Client Configuration
 */

// المفاتيح الافتراضية يمكن حقنها في البيئة أو إدخالها من نافذة الإعداد
const DEFAULT_CONFIG = {
  url: window.ENV_SUPABASE_URL || '',
  anonKey: window.ENV_SUPABASE_ANON_KEY || ''
};

const CONFIG_STORAGE_KEY = 'bayn_supabase_config_v1';

class SupabaseConfigManager {
  constructor() {
    this.config = this.loadConfig();
    this.client = null;
    this.initClient();
  }

  loadConfig() {
    try {
      const stored = localStorage.getItem(CONFIG_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.url && parsed.anonKey) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Error reading stored Supabase config:', e);
    }
    return { ...DEFAULT_CONFIG };
  }

  saveConfig(url, anonKey) {
    const cleanUrl = (url || '').trim().replace(/\/+$/, '');
    const cleanKey = (anonKey || '').trim();

    if (!cleanUrl.startsWith('https://')) {
      throw new Error('رابط Supabase يجب أن يبدأ بـ https://');
    }
    if (!cleanKey || cleanKey.length < 20) {
      throw new Error('مفتاح anon key غير صحيح أو قصير جداً');
    }

    this.config = { url: cleanUrl, anonKey: cleanKey };
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(this.config));
    this.initClient();
    return true;
  }

  clearConfig() {
    localStorage.removeItem(CONFIG_STORAGE_KEY);
    this.config = { ...DEFAULT_CONFIG };
    this.client = null;
  }

  isConfigured() {
    return Boolean(this.config.url && this.config.anonKey);
  }

  initClient() {
    if (!this.isConfigured()) {
      this.client = null;
      return null;
    }

    if (window.supabase && typeof window.supabase.createClient === 'function') {
      try {
        this.client = window.supabase.createClient(this.config.url, this.config.anonKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
          }
        });
        return this.client;
      } catch (err) {
        console.error('Failed to initialize Supabase client:', err);
        this.client = null;
      }
    }
    return null;
  }

  getClient() {
    if (!this.client) {
      this.initClient();
    }
    return this.client;
  }
}

window.supabaseConfig = new SupabaseConfigManager();
