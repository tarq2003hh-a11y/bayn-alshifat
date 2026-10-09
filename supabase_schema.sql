-- ==============================================================================
-- تطبيق بين الشفتات - مخطط قاعدة البيانات وسياسات الحماية متعددة المحلات (Multi-tenant)
-- Bayn Al-Shifat - Supabase PostgreSQL Schema & Row Level Security (RLS)
-- ==============================================================================

-- 1. تفعيل الامتدادات اللازمة
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 2. الجداول الأساسية
-- ==============================================================================

-- 2.1 جدول الملف الشخصي (Profiles)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    email TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Trigger تلقائي لإنشاء الملف الشخصي عند إنشاء حساب جديد في auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, email)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
        NEW.email
    )
    ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2.2 جدول المحلات (Stores)
CREATE TABLE IF NOT EXISTS public.stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL CHECK (char_length(trim(name)) >= 2),
    description TEXT,
    created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 2.3 جدول العضويات والأدوار (Memberships)
CREATE TABLE IF NOT EXISTS public.memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'staff')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_store_user UNIQUE (store_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_user ON public.memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_store ON public.memberships(store_id);

-- 2.4 جدول الدعوات (Invitations)
CREATE TABLE IF NOT EXISTS public.invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('manager', 'staff')),
    token TEXT NOT NULL UNIQUE,
    created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    used_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_invitations_token ON public.invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_store ON public.invitations(store_id);

-- 2.5 جدول الطلبات (Requests: حجز، نقص)
CREATE TABLE IF NOT EXISTS public.requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK (category IN ('reservation', 'shortage')),
    title TEXT NOT NULL CHECK (char_length(trim(title)) > 0),
    details TEXT,
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent')),
    due_date TEXT,
    -- حقول النواقص
    quantity TEXT,
    -- حقول الحجوزات
    customer_name TEXT,
    customer_phone TEXT,
    -- بيانات الكاتب
    author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    author_name TEXT NOT NULL,
    shift TEXT NOT NULL CHECK (shift IN ('صباحي', 'مسائي')),
    -- الحالة والمتابعة
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'ready', 'completed')),
    assignee_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    assignee_name TEXT,
    assigned_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_requests_store ON public.requests(store_id);
CREATE INDEX IF NOT EXISTS idx_requests_status ON public.requests(store_id, status);

-- 2.6 جدول التبليغات (Announcements)
CREATE TABLE IF NOT EXISTS public.announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    title TEXT NOT NULL CHECK (char_length(trim(title)) > 0),
    details TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent')),
    due_date TEXT,
    author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    author_name TEXT NOT NULL,
    shift TEXT NOT NULL CHECK (shift IN ('صباحي', 'مسائي')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_announcements_store ON public.announcements(store_id);

-- 2.7 جدول تسجيل اطلاع التبليغات (Announcement Reads)
CREATE TABLE IF NOT EXISTS public.announcement_reads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    announcement_id UUID NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    user_name TEXT NOT NULL,
    read_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_announcement_user UNIQUE (announcement_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_announcement_reads_ann ON public.announcement_reads(announcement_id);

-- 2.8 جدول سجل النشاط (Activity Logs)
CREATE TABLE IF NOT EXISTS public.activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_store ON public.activity_logs(store_id);

-- ==============================================================================
-- 3. الدوال المساعدة للتحقق من العضوية والصلاحيات (Security Functions)
-- ==============================================================================

-- هل المستخدم الحالي عضو في هذا المحل؟
CREATE OR REPLACE FUNCTION public.is_store_member(check_store_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.memberships
        WHERE store_id = check_store_id
          AND user_id = auth.uid()
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- جلب دور المستخدم الحالي في المحل
CREATE OR REPLACE FUNCTION public.get_store_role(check_store_id UUID)
RETURNS TEXT AS $$
DECLARE
    user_role TEXT;
BEGIN
    SELECT role INTO user_role
    FROM public.memberships
    WHERE store_id = check_store_id
      AND user_id = auth.uid();
    RETURN user_role;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- هل المستخدم مالك أو مدير في هذا المحل؟
CREATE OR REPLACE FUNCTION public.is_store_manager_or_owner(check_store_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    r TEXT;
BEGIN
    r := public.get_store_role(check_store_id);
    RETURN r IN ('owner', 'manager');
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- هل المستخدم مالك المحل؟
CREATE OR REPLACE FUNCTION public.is_store_owner(check_store_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN public.get_store_role(check_store_id) = 'owner';
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ==============================================================================
-- 4. سياسات الأمان على مستوى السطر (Row Level Security - RLS)
-- ==============================================================================

-- 4.1 Profiles RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles are viewable by authenticated users"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Users can update their own profile"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

-- 4.2 Stores RLS
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;

-- قراءة المحل فقط للأعضاء المسجلين فيه
CREATE POLICY "Stores viewable by members only"
    ON public.stores FOR SELECT
    TO authenticated
    USING (public.is_store_member(id));

-- تحديث المحل للمالك فقط
CREATE POLICY "Stores updatable by owner only"
    ON public.stores FOR UPDATE
    TO authenticated
    USING (public.is_store_owner(id))
    WITH CHECK (public.is_store_owner(id));

-- الحذف للمالك فقط
CREATE POLICY "Stores deletable by owner only"
    ON public.stores FOR DELETE
    TO authenticated
    USING (public.is_store_owner(id));

-- 4.3 Memberships RLS
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;

-- رؤية الأعضاء: لأعضاء نفس المحل فقط
CREATE POLICY "Memberships viewable by store members"
    ON public.memberships FOR SELECT
    TO authenticated
    USING (public.is_store_member(store_id));

-- منع الإضافة والتعديل والحذف المباشر للجداول للحفاظ على قيود الأمان (تتم عبر RPCs الآمنة فقط)
-- لا توجد سياسة INSERT أو UPDATE مباشرة للمستخدم العادي؛ تتم عبر RPCs

-- 4.4 Invitations RLS
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

-- رؤية الدعوات: لمالك ومدير المحل فقط
CREATE POLICY "Invitations viewable by owner and manager"
    ON public.invitations FOR SELECT
    TO authenticated
    USING (public.is_store_manager_or_owner(store_id));

-- 4.5 Requests RLS
ALTER TABLE public.requests ENABLE ROW LEVEL SECURITY;

-- قراءة الطلبات: لأعضاء المحل فقط
CREATE POLICY "Requests viewable by store members"
    ON public.requests FOR SELECT
    TO authenticated
    USING (public.is_store_member(store_id));

-- إضافة طلب: لعضو المحل ويكون هو الكاتب ومحل مطابق
CREATE POLICY "Requests insertable by store members"
    ON public.requests FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_store_member(store_id)
        AND author_id = auth.uid()
    );

-- تحديث الطلب: 
-- - المالك والمدير يستطيعان تعديل أي طلب في محلهما
-- - الموظف يستطيع تعديل طلبه الخاص، أو تحديث الطلب الذي استلمه للمتابعة
CREATE POLICY "Requests updatable by authorized members"
    ON public.requests FOR UPDATE
    TO authenticated
    USING (
        public.is_store_member(store_id)
        AND (
            public.is_store_manager_or_owner(store_id)
            OR author_id = auth.uid()
            OR assignee_id = auth.uid()
        )
    )
    WITH CHECK (
        public.is_store_member(store_id)
    );

-- حذف الطلب: المالك والمدير وكاتب الطلب فقط
CREATE POLICY "Requests deletable by managers or author"
    ON public.requests FOR DELETE
    TO authenticated
    USING (
        public.is_store_member(store_id)
        AND (
            public.is_store_manager_or_owner(store_id)
            OR author_id = auth.uid()
        )
    );

-- 4.6 Announcements RLS
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Announcements viewable by store members"
    ON public.announcements FOR SELECT
    TO authenticated
    USING (public.is_store_member(store_id));

CREATE POLICY "Announcements insertable by store members"
    ON public.announcements FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_store_member(store_id)
        AND author_id = auth.uid()
    );

CREATE POLICY "Announcements updatable by managers or author"
    ON public.announcements FOR UPDATE
    TO authenticated
    USING (
        public.is_store_member(store_id)
        AND (
            public.is_store_manager_or_owner(store_id)
            OR author_id = auth.uid()
        )
    );

CREATE POLICY "Announcements deletable by managers or author"
    ON public.announcements FOR DELETE
    TO authenticated
    USING (
        public.is_store_member(store_id)
        AND (
            public.is_store_manager_or_owner(store_id)
            OR author_id = auth.uid()
        )
    );

-- 4.7 Announcement Reads RLS
ALTER TABLE public.announcement_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Announcement reads viewable by store members"
    ON public.announcement_reads FOR SELECT
    TO authenticated
    USING (public.is_store_member(store_id));

CREATE POLICY "Users can mark announcement as read"
    ON public.announcement_reads FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_store_member(store_id)
        AND user_id = auth.uid()
    );

-- 4.8 Activity Logs RLS
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Activity logs viewable by store members"
    ON public.activity_logs FOR SELECT
    TO authenticated
    USING (public.is_store_member(store_id));

-- ==============================================================================
-- 5. العمليات الذرية والمحمية (Atomic Secure Stored Procedures - RPCs)
-- ==============================================================================

-- 5.1 إنشاء محل جديد مع تعيين المنشئ مالكاً تلقائياً في عملية ذرية
CREATE OR REPLACE FUNCTION public.rpc_create_store(
    store_name TEXT,
    store_description TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    new_store_id UUID;
    v_user_name TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'غير مصرح: يجب تسجيل الدخول أولاً';
    END IF;

    IF char_length(trim(store_name)) < 2 THEN
        RAISE EXCEPTION 'اسم المحل يجب ألا يقل عن حرفين';
    END IF;

    SELECT full_name INTO v_user_name FROM public.profiles WHERE id = auth.uid();

    -- إنشاء المحل
    INSERT INTO public.stores (name, description, created_by)
    VALUES (trim(store_name), store_description, auth.uid())
    RETURNING id INTO new_store_id;

    -- تعيين المستخدم مالكاً للمحل
    INSERT INTO public.memberships (store_id, user_id, role)
    VALUES (new_store_id, auth.uid(), 'owner');

    -- تسجيل النشاط
    INSERT INTO public.activity_logs (store_id, user_id, action, details)
    VALUES (new_store_id, auth.uid(), 'create_store', jsonb_build_object('store_name', store_name));

    RETURN jsonb_build_object(
        'success', true,
        'store_id', new_store_id,
        'store_name', store_name,
        'role', 'owner'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5.2 إنشاء رابط دعوة جديد (للمالك والمدير فقط)
CREATE OR REPLACE FUNCTION public.rpc_create_invitation(
    target_store_id UUID,
    invite_role TEXT DEFAULT 'staff',
    duration_hours INT DEFAULT 48
)
RETURNS JSONB AS $$
DECLARE
    v_caller_role TEXT;
    v_token TEXT;
    v_expires_at TIMESTAMPTZ;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'يجب تسجيل الدخول';
    END IF;

    v_caller_role := public.get_store_role(target_store_id);
    IF v_caller_role NOT IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'غير مصرح: يحق للمالك والمدير فقط إنشاء دعوات';
    END IF;

    IF invite_role = 'manager' AND v_caller_role != 'owner' THEN
        RAISE EXCEPTION 'غير مصرح: المالك فقط يستطيع دعوة مديرين';
    END IF;

    IF invite_role NOT IN ('manager', 'staff') THEN
        RAISE EXCEPTION 'الدور المطلوب غير صحيح';
    END IF;

    -- توليد رمز عشوائي آمن تشفيرياً (32 حرف هكسا)
    v_token := encode(gen_random_bytes(24), 'hex');
    v_expires_at := timezone('utc'::text, now()) + (duration_hours || ' hours')::INTERVAL;

    INSERT INTO public.invitations (store_id, role, token, created_by, expires_at)
    VALUES (target_store_id, invite_role, v_token, auth.uid(), v_expires_at);

    RETURN jsonb_build_object(
        'success', true,
        'token', v_token,
        'role', invite_role,
        'expires_at', v_expires_at
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5.3 معاينة معلومات الدعوة دون كشف بيانات المحل لغير المسجل
CREATE OR REPLACE FUNCTION public.rpc_get_invitation_info(invite_token TEXT)
RETURNS JSONB AS $$
DECLARE
    inv RECORD;
BEGIN
    SELECT i.id, i.store_id, i.role, i.expires_at, i.used_at, i.is_revoked, s.name as store_name
    INTO inv
    FROM public.invitations i
    JOIN public.stores s ON s.id = i.store_id
    WHERE i.token = invite_token;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('valid', false, 'reason', 'not_found', 'message', 'رمز الدعوة غير صحيح');
    END IF;

    IF inv.is_revoked THEN
        RETURN jsonb_build_object('valid', false, 'reason', 'revoked', 'message', 'تم إلغاء هذه الدعوة من قبل إدارة المحل');
    END IF;

    IF inv.used_at IS NOT NULL THEN
        RETURN jsonb_build_object('valid', false, 'reason', 'used', 'message', 'تم استخدام رابط هذه الدعوة مسبقاً');
    END IF;

    IF inv.expires_at < timezone('utc'::text, now()) THEN
        RETURN jsonb_build_object('valid', false, 'reason', 'expired', 'message', 'انتهت صلاحية رابط الدعوة');
    END IF;

    RETURN jsonb_build_object(
        'valid', true,
        'store_id', inv.store_id,
        'store_name', inv.store_name,
        'role', inv.role,
        'expires_at', inv.expires_at
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5.4 قبول الدعوة والانضمام للمحل (عملية ذرية واحدة تمنع التكرار)
CREATE OR REPLACE FUNCTION public.rpc_accept_invitation(invite_token TEXT)
RETURNS JSONB AS $$
DECLARE
    inv RECORD;
    v_user_name TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'يجب تسجيل الدخول أولاً لقبول الدعوة';
    END IF;

    -- قفل سجل الدعوة لمنع أي استخدام متزامن
    SELECT i.*, s.name as store_name
    INTO inv
    FROM public.invitations i
    JOIN public.stores s ON s.id = i.store_id
    WHERE i.token = invite_token
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'رمز الدعوة غير صحيح';
    END IF;

    IF inv.is_revoked THEN
        RAISE EXCEPTION 'تم إلغاء هذه الدعوة من قبل الإدارة';
    END IF;

    IF inv.used_at IS NOT NULL THEN
        RAISE EXCEPTION 'تم استخدام هذه الدعوة مسبقاً، الدعوات تستخدم مرة واحدة فقط';
    END IF;

    IF inv.expires_at < timezone('utc'::text, now()) THEN
        RAISE EXCEPTION 'انتهت صلاحية رابط الدعوة';
    END IF;

    -- التحقق إذا كان المستخدم عضواً بالفعل في هذا المحل
    IF EXISTS (SELECT 1 FROM public.memberships WHERE store_id = inv.store_id AND user_id = auth.uid()) THEN
        RETURN jsonb_build_object(
            'success', true,
            'already_member', true,
            'store_id', inv.store_id,
            'store_name', inv.store_name,
            'message', 'أنت عضو بالفعل في هذا المحل'
        );
    END IF;

    -- إنشاء العضوية
    INSERT INTO public.memberships (store_id, user_id, role)
    VALUES (inv.store_id, auth.uid(), inv.role);

    -- وسم الدعوة كمستخدمة
    UPDATE public.invitations
    SET used_at = timezone('utc'::text, now()),
        used_by = auth.uid()
    WHERE id = inv.id;

    -- تسجيل النشاط
    SELECT full_name INTO v_user_name FROM public.profiles WHERE id = auth.uid();
    INSERT INTO public.activity_logs (store_id, user_id, action, details)
    VALUES (inv.store_id, auth.uid(), 'accept_invitation', jsonb_build_object('role', inv.role, 'user_name', v_user_name));

    RETURN jsonb_build_object(
        'success', true,
        'store_id', inv.store_id,
        'store_name', inv.store_name,
        'role', inv.role,
        'message', 'تم الانضمام إلى ' || inv.store_name || ' بنجاح'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5.5 إلغاء رابط دعوة
CREATE OR REPLACE FUNCTION public.rpc_revoke_invitation(invitation_id UUID)
RETURNS JSONB AS $$
DECLARE
    inv RECORD;
BEGIN
    SELECT * INTO inv FROM public.invitations WHERE id = invitation_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'الدعوة غير موجودة';
    END IF;

    IF NOT public.is_store_manager_or_owner(inv.store_id) THEN
        RAISE EXCEPTION 'غير مصرح';
    END IF;

    UPDATE public.invitations
    SET is_revoked = TRUE
    WHERE id = invitation_id;

    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5.6 استلام الطلب ذرياً (Atomic Claim Request with Concurrency Lock)
-- يمنع استلام اثنين من الموظفين لنفس الطلب في نفس الوقت
CREATE OR REPLACE FUNCTION public.rpc_claim_request(req_id UUID)
RETURNS JSONB AS $$
DECLARE
    req RECORD;
    v_user_name TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'يجب تسجيل الدخول';
    END IF;

    -- قفل الصف فوراً لمنع أي قراءة/تحديث متزامن (FOR UPDATE)
    SELECT * INTO req
    FROM public.requests
    WHERE id = req_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'الطلب غير موجود';
    END IF;

    -- التحقق من عضوية المستخدم في محل هذا الطلب
    IF NOT public.is_store_member(req.store_id) THEN
        RAISE EXCEPTION 'غير مصرح: لست عضواً في هذا المحل';
    END IF;

    -- إذا كان مستلماً بالفعل من زميل آخر
    IF req.assignee_id IS NOT NULL AND req.assignee_id != auth.uid() THEN
        RETURN jsonb_build_object(
            'success', false,
            'conflict', true,
            'assignee_name', req.assignee_name,
            'message', 'عذراً، قام زميلك (' || req.assignee_name || ') باستلام هذا الطلب للتو!'
        );
    END IF;

    -- إذا كان مكتمل بالفعل
    IF req.status = 'completed' THEN
        RETURN jsonb_build_object(
            'success', false,
            'conflict', true,
            'message', 'عذراً، هذا الطلب مكتمل بالفعل'
        );
    END IF;

    -- جلب اسم المستخدم
    SELECT full_name INTO v_user_name FROM public.profiles WHERE id = auth.uid();

    -- تحديث الطلب وإسناده
    UPDATE public.requests
    SET status = 'in_progress',
        assignee_id = auth.uid(),
        assignee_name = v_user_name,
        assigned_at = timezone('utc'::text, now()),
        updated_at = timezone('utc'::text, now())
    WHERE id = req_id;

    -- تسجيل النشاط
    INSERT INTO public.activity_logs (store_id, user_id, action, details)
    VALUES (req.store_id, auth.uid(), 'claim_request', jsonb_build_object('request_id', req_id, 'title', req.title));

    RETURN jsonb_build_object(
        'success', true,
        'request_id', req_id,
        'assignee_name', v_user_name,
        'message', 'تم استلام متابعة الطلب بنجاح'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5.7 إلغاء استلام الطلب (Unclaim)
CREATE OR REPLACE FUNCTION public.rpc_cancel_claim_request(req_id UUID)
RETURNS JSONB AS $$
DECLARE
    req RECORD;
BEGIN
    SELECT * INTO req FROM public.requests WHERE id = req_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'الطلب غير موجود';
    END IF;

    IF NOT public.is_store_member(req.store_id) THEN
        RAISE EXCEPTION 'غير مصرح';
    END IF;

    -- إلغاء الاستلام مسموح للمسؤول نفسه أو للمدير/المالك
    IF req.assignee_id != auth.uid() AND NOT public.is_store_manager_or_owner(req.store_id) THEN
        RAISE EXCEPTION 'غير مصرح: يمكنك إلغاء استلامك فقط';
    END IF;

    UPDATE public.requests
    SET status = 'new',
        assignee_id = NULL,
        assignee_name = NULL,
        assigned_at = NULL,
        updated_at = timezone('utc'::text, now())
    WHERE id = req_id;

    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5.8 تحديث حالة الطلب (جاهز للاستلام، مكتمل، إعادة فتح)
CREATE OR REPLACE FUNCTION public.rpc_update_request_status(
    req_id UUID,
    new_status TEXT
)
RETURNS JSONB AS $$
DECLARE
    req RECORD;
BEGIN
    IF new_status NOT IN ('new', 'in_progress', 'ready', 'completed') THEN
        RAISE EXCEPTION 'حالة غير صالحة';
    END IF;

    SELECT * INTO req FROM public.requests WHERE id = req_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'الطلب غير موجود';
    END IF;

    IF NOT public.is_store_member(req.store_id) THEN
        RAISE EXCEPTION 'غير مصرح';
    END IF;

    -- التحقق من الصلاحيات: المسؤول عن الطلب أو المدير/المالك، أو إذا كان الطلب مكتملاً لإعادة فتحه
    IF req.assignee_id != auth.uid() AND NOT public.is_store_manager_or_owner(req.store_id) AND req.author_id != auth.uid() THEN
        RAISE EXCEPTION 'غير مصرح بتعديل حالة هذا الطلب';
    END IF;

    UPDATE public.requests
    SET status = new_status,
        completed_at = CASE WHEN new_status = 'completed' THEN timezone('utc'::text, now()) ELSE completed_at END,
        updated_at = timezone('utc'::text, now())
    WHERE id = req_id;

    RETURN jsonb_build_object('success', true, 'status', new_status);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5.9 إدارة الأعضاء والأدوار (تغيير دور، ومنع ترقية النفس ومنع إزالة آخر مالك)
CREATE OR REPLACE FUNCTION public.rpc_update_member_role(
    target_store_id UUID,
    target_user_id UUID,
    new_role TEXT
)
RETURNS JSONB AS $$
DECLARE
    caller_role TEXT;
    target_current_role TEXT;
    owners_count INT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'يجب تسجيل الدخول';
    END IF;

    -- لا يجوز للمستخدم تعديل دوره بنفسه
    IF target_user_id = auth.uid() THEN
        RAISE EXCEPTION 'لا يمكنك تعديل صلاحياتك أو دورك بنفسك';
    END IF;

    IF new_role NOT IN ('owner', 'manager', 'staff') THEN
        RAISE EXCEPTION 'الدور غير صالح';
    END IF;

    caller_role := public.get_store_role(target_store_id);
    IF caller_role != 'owner' THEN
        RAISE EXCEPTION 'غير مصرح: المالك فقط يستطيع تغيير أدوار الأعضاء';
    END IF;

    SELECT role INTO target_current_role
    FROM public.memberships
    WHERE store_id = target_store_id AND user_id = target_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'العضو غير موجود في هذا المحل';
    END IF;

    -- منع تحويل المالك الأخير إلى دور آخر
    IF target_current_role = 'owner' AND new_role != 'owner' THEN
        SELECT count(*) INTO owners_count
        FROM public.memberships
        WHERE store_id = target_store_id AND role = 'owner';
        IF owners_count <= 1 THEN
            RAISE EXCEPTION 'لا يمكن تغيير دور آخر مالك للمحل؛ يجب وجود مالك واحد على الأقل دائماً';
        END IF;
    END IF;

    UPDATE public.memberships
    SET role = new_role,
        updated_at = timezone('utc'::text, now())
    WHERE store_id = target_store_id AND user_id = target_user_id;

    RETURN jsonb_build_object('success', true, 'role', new_role);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5.10 إزالة عضو من المحل (مع منع إزالة آخر مالك والتحقق من صلاحية المدير والمالك)
CREATE OR REPLACE FUNCTION public.rpc_remove_member(
    target_store_id UUID,
    target_user_id UUID
)
RETURNS JSONB AS $$
DECLARE
    caller_role TEXT;
    target_role TEXT;
    owners_count INT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'يجب تسجيل الدخول';
    END IF;

    caller_role := public.get_store_role(target_store_id);
    IF caller_role NOT IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'غير مصرح: يحق للمالك والمدير فقط إدارة الأعضاء';
    END IF;

    SELECT role INTO target_role
    FROM public.memberships
    WHERE store_id = target_store_id AND user_id = target_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'العضو غير موجود في هذا المحل';
    END IF;

    -- المدير لا يستطيع إزالة المالك أو المديرين الآخرين
    IF caller_role = 'manager' AND target_role IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'غير مصرح: المدير يستطيع فقط إزالة الموظفين العاديين';
    END IF;

    -- منع إزالة آخر مالك
    IF target_role = 'owner' THEN
        SELECT count(*) INTO owners_count
        FROM public.memberships
        WHERE store_id = target_store_id AND role = 'owner';
        IF owners_count <= 1 THEN
            RAISE EXCEPTION 'لا يمكن إزالة آخر مالك للمحل';
        END IF;
    END IF;

    -- حذف العضوية فوراً (الطلبات والأعمال السابقة تبقى مسجلة باسمه في author_name و assignee_name)
    DELETE FROM public.memberships
    WHERE store_id = target_store_id AND user_id = target_user_id;

    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==============================================================================
-- 6. تفعيل النشر اللحظي في Supabase Realtime مع قيود المحل
-- ==============================================================================
DO $$
BEGIN
    -- إضافة الجداول لـ supabase_realtime إذا لم تكن مضافة
    ALTER PUBLICATION supabase_realtime ADD TABLE public.requests;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.announcements;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.announcement_reads;
EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
END $$;
