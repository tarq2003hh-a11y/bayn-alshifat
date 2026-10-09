/**
 * تطبيق «بين الشفتات» - النسخة المشتركة متعددة المحلات (Multi-tenant)
 * المدعومة بـ Supabase (Authentication, PostgreSQL, Realtime, RLS)
 */

// ========================================================
// 1. حالة التطبيق المركزية (Central Application State)
// ========================================================
const state = {
  // بيانات الجلسة والمستخدم
  user: null,          // { id, email, full_name }
  stores: [],          // [{ id, name, description, role }]
  activeStoreId: null, // المعرف النشط للمحل
  activeStore: null,   // كائن المحل النشط مع دور المستخدم الحالي
  currentShift: 'صباحي', // 'صباحي' أو 'مسائي' (مستقل عن هوية المستخدم)

  // بيانات المحل النشط (تُمسح تماماً عند تبديل المحل أو الخروج)
  requests: [],
  announcements: [],
  announcementReads: [],
  members: [],
  invitations: [],

  // الفلاتر والعرض
  filters: {
    category: 'all', // 'all', 'reservation', 'shortage', 'announcement'
    status: 'all',   // 'all', 'new', 'in_progress', 'ready', 'completed'
    priority: 'all', // 'all', 'urgent', 'normal'
    search: '',
    myTasksOnly: false,
    handoverOnly: false
  },

  // متغيرات النوافذ المؤقتة
  editingRequestId: null,
  deletingRequestId: null,
  pendingInviteToken: null,

  // قناة الاشتراك اللحظي
  realtimeChannel: null
};

// ========================================================
// 2. دوال الاتصال وعميل Supabase
// ========================================================
function getSupabase() {
  if (!window.supabaseConfig) return null;
  return window.supabaseConfig.getClient();
}

function ensureSupabaseConfigured() {
  if (!window.supabaseConfig || !window.supabaseConfig.isConfigured()) {
    console.warn('Supabase is not configured yet.');
    return false;
  }
  return true;
}

// ========================================================
// 3. إدارة التوثيق والحسابات (Authentication)
// ========================================================
async function initAuth() {
  const supabase = getSupabase();
  if (!supabase) return;

  // فحص الجلسة الحالية
  const { data: { session } } = await supabase.auth.getSession();
  await handleSessionChange(session);

  // الاستماع لتغييرات الجلسة
  supabase.auth.onAuthStateChange(async (event, session) => {
    console.log('Auth event:', event);
    if (event === 'PASSWORD_RECOVERY') {
      openAuthModal('resetPassword');
    } else {
      await handleSessionChange(session);
    }
  });
}

async function handleSessionChange(session) {
  if (session && session.user) {
    const supabase = getSupabase();
    // جلب الملف الشخصي للاسم الكامل
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, email')
      .eq('id', session.user.id)
      .single();

    state.user = {
      id: session.user.id,
      email: session.user.email,
      full_name: (profile && profile.full_name) || session.user.user_metadata?.full_name || session.user.email.split('@')[0]
    };

    updateUserHeaderUI();
    hideAuthModal();

    // جلب محلات المستخدم
    await loadUserStores();

    // إذا كان هناك رمز دعوة معلق في الرابط، ابدأ بفحصه
    checkUrlForInvitation();
  } else {
    // تم تسجيل الخروج: امسح كافة بيانات المحل السابق من الواجهة والذاكرة
    clearActiveStoreData();
    state.user = null;
    state.stores = [];
    state.activeStoreId = null;
    state.activeStore = null;

    updateUserHeaderUI();
    renderAllViews();
    checkUrlForInvitation();
  }
}

// مسح بيانات المحل السابق فوراً من الذاكرة والواجهة
function clearActiveStoreData() {
  if (state.realtimeChannel) {
    const supabase = getSupabase();
    if (supabase) supabase.removeChannel(state.realtimeChannel);
    state.realtimeChannel = null;
  }
  state.requests = [];
  state.announcements = [];
  state.announcementReads = [];
  state.members = [];
  state.invitations = [];
}

function updateUserHeaderUI() {
  const loggedInfo = document.getElementById('loggedUserInfo');
  const guestButtons = document.getElementById('guestAuthButtons');
  const storeSelectorWrap = document.getElementById('storeSelectorWrap');
  const openTeamBtn = document.getElementById('openTeamModalBtn');

  if (state.user) {
    loggedInfo.style.display = 'flex';
    guestButtons.style.display = 'none';

    document.getElementById('userDisplayName').textContent = state.user.full_name;
    document.getElementById('userAvatarText').textContent = (state.user.full_name || 'م')[0].toUpperCase();

    // إظهار دور المستخدم في المحل النشط
    const roleBadge = document.getElementById('userRoleBadge');
    if (state.activeStore) {
      const role = state.activeStore.role;
      const roleMap = { owner: '👑 مالك', manager: '🛡️ مدير', staff: '💼 موظف' };
      roleBadge.textContent = roleMap[role] || role;
      roleBadge.className = `user-role-badge role-${role}`;
      // زر إدارة الفريق يظهر للمالك والمدير فقط
      openTeamBtn.style.display = (role === 'owner' || role === 'manager') ? 'inline-flex' : 'none';
      storeSelectorWrap.style.display = 'inline-flex';
    } else {
      roleBadge.textContent = 'بدون محل';
      roleBadge.className = 'user-role-badge';
      openTeamBtn.style.display = 'none';
      storeSelectorWrap.style.display = state.stores.length > 0 ? 'inline-flex' : 'none';
    }
  } else {
    loggedInfo.style.display = 'none';
    guestButtons.style.display = 'flex';
    storeSelectorWrap.style.display = 'none';
    openTeamBtn.style.display = 'none';
  }
}

// تسجيل الدخول
async function handleLogin(email, password) {
  const supabase = getSupabase();
  if (!supabase) return;

  const errorEl = document.getElementById('loginErrorMsg');
  const submitBtn = document.getElementById('loginSubmitBtn');
  errorEl.style.display = 'none';
  submitBtn.disabled = true;
  submitBtn.textContent = 'جاري التحقق...';

  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    showToast('تم تسجيل الدخول بنجاح', 'success');
    hideAuthModal();
  } catch (err) {
    errorEl.textContent = getArabicAuthErrorMessage(err.message);
    errorEl.style.display = 'block';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'تسجيل الدخول';
  }
}

// إنشاء حساب جديد
async function handleRegister(fullName, email, password) {
  const supabase = getSupabase();
  if (!supabase) return;

  const errorEl = document.getElementById('registerErrorMsg');
  const successEl = document.getElementById('registerSuccessMsg');
  const submitBtn = document.getElementById('registerSubmitBtn');
  errorEl.style.display = 'none';
  successEl.style.display = 'none';
  submitBtn.disabled = true;
  submitBtn.textContent = 'جاري إنشاء الحساب...';

  try {
    // توجيه تأكيد الإيميل للمسار الحالي
    const redirectUrl = window.location.origin + window.location.pathname;

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName.trim() },
        emailRedirectTo: redirectUrl
      }
    });

    if (error) throw error;

    if (data.session) {
      showToast('تم إنشاء الحساب وتسجيل الدخول بنجاح', 'success');
      hideAuthModal();
    } else {
      successEl.textContent = 'تم إرسال رسالة تأكيد إلى بريدك الإلكتروني! يرجى فتح الرسالة وتأكيد الحساب للمتابعة.';
      successEl.style.display = 'block';
    }
  } catch (err) {
    errorEl.textContent = getArabicAuthErrorMessage(err.message);
    errorEl.style.display = 'block';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'إنشاء الحساب وتأكيد الإيميل';
  }
}

// استعادة كلمة المرور
async function handleForgotPassword(email) {
  const supabase = getSupabase();
  if (!supabase) return;

  const errorEl = document.getElementById('forgotErrorMsg');
  const successEl = document.getElementById('forgotSuccessMsg');
  const submitBtn = document.getElementById('forgotSubmitBtn');
  errorEl.style.display = 'none';
  successEl.style.display = 'none';
  submitBtn.disabled = true;

  try {
    const redirectUrl = window.location.origin + window.location.pathname;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: redirectUrl
    });
    if (error) throw error;

    successEl.textContent = 'تم إرسال رابط استعادة كلمة المرور إلى بريدك الإلكتروني بنجاح.';
    successEl.style.display = 'block';
  } catch (err) {
    errorEl.textContent = getArabicAuthErrorMessage(err.message);
    errorEl.style.display = 'block';
  } finally {
    submitBtn.disabled = false;
  }
}

// حفظ كلمة المرور الجديدة بعد الاستعادة
async function handleResetPassword(newPassword) {
  const supabase = getSupabase();
  if (!supabase) return;

  const errorEl = document.getElementById('resetPasswordErrorMsg');
  const submitBtn = document.getElementById('resetPasswordSubmitBtn');
  errorEl.style.display = 'none';
  submitBtn.disabled = true;

  try {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;

    showToast('تم تحديث كلمة المرور بنجاح!', 'success');
    hideAuthModal();
  } catch (err) {
    errorEl.textContent = getArabicAuthErrorMessage(err.message);
    errorEl.style.display = 'block';
  } finally {
    submitBtn.disabled = false;
  }
}

// تسجيل الخروج
async function handleLogout() {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.auth.signOut();
  showToast('تم تسجيل الخروج بنجاح', 'info');
}

function getArabicAuthErrorMessage(msg) {
  if (!msg) return 'حدث خطأ غير متوقع';
  if (msg.includes('Invalid login credentials')) return 'البريد الإلكتروني أو كلمة المرور غير صحيحة';
  if (msg.includes('Email not confirmed')) return 'يرجى تأكيد بريدك الإلكتروني أولاً عبر الرابط المرسل إليك';
  if (msg.includes('User already registered')) return 'هذا البريد الإلكتروني مسجل مسبقاً، يمكنك تسجيل الدخول به';
  if (msg.includes('Password should be at least')) return 'كلمة المرور يجب ألا تقل عن 6 أحرف';
  if (msg.includes('rate limit')) return 'تم تجاوز الحد المسموح من المحاولات، يرجى المحاولة بعد قليل';
  return msg;
}

// ========================================================
// 4. المحلات والعضويات (Stores & Multi-Tenancy)
// ========================================================
async function loadUserStores() {
  const supabase = getSupabase();
  if (!supabase || !state.user) return;

  try {
    // جلب محلات المستخدم من جدول memberships مع بيانات المحل
    const { data, error } = await supabase
      .from('memberships')
      .select(`
        role,
        store_id,
        stores (
          id,
          name,
          description
        )
      `)
      .eq('user_id', state.user.id);

    if (error) throw error;

    state.stores = (data || []).map(m => ({
      id: m.stores.id,
      name: m.stores.name,
      description: m.stores.description,
      role: m.role
    }));

    updateStoreSelectDropdown();

    if (state.stores.length > 0) {
      // اختيار المحل النشط (المحفوظ سابقاً أو الأول)
      const lastSelectedId = sessionStorage.getItem(`active_store_${state.user.id}`);
      const targetStore = state.stores.find(s => s.id === lastSelectedId) || state.stores[0];
      await switchActiveStore(targetStore.id);
    } else {
      // المستخدم ليس عضواً في أي محل بعد
      clearActiveStoreData();
      state.activeStoreId = null;
      state.activeStore = null;
      updateUserHeaderUI();
      renderAllViews();
    }
  } catch (err) {
    console.error('Error loading stores:', err);
    showToast('تعذر جلب قائمة المحلات', 'error');
  }
}

function updateStoreSelectDropdown() {
  const select = document.getElementById('activeStoreSelect');
  select.innerHTML = '';
  state.stores.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = `${s.name} (${s.role === 'owner' ? 'مالك' : s.role === 'manager' ? 'مدير' : 'موظف'})`;
    if (s.id === state.activeStoreId) opt.selected = true;
    select.appendChild(opt);
  });
}

// تبديل المحل النشط ومسح بيانات المحل السابق تماماً
async function switchActiveStore(storeId) {
  if (!state.user) return;
  const target = state.stores.find(s => s.id === storeId);
  if (!target) return;

  // 1. مسح بيانات واشتراكات المحل السابق فوراً
  clearActiveStoreData();

  // 2. تعيين المحل النشط الجديد
  state.activeStoreId = target.id;
  state.activeStore = target;
  sessionStorage.setItem(`active_store_${state.user.id}`, target.id);

  updateStoreSelectDropdown();
  updateUserHeaderUI();
  document.getElementById('headerSubtitle').textContent = `تسليم المهام والنواقص في: ${target.name}`;

  // 3. جلب بيانات المحل الجديد
  await loadStoreData(target.id);

  // 4. تفعيل الاستماع اللحظي (Realtime) محصوراً بالمحل الجديد
  setupStoreRealtime(target.id);
}

// إنشاء محل جديد (المنشئ يصبح المالك تلقائياً عبر RPC ذري)
async function handleCreateStore(name, description) {
  const supabase = getSupabase();
  if (!supabase || !state.user) return;

  const errorEl = document.getElementById('createStoreErrorMsg');
  const saveBtn = document.getElementById('saveStoreBtn');
  errorEl.style.display = 'none';
  saveBtn.disabled = true;

  try {
    const { data, error } = await supabase.rpc('rpc_create_store', {
      store_name: name.trim(),
      store_description: description ? description.trim() : null
    });

    if (error) throw error;

    showToast(`تم إنشاء محل "${name}" بنجاح وتعيينك مالكاً له`, 'success');
    hideCreateStoreModal();

    // إعادة تحميل المحلات واختيار المحل الجديد
    await loadUserStores();
    if (data && data.store_id) {
      await switchActiveStore(data.store_id);
    }
  } catch (err) {
    errorEl.textContent = err.message || 'حدث خطأ أثناء إنشاء المحل';
    errorEl.style.display = 'block';
  } finally {
    saveBtn.disabled = false;
  }
}

// ========================================================
// 5. جلب بيانات المحل النشط (Requests & Announcements)
// ========================================================
async function loadStoreData(storeId) {
  const supabase = getSupabase();
  if (!supabase || !storeId) return;

  const spinner = document.getElementById('itemsLoadingSpinner');
  if (spinner) spinner.style.display = 'flex';

  try {
    // 1. جلب الطلبات (محمية بـ RLS على مستوى store_id)
    const { data: requests, error: reqErr } = await supabase
      .from('requests')
      .select('*')
      .eq('store_id', storeId)
      .order('created_at', { ascending: false });

    if (reqErr) throw reqErr;
    state.requests = requests || [];

    // 2. جلب التبليغات
    const { data: announcements, error: annErr } = await supabase
      .from('announcements')
      .select('*')
      .eq('store_id', storeId)
      .order('created_at', { ascending: false });

    if (annErr) throw annErr;
    state.announcements = announcements || [];

    // 3. جلب الاطلاع على التبليغات
    const { data: reads, error: readErr } = await supabase
      .from('announcement_reads')
      .select('*')
      .eq('store_id', storeId);

    if (readErr) throw readErr;
    state.announcementReads = reads || [];

    renderAllViews();
  } catch (err) {
    console.error('Error fetching store data:', err);
    showToast('تعذر تحميل بيانات المحل. يرجى التأكد من العضوية.', 'error');
  } finally {
    if (spinner) spinner.style.display = 'none';
  }
}

// تفعيل الاشتراكات اللحظية لمحل محدد
function setupStoreRealtime(storeId) {
  const supabase = getSupabase();
  if (!supabase || !storeId) return;

  if (state.realtimeChannel) {
    supabase.removeChannel(state.realtimeChannel);
  }

  state.realtimeChannel = supabase
    .channel(`store_realtime_${storeId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'requests', filter: `store_id=eq.${storeId}` },
      payload => {
        handleRealtimeRequestChange(payload);
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'announcements', filter: `store_id=eq.${storeId}` },
      payload => {
        handleRealtimeAnnouncementChange(payload);
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'announcement_reads', filter: `store_id=eq.${storeId}` },
      payload => {
        handleRealtimeReadsChange(payload);
      }
    )
    .subscribe(status => {
      console.log(`Realtime status for store ${storeId}:`, status);
    });
}

function handleRealtimeRequestChange(payload) {
  const { eventType, new: newRecord, old: oldRecord } = payload;
  if (eventType === 'INSERT') {
    state.requests = [newRecord, ...state.requests.filter(r => r.id !== newRecord.id)];
  } else if (eventType === 'UPDATE') {
    state.requests = state.requests.map(r => r.id === newRecord.id ? newRecord : r);
  } else if (eventType === 'DELETE') {
    state.requests = state.requests.filter(r => r.id !== oldRecord.id);
  }
  renderAllViews();
}

function handleRealtimeAnnouncementChange(payload) {
  const { eventType, new: newRecord, old: oldRecord } = payload;
  if (eventType === 'INSERT') {
    state.announcements = [newRecord, ...state.announcements.filter(a => a.id !== newRecord.id)];
  } else if (eventType === 'UPDATE') {
    state.announcements = state.announcements.map(a => a.id === newRecord.id ? newRecord : a);
  } else if (eventType === 'DELETE') {
    state.announcements = state.announcements.filter(a => a.id !== oldRecord.id);
  }
  renderAllViews();
}

function handleRealtimeReadsChange(payload) {
  const { eventType, new: newRecord, old: oldRecord } = payload;
  if (eventType === 'INSERT') {
    state.announcementReads = [...state.announcementReads, newRecord];
  } else if (eventType === 'DELETE') {
    state.announcementReads = state.announcementReads.filter(r => r.id !== oldRecord.id);
  }
  renderAllViews();
}

// ========================================================
// 6. دعوات الموظفين والانضمام (Invitations)
// ========================================================

// فحص وجود رمز دعوة في الرابط عند الفتح
async function checkUrlForInvitation() {
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('invite');
  if (!token) return;

  state.pendingInviteToken = token;
  const supabase = getSupabase();
  if (!supabase) return;

  // جلب معلومات الدعوة الآمنة (اسم المحل والدور فقط)
  try {
    const { data, error } = await supabase.rpc('rpc_get_invitation_info', {
      invite_token: token
    });

    if (error || !data || !data.valid) {
      showToast(data?.message || 'رمز الدعوة غير صالح أو منتهي الصلاحية', 'error');
      return;
    }

    // عرض نافذة قبول الدعوة
    openAcceptInviteModal(data);
  } catch (err) {
    console.error('Error verifying invitation:', err);
  }
}

function openAcceptInviteModal(inviteInfo) {
  const modal = document.getElementById('acceptInviteModal');
  document.getElementById('inviteStoreName').textContent = inviteInfo.store_name;
  const roleNameMap = { manager: 'مدير', staff: 'موظف' };
  document.getElementById('inviteRoleName').textContent = roleNameMap[inviteInfo.role] || inviteInfo.role;
  document.getElementById('acceptInviteErrorMsg').style.display = 'none';

  modal.style.display = 'flex';
}

// قبول الدعوة ذرياً على الخادم
async function handleAcceptInvitation() {
  const supabase = getSupabase();
  if (!supabase) return;

  if (!state.user) {
    // يجب تسجيل الدخول أولاً لقبول الدعوة
    document.getElementById('acceptInviteModal').style.display = 'none';
    showToast('يرجى تسجيل الدخول أو إنشاء حساب أولاً للانضمام للمحل', 'info');
    openAuthModal('login');
    return;
  }

  const confirmBtn = document.getElementById('confirmAcceptInviteBtn');
  const errorEl = document.getElementById('acceptInviteErrorMsg');
  errorEl.style.display = 'none';
  confirmBtn.disabled = true;

  try {
    const { data, error } = await supabase.rpc('rpc_accept_invitation', {
      invite_token: state.pendingInviteToken
    });

    if (error) throw error;

    showToast(data.message || 'تم الانضمام للمحل بنجاح!', 'success');
    document.getElementById('acceptInviteModal').style.display = 'none';

    // تنظيف الرابط من معامل الدعوة دون إعادة تحميل الصفحة
    const cleanUrl = window.location.origin + window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);
    state.pendingInviteToken = null;

    // إعادة تحميل المحلات والتبديل للمحل الجديد
    await loadUserStores();
    if (data.store_id) {
      await switchActiveStore(data.store_id);
    }
  } catch (err) {
    errorEl.textContent = err.message || 'تعذر قبول الدعوة';
    errorEl.style.display = 'block';
  } finally {
    confirmBtn.disabled = false;
  }
}

// إنشاء رابط دعوة جديد (للمالك والمدير فقط)
async function handleCreateInvitation(role, hours) {
  const supabase = getSupabase();
  if (!supabase || !state.activeStoreId) return;

  const btn = document.getElementById('generateInviteBtn');
  btn.disabled = true;

  try {
    const { data, error } = await supabase.rpc('rpc_create_invitation', {
      target_store_id: state.activeStoreId,
      invite_role: role,
      duration_hours: parseInt(hours, 10)
    });

    if (error) throw error;

    // بناء رابط الدعوة ليعمل على مسار النشر الحالي (GitHub Pages أو Local)
    const baseOrigin = window.location.origin;
    const basePath = window.location.pathname;
    const inviteUrl = `${baseOrigin}${basePath}?invite=${data.token}`;

    const linkBox = document.getElementById('generatedLinkBox');
    const input = document.getElementById('generatedLinkInput');
    input.value = inviteUrl;
    linkBox.style.display = 'flex';

    showToast('تم إنشاء رابط الدعوة بنجاح', 'success');
    await loadTeamData();
  } catch (err) {
    showToast(err.message || 'تعذر إنشاء رابط الدعوة', 'error');
  } finally {
    btn.disabled = false;
  }
}

// إلغاء رابط دعوة
async function handleRevokeInvitation(inviteId) {
  const supabase = getSupabase();
  if (!supabase) return;

  try {
    const { error } = await supabase.rpc('rpc_revoke_invitation', {
      invitation_id: inviteId
    });
    if (error) throw error;
    showToast('تم إلغاء رابط الدعوة', 'info');
    await loadTeamData();
  } catch (err) {
    showToast(err.message || 'تعذر إلغاء الدعوة', 'error');
  }
}

// ========================================================
// 7. إدارة الفريق والصلاحيات (Team & Roles Management)
// ========================================================
async function loadTeamData() {
  const supabase = getSupabase();
  if (!supabase || !state.activeStoreId) return;

  try {
    // 1. جلب الأعضاء
    const { data: members, error: mErr } = await supabase
      .from('memberships')
      .select(`
        user_id,
        role,
        created_at,
        profiles (
          full_name,
          email
        )
      `)
      .eq('store_id', state.activeStoreId);

    if (mErr) throw mErr;
    state.members = members || [];

    // 2. جلب الدعوات
    const { data: invitations, error: iErr } = await supabase
      .from('invitations')
      .select('*')
      .eq('store_id', state.activeStoreId)
      .order('created_at', { ascending: false });

    if (iErr) throw iErr;
    state.invitations = invitations || [];

    renderTeamTables();
  } catch (err) {
    console.error('Error loading team data:', err);
  }
}

function renderTeamTables() {
  const tbody = document.getElementById('membersTableBody');
  const myRole = state.activeStore?.role;
  tbody.innerHTML = '';

  state.members.forEach(m => {
    const isMe = m.user_id === state.user?.id;
    const tr = document.createElement('tr');

    const roleMap = { owner: 'مالك 👑', manager: 'مدير 🛡️', staff: 'موظف 💼' };
    const roleBadgeClass = `badge-${m.role}`;

    // إجراءات العضو:
    // - المالك يستطيع تغيير دور الآخرين (ولا يستطيع تغيير دوره بنفسه لمنع تدمير الصلاحيات)
    // - المالك يستطيع إزالة أي عضو (مع منع إزالة آخر مالك من الخادم)
    // - المدير يستطيع إزالة الموظفين العاديين فقط
    let actionsHtml = '';
    if (myRole === 'owner' && !isMe) {
      actionsHtml = `
        <select class="custom-select" style="padding:0.2rem 0.5rem;font-size:0.75rem;" onchange="changeMemberRole('${m.user_id}', this.value)">
          <option value="owner" ${m.role === 'owner' ? 'selected' : ''}>مالك</option>
          <option value="manager" ${m.role === 'manager' ? 'selected' : ''}>مدير</option>
          <option value="staff" ${m.role === 'staff' ? 'selected' : ''}>موظف</option>
        </select>
        <button type="button" class="btn-tool btn-tool-delete" onclick="removeMember('${m.user_id}', '${escapeHtml(m.profiles?.full_name)}')">إزالة</button>
      `;
    } else if (myRole === 'manager' && !isMe && m.role === 'staff') {
      actionsHtml = `
        <button type="button" class="btn-tool btn-tool-delete" onclick="removeMember('${m.user_id}', '${escapeHtml(m.profiles?.full_name)}')">إزالة</button>
      `;
    } else if (isMe) {
      actionsHtml = `<span style="font-size:0.75rem;color:var(--text-muted);">(حسابك)</span>`;
    }

    tr.innerHTML = `
      <td><strong>${escapeHtml(m.profiles?.full_name || 'مستخدم')}</strong></td>
      <td dir="ltr" style="text-align:right;">${escapeHtml(m.profiles?.email || '-')}</td>
      <td><span class="role-tag-badge ${roleBadgeClass}">${roleMap[m.role] || m.role}</span></td>
      <td>${new Date(m.created_at).toLocaleDateString('ar-EG')}</td>
      <td>${actionsHtml}</td>
    `;
    tbody.appendChild(tr);
  });

  // جدول الدعوات
  const invBody = document.getElementById('invitationsTableBody');
  invBody.innerHTML = '';
  if (state.invitations.length === 0) {
    invBody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);">لا توجد دعوات مسجلة لهذا المحل</td></tr>`;
    return;
  }

  state.invitations.forEach(inv => {
    const tr = document.createElement('tr');
    const isExpired = new Date(inv.expires_at) < new Date();
    let statusText = 'نشطة وصالحة';
    let statusColor = '#059669';

    if (inv.is_revoked) {
      statusText = 'ملغاة';
      statusColor = '#dc2626';
    } else if (inv.used_at) {
      statusText = 'مستخدمة';
      statusColor = '#475569';
    } else if (isExpired) {
      statusText = 'منتهية الصلاحية';
      statusColor = '#d97706';
    }

    const canRevoke = !inv.is_revoked && !inv.used_at && !isExpired;

    tr.innerHTML = `
      <td><code style="font-size:0.75rem;">${inv.token.substring(0, 8)}...</code></td>
      <td>${inv.role === 'manager' ? 'مدير' : 'موظف'}</td>
      <td>${new Date(inv.expires_at).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })}</td>
      <td><strong style="color:${statusColor};font-size:0.8rem;">${statusText}</strong></td>
      <td>
        ${canRevoke ? `<button type="button" class="btn-tool btn-tool-delete" onclick="handleRevokeInvitation('${inv.id}')">إلغاء الدعوة</button>` : '-'}
      </td>
    `;
    invBody.appendChild(tr);
  });
}

// تغيير دور عضو
window.changeMemberRole = async function(userId, newRole) {
  const supabase = getSupabase();
  if (!supabase || !state.activeStoreId) return;

  try {
    const { error } = await supabase.rpc('rpc_update_member_role', {
      target_store_id: state.activeStoreId,
      target_user_id: userId,
      new_role: newRole
    });
    if (error) throw error;
    showToast('تم تحديث دور العضو بنجاح', 'success');
    await loadTeamData();
  } catch (err) {
    showToast(err.message || 'تعذر تحديث الدور', 'error');
    await loadTeamData();
  }
};

// إزالة عضو من المحل
window.removeMember = async function(userId, name) {
  if (!confirm(`هل أنت متأكد من رغبتك في إزالة الموظف (${name}) من هذا المحل؟ سيتم منع وصوله فوراً لبيانات المحل مع الاحتفاظ بسجل أعماله السابقة.`)) {
    return;
  }

  const supabase = getSupabase();
  if (!supabase || !state.activeStoreId) return;

  try {
    const { error } = await supabase.rpc('rpc_remove_member', {
      target_store_id: state.activeStoreId,
      target_user_id: userId
    });
    if (error) throw error;
    showToast(`تمت إزالة ${name} من المحل`, 'info');
    await loadTeamData();
  } catch (err) {
    showToast(err.message || 'تعذر إزالة العضو', 'error');
  }
};

// ========================================================
// 8. العمليات الذرية للطلبات (Atomic Operations)
// ========================================================

// 1. «أني أتابعه» - استلام ذري مع قفل تنافسي (FOR UPDATE)
window.handleTakeTask = async function(id) {
  const supabase = getSupabase();
  if (!supabase || !state.user || !state.activeStoreId) {
    showToast('يرجى تسجيل الدخول أولاً', 'error');
    return;
  }

  try {
    const { data, error } = await supabase.rpc('rpc_claim_request', {
      req_id: id
    });

    if (error) throw error;

    if (data.conflict) {
      // حاول موظفان استلام نفس الطلب معاً فنجح الأول وظهرت للثاني رسالة واضحة
      showToast(data.message, 'error');
    } else {
      showToast(data.message || 'تم استلام متابعة الطلب بنجاح', 'success');
    }
  } catch (err) {
    showToast(err.message || 'تعذر استلام الطلب', 'error');
  }
};

// 2. إلغاء استلام الطلب
window.handleCancelTake = async function(id) {
  const supabase = getSupabase();
  if (!supabase) return;

  try {
    const { error } = await supabase.rpc('rpc_cancel_claim_request', {
      req_id: id
    });
    if (error) throw error;
    showToast('تم إلغاء استلام الطلب وأصبح متاحاً للزملاء', 'info');
  } catch (err) {
    showToast(err.message || 'تعذر إلغاء الاستلام', 'error');
  }
};

// 3. الحجز: جاهز للاستلام
window.handleSetReady = async function(id) {
  await updateRequestStatus(id, 'ready', 'أصبح الحجز جاهزاً للاستلام من قبل الزبون');
};

// 4. الحجز: عودة للتجهيز
window.handleBackToProgress = async function(id) {
  await updateRequestStatus(id, 'in_progress', 'تمت إعادة الحجز إلى قيد التجهيز');
};

// 5. إنجاز الطلب (تم التوفير / تم التسليم للزبون)
window.handleCompleteTask = async function(id) {
  await updateRequestStatus(id, 'completed', 'تم إنجاز الطلب بنجاح ✓');
};

// 6. إعادة فتح الطلب المكتمل بالخطأ
window.handleReopenTask = async function(id) {
  await updateRequestStatus(id, 'in_progress', 'تمت إعادة فتح الطلب للمتابعة');
};

async function updateRequestStatus(id, newStatus, successMsg) {
  const supabase = getSupabase();
  if (!supabase) return;

  try {
    const { error } = await supabase.rpc('rpc_update_request_status', {
      req_id: id,
      new_status: newStatus
    });
    if (error) throw error;
    showToast(successMsg, 'success');
  } catch (err) {
    showToast(err.message || 'تعذر تحديث حالة الطلب', 'error');
  }
}

// 7. التبليغات: زر «اطّلعت»
window.handleAcknowledge = async function(announcementId) {
  const supabase = getSupabase();
  if (!supabase || !state.user || !state.activeStoreId) return;

  // التحقق إذا كان قد اطلع مسبقاً
  const alreadyRead = state.announcementReads.some(
    r => r.announcement_id === announcementId && r.user_id === state.user.id
  );

  if (alreadyRead) {
    showToast('أنت مسجل بالفعل ضمن من اطّلعوا على هذا التبليغ', 'info');
    return;
  }

  try {
    const { error } = await supabase
      .from('announcement_reads')
      .insert({
        announcement_id: announcementId,
        store_id: state.activeStoreId,
        user_id: state.user.id,
        user_name: state.user.full_name
      });

    if (error) throw error;
    showToast('تم تسجيل اطّلاعك على التبليغ بنجاح', 'success');
  } catch (err) {
    showToast(err.message || 'تعذر تسجيل الاطلاع', 'error');
  }
};

// ========================================================
// 9. إضافة وتعديل وحذف الطلبات (Requests CRUD with RLS)
// ========================================================
async function handleSaveRequest(formData) {
  const supabase = getSupabase();
  if (!supabase || !state.user || !state.activeStoreId) {
    showToast('يرجى اختيار المحل وتسجيل الدخول', 'error');
    return;
  }

  const saveBtn = document.getElementById('saveRequestBtn');
  saveBtn.disabled = true;

  try {
    if (formData.id) {
      // تعديل طلب موجود (تتحقق منه RLS: مالك أو مدير أو كاتب الطلب أو المسؤول)
      if (formData.category === 'announcement') {
        const { error } = await supabase
          .from('announcements')
          .update({
            title: formData.title,
            details: formData.details,
            priority: formData.priority,
            due_date: formData.dueDate,
            updated_at: new Date().toISOString()
          })
          .eq('id', formData.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('requests')
          .update({
            category: formData.category,
            title: formData.title,
            details: formData.details,
            priority: formData.priority,
            due_date: formData.dueDate,
            quantity: formData.category === 'shortage' ? formData.quantity : null,
            customer_name: formData.category === 'reservation' ? formData.customerName : null,
            customer_phone: formData.category === 'reservation' ? formData.customerPhone : null,
            updated_at: new Date().toISOString()
          })
          .eq('id', formData.id);
        if (error) throw error;
      }
      showToast('تم تحديث الطلب بنجاح', 'success');
    } else {
      // إضافة طلب جديد (مرتبط بالـ store_id النشط ومُسجل باسم المستخدم والشفت الحالي تلقائياً)
      if (formData.category === 'announcement') {
        const { error } = await supabase
          .from('announcements')
          .insert({
            store_id: state.activeStoreId,
            title: formData.title,
            details: formData.details || '',
            priority: formData.priority,
            due_date: formData.dueDate,
            author_id: state.user.id,
            author_name: state.user.full_name,
            shift: state.currentShift
          });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('requests')
          .insert({
            store_id: state.activeStoreId,
            category: formData.category,
            title: formData.title,
            details: formData.details,
            priority: formData.priority,
            due_date: formData.dueDate,
            quantity: formData.category === 'shortage' ? formData.quantity : null,
            customer_name: formData.category === 'reservation' ? formData.customerName : null,
            customer_phone: formData.category === 'reservation' ? formData.customerPhone : null,
            author_id: state.user.id,
            author_name: state.user.full_name,
            shift: state.currentShift,
            status: 'new'
          });
        if (error) throw error;
      }
      showToast('تمت إضافة ونشر الطلب في المحل بنجاح', 'success');
    }

    hideRequestModal();
  } catch (err) {
    showToast(err.message || 'تعذر حفظ الطلب', 'error');
  } finally {
    saveBtn.disabled = false;
  }
}

// حذف طلب
async function handleDeleteRequest(id, isAnnouncement = false) {
  const supabase = getSupabase();
  if (!supabase) return;

  const confirmBtn = document.getElementById('confirmDeleteBtn');
  confirmBtn.disabled = true;

  try {
    const table = isAnnouncement ? 'announcements' : 'requests';
    const { error } = await supabase
      .from(table)
      .delete()
      .eq('id', id);

    if (error) throw error;

    showToast('تم حذف الطلب بنجاح', 'info');
    document.getElementById('deleteConfirmModal').style.display = 'none';
    state.deletingRequestId = null;
  } catch (err) {
    showToast(err.message || 'تعذر حذف الطلب. قد لا تملك الصلاحية الكافية.', 'error');
  } finally {
    confirmBtn.disabled = false;
  }
}

// ========================================================
// 10. الرندرة والتصفية (Rendering & Views)
// ========================================================
function renderAllViews() {
  const noStoreView = document.getElementById('noStoreView');
  const storeWorkspaceView = document.getElementById('storeWorkspaceView');

  if (!state.user) {
    // غير مسجل: لا تعرض بيانات المحل
    noStoreView.style.display = 'none';
    storeWorkspaceView.style.display = 'none';
    return;
  }

  if (state.stores.length === 0 || !state.activeStore) {
    // مسجل لكن ليس في أي محل بعد
    noStoreView.style.display = 'flex';
    storeWorkspaceView.style.display = 'none';
    return;
  }

  // مستخدم عضو في محل نشط
  noStoreView.style.display = 'none';
  storeWorkspaceView.style.display = 'block';

  renderStatsAndTabs();
  renderActiveFiltersNotice();
  renderItemsList();
}

function getOtherShift() {
  return state.currentShift === 'صباحي' ? 'مسائي' : 'صباحي';
}

function calculateCounts() {
  const otherShift = getOtherShift();
  let total = state.requests.length + state.announcements.length;
  let newCount = 0;
  let progressCount = 0;
  let doneCount = 0;
  let prevShiftOpenCount = 0;
  let myTasksCount = 0;

  let reservationCount = 0;
  let shortageCount = 0;
  let announcementCount = state.announcements.length;

  state.requests.forEach(r => {
    if (r.category === 'reservation') reservationCount++;
    if (r.category === 'shortage') shortageCount++;

    if (r.status === 'new') newCount++;
    else if (r.status === 'in_progress' || r.status === 'ready') progressCount++;
    else if (r.status === 'completed') doneCount++;

    // المهام المفتوحة من الشفت السابق
    if (r.shift === otherShift && r.status !== 'completed') {
      prevShiftOpenCount++;
    }

    // طلباتي المسندة إليّ
    if (r.assignee_id === state.user?.id && r.status !== 'completed') {
      myTasksCount++;
    }
  });

  return {
    total,
    newCount,
    progressCount,
    doneCount,
    prevShiftOpenCount,
    myTasksCount,
    reservationCount,
    shortageCount,
    announcementCount
  };
}

function renderStatsAndTabs() {
  const counts = calculateCounts();

  document.getElementById('statTotalCount').textContent = counts.total;
  document.getElementById('statNewCount').textContent = counts.newCount;
  document.getElementById('statProgressCount').textContent = counts.progressCount;
  document.getElementById('statDoneCount').textContent = counts.doneCount;

  document.getElementById('badgeAll').textContent = counts.total;
  document.getElementById('badgeReservation').textContent = counts.reservationCount;
  document.getElementById('badgeShortage').textContent = counts.shortageCount;
  document.getElementById('badgeAnnouncement').textContent = counts.announcementCount;

  document.getElementById('myTasksCount').textContent = counts.myTasksCount;

  // إحصائيات باقي من الشفت السابق
  const otherShift = getOtherShift();
  document.getElementById('prevShiftName').textContent = otherShift;
  document.getElementById('prevShiftCount').textContent = counts.prevShiftOpenCount;

  const handoverSection = document.getElementById('handoverSection');
  const handoverToggleBtn = document.getElementById('handoverToggleBtn');
  if (state.filters.handoverOnly) {
    handoverSection.classList.add('is-filtered');
    handoverToggleBtn.classList.add('active');
    document.getElementById('handoverBtnText').innerHTML = `إلغاء التصفية (${counts.prevShiftOpenCount} مهام معلقة)`;
  } else {
    handoverSection.classList.remove('is-filtered');
    handoverToggleBtn.classList.remove('active');
    document.getElementById('handoverBtnText').innerHTML = `عرض مهام الشفت السابق (${counts.prevShiftOpenCount})`;
  }
}

function renderActiveFiltersNotice() {
  const bar = document.getElementById('activeFiltersBar');
  const tag = document.getElementById('activeFilterTag');

  const chips = [];
  if (state.filters.handoverOnly) chips.push(`باقي من الشفت السابق (${getOtherShift()})`);
  if (state.filters.myTasksOnly) chips.push(`طلباتي فقط`);
  if (state.filters.category !== 'all') {
    const catMap = { reservation: 'الحجوزات', shortage: 'النواقص', announcement: 'التبليغات' };
    chips.push(catMap[state.filters.category]);
  }
  if (state.filters.status !== 'all') {
    const statusMap = { new: 'الجديدة', in_progress: 'قيد المتابعة والتجهيز', ready: 'جاهز للاستلام', completed: 'المكتملة' };
    chips.push(statusMap[state.filters.status]);
  }
  if (state.filters.priority !== 'all') {
    chips.push(state.filters.priority === 'urgent' ? 'المستعجل ⚡' : 'العادي');
  }
  if (state.filters.search.trim()) {
    chips.push(`بحث: "${state.filters.search.trim()}"`);
  }

  if (chips.length > 0) {
    bar.style.display = 'flex';
    tag.textContent = chips.join(' • ');
  } else {
    bar.style.display = 'none';
  }
}

function getFilteredItems() {
  const otherShift = getOtherShift();

  // تجميع الطلبات والتبليغات
  let items = [];

  if (state.filters.category === 'all') {
    items = [
      ...state.requests.map(r => ({ ...r, itemType: 'request' })),
      ...state.announcements.map(a => ({ ...a, itemType: 'announcement', category: 'announcement' }))
    ];
  } else if (state.filters.category === 'announcement') {
    items = state.announcements.map(a => ({ ...a, itemType: 'announcement', category: 'announcement' }));
  } else {
    items = state.requests
      .filter(r => r.category === state.filters.category)
      .map(r => ({ ...r, itemType: 'request' }));
  }

  return items.filter(item => {
    // 1. فلتر باقي من الشفت السابق
    if (state.filters.handoverOnly) {
      if (item.itemType === 'announcement') return false;
      if (item.shift !== otherShift || item.status === 'completed') return false;
    }

    // 2. فلتر طلباتي
    if (state.filters.myTasksOnly) {
      if (item.itemType === 'announcement') return false;
      if (item.assignee_id !== state.user?.id) return false;
    }

    // 3. فلتر الحالة
    if (state.filters.status !== 'all') {
      if (item.itemType === 'announcement') return false;
      if (item.status !== state.filters.status) return false;
    }

    // 4. فلتر الأولوية
    if (state.filters.priority !== 'all') {
      if (item.priority !== state.filters.priority) return false;
    }

    // 5. البحث
    if (state.filters.search.trim()) {
      const q = state.filters.search.trim().toLowerCase();
      const match = (item.title || '').toLowerCase().includes(q) ||
                    (item.details || '').toLowerCase().includes(q) ||
                    (item.customer_name || '').toLowerCase().includes(q) ||
                    (item.customer_phone || '').toLowerCase().includes(q) ||
                    (item.quantity || '').toLowerCase().includes(q);
      if (!match) return false;
    }

    return true;
  }).sort((a, b) => {
    if (state.filters.handoverOnly) {
      if (a.priority === 'urgent' && b.priority !== 'urgent') return -1;
      if (b.priority === 'urgent' && a.priority !== 'urgent') return 1;
    }
    return new Date(b.created_at) - new Date(a.created_at);
  });
}

function renderItemsList() {
  const container = document.getElementById('itemsContainer');
  const emptyState = document.getElementById('emptyState');
  container.innerHTML = '';

  const items = getFilteredItems();

  if (items.length === 0) {
    emptyState.style.display = 'flex';
    return;
  }

  emptyState.style.display = 'none';
  items.forEach(item => {
    const card = createItemCardElement(item);
    container.appendChild(card);
  });
}

function createItemCardElement(item) {
  const card = document.createElement('article');
  card.className = `request-card type-${item.category} ${item.priority === 'urgent' ? 'is-urgent' : ''} ${item.status === 'completed' ? 'is-completed' : ''}`;
  card.setAttribute('data-id', item.id);

  const isAnnouncement = item.category === 'announcement';

  let categoryLabel = 'حجز زبون';
  let categoryIcon = '📦';
  let badgeClass = 'badge-reservation';

  if (item.category === 'shortage') {
    categoryLabel = 'نقص مستلزمات';
    categoryIcon = '🛒';
    badgeClass = 'badge-shortage';
  } else if (isAnnouncement) {
    categoryLabel = 'تبليغ عام';
    categoryIcon = '📢';
    badgeClass = 'badge-announcement';
  }

  let statusBadgeHtml = '';
  if (!isAnnouncement) {
    const statusMap = {
      new: '<span class="badge badge-status-new">🆕 جديد</span>',
      in_progress: `<span class="badge badge-status-progress">⏳ ${item.category === 'reservation' ? 'قيد التجهيز' : 'قيد المتابعة'}</span>`,
      ready: '<span class="badge badge-status-ready">📦 جاهز للاستلام</span>',
      completed: `<span class="badge badge-status-completed">✅ ${item.category === 'reservation' ? 'تم التسليم' : 'مكتمل'}</span>`
    };
    statusBadgeHtml = statusMap[item.status] || '';
  }

  const priorityBadgeHtml = item.priority === 'urgent'
    ? '<span class="badge badge-urgent">⚡ مستعجل</span>'
    : '<span class="badge badge-normal">عادي</span>';

  let metaChipsHtml = '';
  if (item.quantity) {
    metaChipsHtml += `<span class="meta-chip">🔢 الكمية: <strong>${escapeHtml(item.quantity)}</strong></span>`;
  }
  if (item.customer_name) {
    metaChipsHtml += `<span class="meta-chip">👤 الزبون: <strong>${escapeHtml(item.customer_name)}</strong></span>`;
  }
  if (item.customer_phone) {
    metaChipsHtml += `<span class="meta-chip">📞 <span dir="ltr">${escapeHtml(item.customer_phone)}</span></span>`;
  }
  if (item.due_date) {
    metaChipsHtml += `<span class="meta-chip chip-due">⏰ المطلوب: <strong>${escapeHtml(item.due_date)}</strong></span>`;
  }

  // صلاحيات التعديل والحذف:
  // المالك والمدير وكاتب الطلب يستطيعون التعديل والحذف
  const canManage = state.activeStore?.role === 'owner' ||
                    state.activeStore?.role === 'manager' ||
                    item.author_id === state.user?.id;

  let toolsHtml = '';
  if (canManage) {
    toolsHtml = `
      <div class="card-quick-tools">
        <button type="button" class="btn-tool" onclick="openEditModal('${item.id}', ${isAnnouncement})" title="تعديل">✏️ تعديل</button>
        <button type="button" class="btn-tool btn-tool-delete" onclick="openDeleteModal('${item.id}', '${escapeHtml(item.title)}', ${isAnnouncement})" title="حذف">🗑️</button>
      </div>
    `;
  }

  let footerHtml = '';
  if (isAnnouncement) {
    // قائمة من اطّلعوا
    const readers = state.announcementReads.filter(r => r.announcement_id === item.id);
    const hasRead = readers.some(r => r.user_id === state.user?.id);
    const readerNames = readers.map(r => r.user_name).join('، ');

    footerHtml = `
      <div class="card-footer">
        <div class="announcement-readers">
          <div class="announcement-readers-title">
            <span>👁️ اطّلع عليه (${readers.length}):</span>
          </div>
          <div class="announcement-readers-list">
            ${readerNames || 'لم يطّلع عليه أحد بعد'}
          </div>
        </div>
        <div class="card-action-buttons">
          <button type="button" class="btn btn-card-action btn-ack ${hasRead ? 'already-acked' : ''}" onclick="handleAcknowledge('${item.id}')">
            ${hasRead ? '✓ اطّلعت عليه' : '👍 اطّلعت'}
          </button>
        </div>
      </div>
    `;
  } else {
    // الحجوزات والنواقص
    let assigneeText = '';
    const isMe = item.assignee_id === state.user?.id;

    if (!item.assignee_id) {
      assigneeText = `<span class="unassigned-text">⚠️ بدون مسؤول حالياً</span>`;
    } else {
      assigneeText = `<span class="assignee-name">👤 المسؤول: <strong>${escapeHtml(item.assignee_name)}</strong> ${isMe ? '(أنت)' : ''}</span>`;
    }

    let actionButtonsHtml = '';
    if (item.status === 'new') {
      actionButtonsHtml = `
        <button type="button" class="btn btn-card-action btn-take-task" onclick="handleTakeTask('${item.id}')">
          ✋ أني أتابعه
        </button>
      `;
    } else if (item.status === 'in_progress') {
      if (item.category === 'reservation') {
        actionButtonsHtml = `
          <button type="button" class="btn btn-card-action btn-step-ready" onclick="handleSetReady('${item.id}')">
            📦 جاهز للاستلام
          </button>
          <button type="button" class="btn btn-card-action btn-cancel-take" onclick="handleCancelTake('${item.id}')">
            ↩️ إلغاء استلامي
          </button>
        `;
      } else {
        actionButtonsHtml = `
          <button type="button" class="btn btn-card-action btn-step-done" onclick="handleCompleteTask('${item.id}')">
            ✅ تم التوفير
          </button>
          <button type="button" class="btn btn-card-action btn-cancel-take" onclick="handleCancelTake('${item.id}')">
            ↩️ إلغاء استلامي
          </button>
        `;
      }
    } else if (item.status === 'ready') {
      actionButtonsHtml = `
        <button type="button" class="btn btn-card-action btn-step-done" onclick="handleCompleteTask('${item.id}')">
          🤝 تم التسليم للزبون
        </button>
        <button type="button" class="btn btn-card-action btn-outline" onclick="handleBackToProgress('${item.id}')">
          ↩️ عودة للتجهيز
        </button>
      `;
    } else if (item.status === 'completed') {
      actionButtonsHtml = `
        <button type="button" class="btn btn-card-action btn-reopen" onclick="handleReopenTask('${item.id}')">
          🔄 إعادة فتح الطلب
        </button>
      `;
    }

    footerHtml = `
      <div class="card-footer">
        <div class="assignee-info-bar">
          ${assigneeText}
        </div>
        <div class="card-action-buttons">
          ${actionButtonsHtml}
        </div>
      </div>
    `;
  }

  card.innerHTML = `
    <div class="card-header">
      <div class="card-title-wrap">
        <div class="card-badges-row">
          <span class="badge ${badgeClass}">${categoryIcon} ${categoryLabel}</span>
          ${statusBadgeHtml}
          ${priorityBadgeHtml}
        </div>
        <h3 class="card-title">${escapeHtml(item.title)}</h3>
      </div>
      ${toolsHtml}
    </div>

    <div class="card-body">
      ${item.details ? `<p class="card-details">${escapeHtml(item.details)}</p>` : ''}
      ${metaChipsHtml ? `<div class="card-meta-chips">${metaChipsHtml}</div>` : ''}

      <div class="card-origin-stamp">
        <span>كتبه: <strong class="origin-author">${escapeHtml(item.author_name)}</strong></span>
        <span class="origin-shift">الشفت ${escapeHtml(item.shift)}</span>
        <span>• ${formatRelativeTime(item.created_at)}</span>
      </div>
    </div>

    ${footerHtml}
  `;

  return card;
}

function formatRelativeTime(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const now = new Date();
  const diffMins = Math.floor((now - date) / (1000 * 60));
  const diffHours = Math.floor(diffMins / 60);

  if (diffMins < 1) return 'الآن';
  if (diffMins < 60) return `منذ ${diffMins} دقيقة`;
  if (diffHours < 24) return `منذ ${diffHours} ساعة`;
  return date.toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.25s ease';
    setTimeout(() => toast.remove(), 250);
  }, 3200);
}

function showNotice(text, badge = 'تنبيه', showAction = false, actionCallback = null) {
  const bar = document.getElementById('noticeBar');
  const badgeEl = document.getElementById('noticeBadge');
  const textEl = document.getElementById('noticeText');
  const actionBtn = document.getElementById('noticeActionBtn');

  badgeEl.textContent = badge;
  textEl.textContent = text;
  bar.style.display = 'block';

  if (showAction && actionCallback) {
    actionBtn.style.display = 'inline-block';
    actionBtn.onclick = actionCallback;
  } else {
    actionBtn.style.display = 'none';
  }
}

// ========================================================
// 11. النوافذ المنبثقة (Modals Handling)
// ========================================================

// 11.1 Auth Modal
function openAuthModal(view = 'login') {
  const modal = document.getElementById('authModal');
  switchAuthTab(view);
  modal.style.display = 'flex';
}

function hideAuthModal() {
  document.getElementById('authModal').style.display = 'none';
}

function switchAuthTab(tab) {
  const tabs = ['login', 'register', 'forgot', 'resetPassword'];
  const titles = {
    login: 'تسجيل الدخول',
    register: 'إنشاء حساب جديد',
    forgot: 'استعادة كلمة المرور',
    resetPassword: 'تعيين كلمة مرور جديدة'
  };

  document.getElementById('authModalTitle').textContent = titles[tab] || 'تسجيل الدخول';

  // تبديل الأزرار النشطة
  document.getElementById('tabLoginBtn').classList.toggle('active', tab === 'login');
  document.getElementById('tabRegisterBtn').classList.toggle('active', tab === 'register');
  document.getElementById('tabForgotBtn').classList.toggle('active', tab === 'forgot');

  // إخفاء/إظهار النماذج
  document.getElementById('loginForm').style.display = tab === 'login' ? 'flex' : 'none';
  document.getElementById('registerForm').style.display = tab === 'register' ? 'flex' : 'none';
  document.getElementById('forgotForm').style.display = tab === 'forgot' ? 'flex' : 'none';
  document.getElementById('resetPasswordForm').style.display = tab === 'resetPassword' ? 'flex' : 'none';

  // شريط التبويب يختفي أثناء إعادة تعيين كلمة المرور
  document.getElementById('authTabsNav').style.display = tab === 'resetPassword' ? 'none' : 'flex';
}

// 11.2 Create Store Modal
function openCreateStoreModal() {
  document.getElementById('createStoreForm').reset();
  document.getElementById('createStoreErrorMsg').style.display = 'none';
  document.getElementById('createStoreModal').style.display = 'flex';
}

function hideCreateStoreModal() {
  document.getElementById('createStoreModal').style.display = 'none';
}

// 11.3 Team Modal
async function openTeamModal() {
  const modal = document.getElementById('teamModal');
  document.getElementById('teamStoreNameLabel').textContent = state.activeStore?.name || '';
  document.getElementById('generatedLinkBox').style.display = 'none';

  // خيار دعوة المدير يظهر للمالك فقط
  const managerOpt = document.getElementById('inviteManagerOption');
  if (managerOpt) {
    managerOpt.style.display = state.activeStore?.role === 'owner' ? 'block' : 'none';
  }

  modal.style.display = 'flex';
  await loadTeamData();
}

function hideTeamModal() {
  document.getElementById('teamModal').style.display = 'none';
}

// 11.5 Request Modal (Add / Edit)
function openAddModal() {
  if (!state.user) {
    openAuthModal('login');
    return;
  }
  if (!state.activeStoreId) {
    showToast('يرجى إنشاء محل أو الانضمام لمحل أولاً', 'info');
    return;
  }

  state.editingRequestId = null;
  const form = document.getElementById('requestForm');
  form.reset();
  document.getElementById('editRequestId').value = '';
  document.getElementById('modalHeading').textContent = 'إضافة طلب جديد';
  document.getElementById('saveBtnText').textContent = 'حفظ ونشر الطلب';
  document.getElementById('titleError').style.display = 'none';

  let defaultCat = 'reservation';
  if (state.filters.category && state.filters.category !== 'all') {
    defaultCat = state.filters.category;
  }
  const radio = form.querySelector(`input[name="itemCategory"][value="${defaultCat}"]`);
  if (radio) radio.checked = true;
  updateModalCategoryFields(defaultCat);

  document.getElementById('modalAuthorPreview').textContent = state.user.full_name;
  document.getElementById('modalShiftPreview').textContent = state.currentShift;
  document.getElementById('modalStorePreview').textContent = state.activeStore?.name || '';

  document.getElementById('requestModal').style.display = 'flex';
}

window.openEditModal = function(id, isAnnouncement = false) {
  state.editingRequestId = id;
  const modal = document.getElementById('requestModal');
  const form = document.getElementById('requestForm');

  let item = null;
  if (isAnnouncement) {
    item = state.announcements.find(a => a.id === id);
    item = item ? { ...item, category: 'announcement' } : null;
  } else {
    item = state.requests.find(r => r.id === id);
  }

  if (!item) return;

  document.getElementById('editRequestId').value = item.id;
  document.getElementById('modalHeading').textContent = 'تعديل الطلب';
  document.getElementById('saveBtnText').textContent = 'حفظ التعديلات';
  document.getElementById('titleError').style.display = 'none';

  const catRadio = form.querySelector(`input[name="itemCategory"][value="${item.category}"]`);
  if (catRadio) catRadio.checked = true;
  updateModalCategoryFields(item.category);

  document.getElementById('reqTitle').value = item.title || '';
  document.getElementById('reqDetails').value = item.details || '';
  document.getElementById('reqQuantity').value = item.quantity || '';
  document.getElementById('reqCustomerName').value = item.customer_name || '';
  document.getElementById('reqCustomerPhone').value = item.customer_phone || '';
  document.getElementById('reqDueDate').value = item.due_date || '';

  const prioRadio = form.querySelector(`input[name="reqPriority"][value="${item.priority}"]`);
  if (prioRadio) prioRadio.checked = true;

  document.getElementById('modalAuthorPreview').textContent = item.author_name;
  document.getElementById('modalShiftPreview').textContent = item.shift;
  document.getElementById('modalStorePreview').textContent = state.activeStore?.name || '';

  modal.style.display = 'flex';
};

function updateModalCategoryFields(cat) {
  const shortage = document.getElementById('shortageFields');
  const reservation = document.getElementById('reservationFields');

  if (cat === 'reservation') {
    reservation.style.display = 'flex';
    shortage.style.display = 'none';
  } else if (cat === 'shortage') {
    reservation.style.display = 'none';
    shortage.style.display = 'flex';
  } else {
    reservation.style.display = 'none';
    shortage.style.display = 'none';
  }
}

function hideRequestModal() {
  document.getElementById('requestModal').style.display = 'none';
  state.editingRequestId = null;
}

// 11.6 Delete Modal
window.openDeleteModal = function(id, title, isAnnouncement = false) {
  state.deletingRequestId = id;
  const modal = document.getElementById('deleteConfirmModal');
  document.getElementById('deleteConfirmMessage').textContent =
    `هل أنت متأكد من رغبتك في حذف "${title}" نهائياً من هذا المحل؟`;

  const confirmBtn = document.getElementById('confirmDeleteBtn');
  confirmBtn.onclick = () => handleDeleteRequest(id, isAnnouncement);

  modal.style.display = 'flex';
};

// ========================================================
// 12. تجهيز الأحداث (Event Listeners Setup)
// ========================================================
function setupEventListeners() {
  // شريط الشفت (صباحي / مسائي)
  const morningBtn = document.getElementById('shiftMorningBtn');
  const eveningBtn = document.getElementById('shiftEveningBtn');

  morningBtn.addEventListener('click', () => {
    state.currentShift = 'صباحي';
    morningBtn.classList.add('active');
    morningBtn.setAttribute('aria-checked', 'true');
    eveningBtn.classList.remove('active');
    eveningBtn.setAttribute('aria-checked', 'false');
    renderAllViews();
    showToast('تم التحويل إلى الشفت الصباحي ☀️', 'info');
  });

  eveningBtn.addEventListener('click', () => {
    state.currentShift = 'مسائي';
    eveningBtn.classList.add('active');
    eveningBtn.setAttribute('aria-checked', 'true');
    morningBtn.classList.remove('active');
    morningBtn.setAttribute('aria-checked', 'false');
    renderAllViews();
    showToast('تم التحويل إلى الشفت المسائي 🌙', 'info');
  });

  // تبديل المحل من القائمة المنسدلة
  const storeSelect = document.getElementById('activeStoreSelect');
  storeSelect.addEventListener('change', async e => {
    await switchActiveStore(e.target.value);
  });

  // زر إنشاء محل جديد
  document.getElementById('openNewStoreBtn')?.addEventListener('click', openCreateStoreModal);
  document.getElementById('noStoreCreateBtn')?.addEventListener('click', openCreateStoreModal);
  document.getElementById('closeCreateStoreModalBtn')?.addEventListener('click', hideCreateStoreModal);
  document.getElementById('cancelCreateStoreBtn')?.addEventListener('click', hideCreateStoreModal);

  document.getElementById('createStoreForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const name = document.getElementById('newStoreName').value;
    const desc = document.getElementById('newStoreDesc').value;
    await handleCreateStore(name, desc);
  });

  // زر الانضمام برمز دعوة
  const openManualInvite = () => {
    document.getElementById('manualInviteForm').reset();
    document.getElementById('manualInviteErrorMsg').style.display = 'none';
    document.getElementById('manualInviteModal').style.display = 'flex';
  };
  document.getElementById('noStoreJoinBtn')?.addEventListener('click', openManualInvite);
  document.getElementById('closeManualInviteBtn')?.addEventListener('click', () => {
    document.getElementById('manualInviteModal').style.display = 'none';
  });
  document.getElementById('cancelManualInviteBtn')?.addEventListener('click', () => {
    document.getElementById('manualInviteModal').style.display = 'none';
  });
  document.getElementById('manualInviteForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    let val = document.getElementById('manualInviteTokenInput').value.trim();
    if (val.includes('invite=')) {
      val = val.split('invite=')[1].split('&')[0];
    }
    state.pendingInviteToken = val;
    document.getElementById('manualInviteModal').style.display = 'none';
    checkUrlForInvitation();
  });

  // زر قبول الدعوة
  document.getElementById('confirmAcceptInviteBtn')?.addEventListener('click', handleAcceptInvitation);
  document.getElementById('cancelAcceptInviteBtn')?.addEventListener('click', () => {
    document.getElementById('acceptInviteModal').style.display = 'none';
    state.pendingInviteToken = null;
  });

  // إدارة الفريق
  document.getElementById('openTeamModalBtn')?.addEventListener('click', openTeamModal);
  document.getElementById('closeTeamModalBtn')?.addEventListener('click', hideTeamModal);

  document.getElementById('createInviteForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const role = document.getElementById('inviteRoleSelect').value;
    const duration = document.getElementById('inviteDurationSelect').value;
    await handleCreateInvitation(role, duration);
  });

  document.getElementById('copyInviteLinkBtn')?.addEventListener('click', () => {
    const input = document.getElementById('generatedLinkInput');
    input.select();
    navigator.clipboard.writeText(input.value);
    const hint = document.getElementById('linkCopiedHint');
    hint.style.display = 'inline';
    setTimeout(() => { hint.style.display = 'none'; }, 2500);
    showToast('تم نسخ رابط الدعوة!', 'success');
  });

  // المصادقة
  document.getElementById('openLoginBtn')?.addEventListener('click', () => openAuthModal('login'));
  document.getElementById('openRegisterBtn')?.addEventListener('click', () => openAuthModal('register'));
  document.getElementById('closeAuthModalBtn')?.addEventListener('click', hideAuthModal);
  document.getElementById('logoutBtn')?.addEventListener('click', handleLogout);

  document.getElementById('tabLoginBtn')?.addEventListener('click', () => switchAuthTab('login'));
  document.getElementById('tabRegisterBtn')?.addEventListener('click', () => switchAuthTab('register'));
  document.getElementById('tabForgotBtn')?.addEventListener('click', () => switchAuthTab('forgot'));

  document.getElementById('loginForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    await handleLogin(email, password);
  });

  document.getElementById('registerForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const name = document.getElementById('regFullName').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    const confirm = document.getElementById('regPasswordConfirm').value;
    const errEl = document.getElementById('registerErrorMsg');

    if (password !== confirm) {
      errEl.textContent = 'كلمتا المرور غير متطابقتين';
      errEl.style.display = 'block';
      return;
    }
    await handleRegister(name, email, password);
  });

  document.getElementById('forgotForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const email = document.getElementById('forgotEmail').value.trim();
    await handleForgotPassword(email);
  });

  document.getElementById('resetPasswordForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const password = document.getElementById('newPassword').value;
    await handleResetPassword(password);
  });

  // إضافة وتعديل الطلبات
  document.getElementById('openAddModalBtn')?.addEventListener('click', openAddModal);
  document.getElementById('emptyActionBtn')?.addEventListener('click', openAddModal);
  document.getElementById('closeModalBtn')?.addEventListener('click', hideRequestModal);
  document.getElementById('cancelModalBtn')?.addEventListener('click', hideRequestModal);

  const form = document.getElementById('requestForm');
  form.querySelectorAll('input[name="itemCategory"]').forEach(input => {
    input.addEventListener('change', e => {
      updateModalCategoryFields(e.target.value);
    });
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const titleInput = document.getElementById('reqTitle');
    const title = titleInput.value.trim();
    const titleError = document.getElementById('titleError');

    if (!title) {
      titleError.style.display = 'block';
      titleInput.focus();
      return;
    }
    titleError.style.display = 'none';

    const category = form.querySelector('input[name="itemCategory"]:checked').value;
    const details = document.getElementById('reqDetails').value.trim();
    const quantity = document.getElementById('reqQuantity').value.trim();
    const customerName = document.getElementById('reqCustomerName').value.trim();
    const customerPhone = document.getElementById('reqCustomerPhone').value.trim();
    const priority = form.querySelector('input[name="reqPriority"]:checked').value;
    const dueDate = document.getElementById('reqDueDate').value.trim();
    const editId = document.getElementById('editRequestId').value;

    await handleSaveRequest({
      id: editId || null,
      category,
      title,
      details,
      quantity,
      customerName,
      customerPhone,
      priority,
      dueDate
    });
  });

  // إلغاء نافذة الحذف
  document.getElementById('cancelDeleteBtn')?.addEventListener('click', () => {
    document.getElementById('deleteConfirmModal').style.display = 'none';
    state.deletingRequestId = null;
  });

  // تبويبات الأقسام (الكل، الحجوزات، النواقص، التبليغات)
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.filters.category = btn.getAttribute('data-category');
      state.filters.handoverOnly = false;
      renderAllViews();
    });
  });

  // فلتر باقي من الشفت السابق
  document.getElementById('handoverToggleBtn')?.addEventListener('click', () => {
    state.filters.handoverOnly = !state.filters.handoverOnly;
    if (state.filters.handoverOnly) {
      state.filters.category = 'all';
      tabBtns.forEach(b => b.classList.toggle('active', b.getAttribute('data-category') === 'all'));
      showToast(`عرض المهام المعلقة من الشفت ${getOtherShift()}`, 'info');
    }
    renderAllViews();
  });

  // فلتر طلباتي
  const myTasksBtn = document.getElementById('myTasksToggle');
  myTasksBtn?.addEventListener('click', () => {
    state.filters.myTasksOnly = !state.filters.myTasksOnly;
    myTasksBtn.classList.toggle('active', state.filters.myTasksOnly);
    myTasksBtn.setAttribute('aria-pressed', state.filters.myTasksOnly ? 'true' : 'false');
    renderAllViews();
  });

  // فلتر الحالة والأولوية
  document.getElementById('statusFilter')?.addEventListener('change', e => {
    state.filters.status = e.target.value;
    state.filters.handoverOnly = false;
    renderAllViews();
  });

  document.getElementById('priorityFilter')?.addEventListener('change', e => {
    state.filters.priority = e.target.value;
    renderAllViews();
  });

  // البحث
  const searchInput = document.getElementById('searchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');

  searchInput?.addEventListener('input', e => {
    state.filters.search = e.target.value;
    clearSearchBtn.style.display = e.target.value ? 'block' : 'none';
    renderAllViews();
  });

  clearSearchBtn?.addEventListener('click', () => {
    searchInput.value = '';
    state.filters.search = '';
    clearSearchBtn.style.display = 'none';
    renderAllViews();
  });

  // إلغاء جميع الفلاتر
  document.getElementById('clearAllFiltersBtn')?.addEventListener('click', () => {
    state.filters.category = 'all';
    state.filters.status = 'all';
    state.filters.priority = 'all';
    state.filters.search = '';
    state.filters.myTasksOnly = false;
    state.filters.handoverOnly = false;

    document.getElementById('statusFilter').value = 'all';
    document.getElementById('priorityFilter').value = 'all';
    document.getElementById('searchInput').value = '';
    document.getElementById('clearSearchBtn').style.display = 'none';
    myTasksBtn.classList.remove('active');
    myTasksBtn.setAttribute('aria-pressed', 'false');

    tabBtns.forEach(b => b.classList.toggle('active', b.getAttribute('data-category') === 'all'));
    renderAllViews();
  });

  // إحصائيات سريعة للضغط عليها
  document.getElementById('statAllCard')?.addEventListener('click', () => {
    state.filters.status = 'all';
    document.getElementById('statusFilter').value = 'all';
    renderAllViews();
  });
  document.getElementById('statNewCard')?.addEventListener('click', () => {
    state.filters.status = 'new';
    document.getElementById('statusFilter').value = 'new';
    renderAllViews();
  });
  document.getElementById('statProgressCard')?.addEventListener('click', () => {
    state.filters.status = 'in_progress';
    document.getElementById('statusFilter').value = 'in_progress';
    renderAllViews();
  });
  document.getElementById('statDoneCard')?.addEventListener('click', () => {
    state.filters.status = 'completed';
    document.getElementById('statusFilter').value = 'completed';
    renderAllViews();
  });
}

// ========================================================
// 13. بدء تشغيل التطبيق (Initialization)
// ========================================================
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();

  if (ensureSupabaseConfigured()) {
    await initAuth();
  }
});
