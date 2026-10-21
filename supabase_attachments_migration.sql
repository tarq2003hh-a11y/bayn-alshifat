-- ==============================================================================
-- تطبيق بين الشفتات - ترحيل مرفقات الصور للطلبات (Supabase Storage & Schema Migration)
-- Bayn Al-Shifat - Request Attachments Storage & RLS Security Migration
-- ==============================================================================

-- 1. إنشاء جدول المرفقات (Request Attachments)
-- يربط الصورة بالطلب والمحل ورافع الصورة، مع مسار الملف ونوعه وحجمه ووقت الإضافة
CREATE TABLE IF NOT EXISTS public.request_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL UNIQUE,
    file_type TEXT NOT NULL CHECK (file_type IN ('image/jpeg', 'image/png', 'image/webp')),
    file_size INTEGER NOT NULL CHECK (file_size > 0 AND file_size <= 2097152), -- أقصى حجم 2MB
    created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- فهارس لتحسين سرعة الاستعلامات حسب الطلب والمحل
CREATE INDEX IF NOT EXISTS idx_request_attachments_request ON public.request_attachments(request_id);
CREATE INDEX IF NOT EXISTS idx_request_attachments_store ON public.request_attachments(store_id);
CREATE INDEX IF NOT EXISTS idx_request_attachments_created_by ON public.request_attachments(created_by);

-- ==============================================================================
-- 2. إعداد حاوية التخزين الخاصة في Supabase Storage (Private Bucket)
-- ==============================================================================
-- إنشاء الـ bucket كـ Private مع حدود الحجم والأنواع
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'request_attachments',
    'request_attachments',
    false,
    2097152, -- 2MB (2 * 1024 * 1024)
    ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 2097152,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- ==============================================================================
-- 3. الدوال الأمنية المساعدة للتحقق من المرفقات ومسارات التخزين
-- ==============================================================================

-- دالة مساعدة لاستخراج request_id من مسار الملف في الـ bucket
-- الصيغة المعتمدة: store_<store_id>/req_<request_id>/<random_uuid>.<ext>
CREATE OR REPLACE FUNCTION public.extract_request_id_from_storage_path(path TEXT)
RETURNS UUID AS $$
DECLARE
    m TEXT[];
BEGIN
    m := regexp_matches(path, '^store_([0-9a-fA-F-]+)/req_([0-9a-fA-F-]+)/');
    IF m IS NOT NULL AND array_length(m, 1) >= 2 THEN
        RETURN m[2]::uuid;
    END IF;
    RETURN NULL;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- دالة مساعدة لاستخراج store_id من مسار الملف في الـ bucket
CREATE OR REPLACE FUNCTION public.extract_store_id_from_storage_path(path TEXT)
RETURNS UUID AS $$
DECLARE
    m TEXT[];
BEGIN
    m := regexp_matches(path, '^store_([0-9a-fA-F-]+)/req_([0-9a-fA-F-]+)/');
    IF m IS NOT NULL AND array_length(m, 1) >= 1 THEN
        RETURN m[1]::uuid;
    END IF;
    RETURN NULL;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- التحقق من صلاحية قراءة المرفق من التخزين (أعضاء نفس المحل فقط)
CREATE OR REPLACE FUNCTION public.can_view_storage_attachment(path TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    v_req_id UUID;
    v_store_id UUID;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN FALSE;
    END IF;

    v_req_id := public.extract_request_id_from_storage_path(path);
    v_store_id := public.extract_store_id_from_storage_path(path);
    IF v_req_id IS NULL OR v_store_id IS NULL THEN
        RETURN FALSE;
    END IF;

    RETURN EXISTS (
        SELECT 1 FROM public.requests r
        WHERE r.id = v_req_id
          AND r.store_id = v_store_id
          AND public.is_store_member(r.store_id)
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- التحقق من صلاحية رفع أو حذف المرفق من التخزين (كاتب الطلب أو مدير/مالك المحل)
CREATE OR REPLACE FUNCTION public.can_manage_storage_attachment(path TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    v_req_id UUID;
    v_store_id UUID;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN FALSE;
    END IF;

    v_req_id := public.extract_request_id_from_storage_path(path);
    v_store_id := public.extract_store_id_from_storage_path(path);
    IF v_req_id IS NULL OR v_store_id IS NULL THEN
        RETURN FALSE;
    END IF;

    RETURN EXISTS (
        SELECT 1 FROM public.requests r
        WHERE r.id = v_req_id
          AND r.store_id = v_store_id
          AND public.is_store_member(r.store_id)
          AND (
              public.is_store_manager_or_owner(r.store_id)
              OR r.author_id = auth.uid()
          )
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ==============================================================================
-- 4. زناد التحقق الذري وحماية حد الـ 5 صور ومنع التزامن
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.trg_check_request_attachment()
RETURNS TRIGGER AS $$
DECLARE
    v_req RECORD;
    v_att_count INT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'غير مصرح: يجب تسجيل الدخول أولاً';
    END IF;

    -- قفل صف الطلب ذرياً فوراً (FOR UPDATE) لمنع تجاوز حد 5 صور بالطلبات المتزامنة
    SELECT id, store_id, author_id INTO v_req
    FROM public.requests
    WHERE id = NEW.request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'الطلب المرتبط غير موجود';
    END IF;

    -- مطابقة store_id الفعلي للطلب لمنع حقن محلات أخرى
    NEW.store_id := v_req.store_id;

    -- تعيين معرف رافع الصورة من هوية المستخدم الموثقة لمنع التزوير
    NEW.created_by := auth.uid();

    -- التحقق من عضوية المحل
    IF NOT public.is_store_member(v_req.store_id) THEN
        RAISE EXCEPTION 'غير مصرح: لست عضواً في هذا المحل';
    END IF;

    -- التحقق من صلاحية الإضافة: كاتب الطلب أو مالك أو مدير المحل
    IF v_req.author_id != auth.uid() AND NOT public.is_store_manager_or_owner(v_req.store_id) THEN
        RAISE EXCEPTION 'غير مصرح: يحق لكاتب الطلب أو إدارة المحل فقط إضافة مرفقات';
    END IF;

    -- فحص الحد الأقصى (5 صور لكل طلب) ذرياً تحت قفل الصف
    SELECT count(*) INTO v_att_count
    FROM public.request_attachments
    WHERE request_id = NEW.request_id;

    IF v_att_count >= 5 THEN
        RAISE EXCEPTION 'تم تجاوز الحد الأقصى: لا يمكن إضافة أكثر من 5 صور لكل طلب';
    END IF;

    -- فحص نوع وحجم الملف
    IF NEW.file_type NOT IN ('image/jpeg', 'image/png', 'image/webp') THEN
        RAISE EXCEPTION 'نوع الملف غير مدعوم. المسموح به: JPEG، PNG، WebP فقط';
    END IF;

    IF NEW.file_size <= 0 OR NEW.file_size > 2097152 THEN
        RAISE EXCEPTION 'حجم الملف يتجاوز الحد المسموح به (2 ميجابايت)';
    END IF;

    -- التحقق من نمط المسار المنظم وخلوه من بيانات شخصية
    IF NEW.file_path NOT LIKE 'store_' || v_req.store_id || '/req_' || v_req.id || '/%' THEN
        RAISE EXCEPTION 'مسار المرفق غير صالح أو لا يتوافق مع قيود المحل والطلب';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_validate_request_attachment ON public.request_attachments;
CREATE TRIGGER trg_validate_request_attachment
    BEFORE INSERT ON public.request_attachments
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_check_request_attachment();

-- تنظيف ملفات التخزين يتم حصرياً عبر واجهة Supabase Storage API في كود التطبيق
-- (supabase.storage.from('request_attachments').remove(...)) لحذف الملفات الفعلية وتجنب حذف صفوف storage.objects يدوياً
DROP TRIGGER IF EXISTS trg_delete_request_attachment_storage ON public.request_attachments;
DROP FUNCTION IF EXISTS public.trg_cleanup_storage_object();

-- ==============================================================================
-- 5. سياسات الأمان على مستوى السطر (RLS) لجدول المرفقات
-- ==============================================================================
ALTER TABLE public.request_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Request attachments viewable by store members" ON public.request_attachments;
DROP POLICY IF EXISTS "Request attachments insertable by authorized members" ON public.request_attachments;
DROP POLICY IF EXISTS "Request attachments deletable by authorized members" ON public.request_attachments;

-- 1. القراءة: لأعضاء المحل فقط
CREATE POLICY "Request attachments viewable by store members"
    ON public.request_attachments FOR SELECT
    TO authenticated
    USING (public.is_store_member(store_id));

-- 2. الإضافة: لكاتب الطلب أو المالك أو المدير
CREATE POLICY "Request attachments insertable by authorized members"
    ON public.request_attachments FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_store_member(store_id)
        AND created_by = auth.uid()
        AND (
            public.is_store_manager_or_owner(store_id)
            OR (SELECT author_id FROM public.requests WHERE id = request_id) = auth.uid()
        )
    );

-- 3. الحذف: لكاتب الطلب أو رافع المرفق أو المالك أو المدير
CREATE POLICY "Request attachments deletable by authorized members"
    ON public.request_attachments FOR DELETE
    TO authenticated
    USING (
        public.is_store_member(store_id)
        AND (
            public.is_store_manager_or_owner(store_id)
            OR created_by = auth.uid()
            OR (SELECT author_id FROM public.requests WHERE id = request_id) = auth.uid()
        )
    );

-- ==============================================================================
-- 6. سياسات الأمان لـ Supabase Storage (storage.objects RLS)
-- ==============================================================================
-- ملاحظة: RLS مفعل افتراضياً على storage.objects في Supabase
-- تم تعليق السطر التالي لتجنب خطأ نقص الصلاحيات في بعض مشاريع Supabase:
-- ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Attachments storage select policy" ON storage.objects;
DROP POLICY IF EXISTS "Attachments storage insert policy" ON storage.objects;
DROP POLICY IF EXISTS "Attachments storage delete policy" ON storage.objects;

-- قراءة الملفات في الـ bucket (توليد الروابط الموقعة والتنزيل)
CREATE POLICY "Attachments storage select policy"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'request_attachments'
        AND public.can_view_storage_attachment(name)
    );

-- رفع الملفات في الـ bucket
CREATE POLICY "Attachments storage insert policy"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'request_attachments'
        AND public.can_manage_storage_attachment(name)
    );

-- حذف الملفات من الـ bucket
CREATE POLICY "Attachments storage delete policy"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'request_attachments'
        AND public.can_manage_storage_attachment(name)
    );

-- ==============================================================================
-- 7. تفعيل Realtime على جدول المرفقات
-- ==============================================================================
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.request_attachments;
EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
END $$;

-- منح الصلاحيات للمستخدمين الموثقين
GRANT SELECT, INSERT, DELETE ON public.request_attachments TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_storage_attachment(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_storage_attachment(TEXT) TO authenticated;
