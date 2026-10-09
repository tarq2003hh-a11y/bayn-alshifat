/**
 * بين الشفتات - إعدادات وتهيئة عميل Supabase
 * Bayn Al-Shifat - Supabase Client Configuration
 */

// الرابط الأساسي الصافي لمشروع Supabase (بدون أي مسارات مثل /rest/v1 أو /auth/v1)
// ومفتاح anon العام المحمي بسياسات RLS
const DEFAULT_CONFIG = {
  url: 'https://dbpxpblwzpabfwqayxhb.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRicHhwYmx3enBhYmZ3cWF5eGhiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1NDAxNjMsImV4cCI6MjEwNzExNjE2M30.1WBuxu2qWHvb23JeZ0T6hQ8du44L33XWk88UOzWqlq4'
};

const CONFIG_STORAGE_KEY = 'bayn_supabase_config_v2'; // استخدام مفتاح v2 لتجاوز أي قيم قديمة خاطئة في المتصفح

// دالة لتنظيف وتجريد الرابط من أي مسارات إضافية تسبب خطأ PGRST125 (Invalid path specified in request URL)
function cleanSupabaseUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  try {
    const parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    // استخراج الأصل فقط (Origin) مثل: https://xxxx.supabase.co
    return parsed.origin;
  } catch (e) {
    // إزالة أي مسارات يدوية في حال تعذر التحليل
    return trimmed.split('/rest/')[0].split('/auth/')[0].replace(/\/+$/, '');
  }
}

class SupabaseConfigManager {
  constructor() {
    this.config = this.loadConfig();
    this.client = null;
    this.initClient();
  }

  loadConfig() {
    // تنظيف المفتاح القديم إذا كان مخزناً بقيم غير صحيحة
    try {
      localStorage.removeItem('bayn_supabase_config_v1');
    } catch (e) {}

    // التحقق من وجود إعدادات محلية v2
    try {
      const stored = localStorage.getItem(CONFIG_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        const cleanedUrl = cleanSupabaseUrl(parsed.url);
        if (cleanedUrl && parsed.anonKey) {
          return { url: cleanedUrl, anonKey: parsed.anonKey.trim() };
        }
      }
    } catch (e) {
      console.warn('Error reading stored Supabase config:', e);
    }

    // الاعتماد على DEFAULT_CONFIG الصافي
    return {
      url: cleanSupabaseUrl(DEFAULT_CONFIG.url),
      anonKey: DEFAULT_CONFIG.anonKey.trim()
    };
  }

  saveConfig(url, anonKey) {
    const cleanedUrl = cleanSupabaseUrl(url);
    const cleanKey = (anonKey || '').trim();

    if (!cleanedUrl.startsWith('https://')) {
      throw new Error('رابط Supabase يجب أن يبدأ بـ https://');
    }
    if (!cleanKey || cleanKey.length < 20) {
      throw new Error('مفتاح anon key غير صحيح أو قصير جداً');
    }

    this.config = { url: cleanedUrl, anonKey: cleanKey };
    try {
      localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(this.config));
    } catch (e) {}
    this.initClient();
    return true;
  }

  clearConfig() {
    try {
      localStorage.removeItem(CONFIG_STORAGE_KEY);
    } catch (e) {}
    this.config = {
      url: cleanSupabaseUrl(DEFAULT_CONFIG.url),
      anonKey: DEFAULT_CONFIG.anonKey.trim()
    };
    this.client = null;
    this.initClient();
  }

  isConfigured() {
    return Boolean(this.config.url && this.config.anonKey && this.config.url.startsWith('https://'));
  }

  initClient() {
    if (!this.isConfigured()) {
      this.client = null;
      return null;
    }

    if (window.supabase && typeof window.supabase.createClient === 'function') {
      try {
        const pureUrl = cleanSupabaseUrl(this.config.url);
        this.client = window.supabase.createClient(pureUrl, this.config.anonKey, {
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
