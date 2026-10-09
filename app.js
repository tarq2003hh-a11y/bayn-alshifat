/**
 * بين الشفتات - منطق التطبيق والنموذج الأولي
 * تطبيق ويب لإدارة المهام والنواقص والحجوزات بين الشفت الصباحي والمسائي
 */

// ========================================================
// 1. الثوابت والبيانات الافتراضية للتجربة
// ========================================================
const STORAGE_KEY = 'bayn_alshifat_v1';

// قائمة الموظفين التجريبيين
const DEFAULT_USERS = [
  { id: 'u1', name: 'أحمد الحكيم', defaultShift: 'صباحي' },
  { id: 'u2', name: 'سارة العلي', defaultShift: 'مسائي' },
  { id: 'u3', name: 'علي عبد الله', defaultShift: 'صباحي' },
  { id: 'u4', name: 'فاطمة الزهراء', defaultShift: 'مسائي' }
];

// الطلبات الافتراضية الواقعية المطلوبة
const DEFAULT_ITEMS = [
  {
    id: 'req-1',
    category: 'shortage',
    title: 'توفير ورق A4، عدد 5 رزم',
    quantity: '5 رزم (80 غرام)',
    details: 'المخزون على وشك النفاد قرب طابعة الفواتير، نرجو نقل رزم من المستودع الداخلي.',
    priority: 'urgent',
    dueDate: 'اليوم قبل الظهر',
    authorId: 'u2',
    authorName: 'سارة العلي',
    shift: 'مسائي', // كُتب في الشفت المسائي لكي يظهر للشفت الصباحي في "باقي من الشفت السابق"
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 10).toISOString(),
    status: 'new', // جديد، بانتظار استلامه
    assigneeId: null,
    assigneeName: null,
    acknowledgedBy: []
  },
  {
    id: 'req-2',
    category: 'reservation',
    title: 'حجز كتاب لزبون يأتي غداً',
    customerName: 'أبو فهد',
    customerPhone: '0551234567',
    quantity: '',
    details: 'طلب نسخة خاصة من "مقدمة ابن خلدون" - تم وضعها جانباً في الرف رقم 3 خلف الكاشير.',
    priority: 'normal',
    dueDate: 'غداً عصراً',
    authorId: 'u2',
    authorName: 'سارة العلي',
    shift: 'مسائي',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(),
    status: 'in_progress', // قيد التجهيز
    assigneeId: 'u1',
    assigneeName: 'أحمد الحكيم',
    acknowledgedBy: []
  },
  {
    id: 'req-3',
    category: 'shortage',
    title: 'توفير أكياس تغليف حجم متوسط',
    quantity: '2 كرتون',
    details: 'أكياس التغليف الورقية للهدايا والكتب، تأكدوا من استلام الشحنة من المورد عند وصوله.',
    priority: 'normal',
    dueDate: 'اليوم قبل المساء',
    authorId: 'u3',
    authorName: 'علي عبد الله',
    shift: 'صباحي',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
    status: 'new',
    assigneeId: null,
    assigneeName: null,
    acknowledgedBy: []
  },
  {
    id: 'req-4',
    category: 'announcement',
    title: 'تبليغ بتغيير وقت فتح المحل',
    quantity: '',
    details: 'بناءً على أعمال صيانة واجهة المحل والتكييف المركزي، سيتم فتح المحل غداً في تمام الساعة 8:30 صباحاً بدلاً من 8:00 صباحاً. يرجى من الجميع العلم والاطلاع.',
    priority: 'urgent',
    dueDate: 'يسري غداً صباحاً',
    authorId: 'u1',
    authorName: 'أحمد الحكيم',
    shift: 'صباحي',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
    status: 'new',
    assigneeId: null,
    assigneeName: null,
    acknowledgedBy: [
      { userId: 'u1', userName: 'أحمد الحكيم', time: 'منذ 10 ساعات' },
      { userId: 'u2', userName: 'سارة العلي', time: 'منذ 7 ساعات' }
    ]
  },
  {
    id: 'req-5',
    category: 'reservation',
    title: 'حجز علبة دواء / مستحضر خاص لزبونة',
    customerName: 'أم خالد',
    customerPhone: '0509876543',
    quantity: '',
    details: 'الزبونة ستمر في بداية الشفت المسائي لاستلام الدواء. المبلغ مدفوع مسبقاً بالإيصال رقم 4021.',
    priority: 'urgent',
    dueDate: 'اليوم الساعة 5:00 مساءً',
    authorId: 'u1',
    authorName: 'أحمد الحكيم',
    shift: 'صباحي',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    status: 'ready', // جاهز للاستلام
    assigneeId: 'u1',
    assigneeName: 'أحمد الحكيم',
    acknowledgedBy: []
  },
  {
    id: 'req-6',
    category: 'shortage',
    title: 'توفير أقلام حبر جاف أزرق للكاشير',
    quantity: '1 علبة',
    details: 'تم توفير الأقلام بنجاح ووضعها في درج المستلزمات.',
    priority: 'normal',
    dueDate: 'اليوم',
    authorId: 'u3',
    authorName: 'علي عبد الله',
    shift: 'صباحي',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    status: 'completed', // مكتمل (لتجربة ميزة إعادة الفتح)
    assigneeId: 'u3',
    assigneeName: 'علي عبد الله',
    acknowledgedBy: []
  }
];

// ========================================================
// 2. حالة التطبيق (State Management)
// ========================================================
const state = {
  users: DEFAULT_USERS,
  currentUserId: 'u1',
  currentShift: 'صباحي', // 'صباحي' أو 'مسائي'
  items: [],
  filters: {
    category: 'all', // 'all', 'reservation', 'shortage', 'announcement'
    status: 'all',   // 'all', 'new', 'in_progress', 'ready', 'completed'
    priority: 'all', // 'all', 'urgent', 'normal'
    search: '',
    myTasksOnly: false,
    handoverOnly: false // باقي من الشفت السابق
  },
  editingItemId: null,
  deletingItemId: null
};

// ========================================================
// 3. التخزين المحلي (LocalStorage Helpers)
// ========================================================
function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state.items = Array.isArray(parsed.items) ? parsed.items : DEFAULT_ITEMS;
      if (parsed.currentUserId) state.currentUserId = parsed.currentUserId;
      if (parsed.currentShift) state.currentShift = parsed.currentShift;
    } else {
      state.items = JSON.parse(JSON.stringify(DEFAULT_ITEMS));
      saveData();
    }
  } catch (err) {
    console.error('Error loading data from localStorage:', err);
    state.items = JSON.parse(JSON.stringify(DEFAULT_ITEMS));
  }
}

function saveData() {
  try {
    const payload = {
      items: state.items,
      currentUserId: state.currentUserId,
      currentShift: state.currentShift
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.error('Error saving data to localStorage:', err);
  }
}

function resetToDefaultData() {
  if (confirm('هل تريد إعادة تعيين جميع البيانات إلى البيانات الافتراضية للتجربة؟')) {
    state.items = JSON.parse(JSON.stringify(DEFAULT_ITEMS));
    saveData();
    renderAll();
    showToast('تمت استعادة البيانات الافتراضية بنجاح', 'success');
  }
}

// ========================================================
// 4. الأدوات المساعدة والتنسيق
// ========================================================
function getCurrentUser() {
  return state.users.find(u => u.id === state.currentUserId) || state.users[0];
}

function getOtherShift() {
  return state.currentShift === 'صباحي' ? 'مسائي' : 'صباحي';
}

function formatRelativeTime(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

  if (diffMins < 1) return 'الآن';
  if (diffMins < 60) return `منذ ${diffMins} دقيقة`;
  if (diffHours < 24) return `منذ ${diffHours} ساعة`;
  return date.toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' });
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

// ========================================================
// 5. منطق تصفية وحساب الطلبات (Filtering & Metrics)
// ========================================================
function getFilteredItems() {
  const otherShift = getOtherShift();

  return state.items.filter(item => {
    // 1. فلتر باقي من الشفت السابق
    if (state.filters.handoverOnly) {
      const isFromOtherShift = item.shift === otherShift;
      const isOpenTask = item.category !== 'announcement' && item.status !== 'completed';
      if (!isFromOtherShift || !isOpenTask) return false;
    }

    // 2. فلتر القسم (Category)
    if (state.filters.category !== 'all' && item.category !== state.filters.category) {
      return false;
    }

    // 3. فلتر طلباتي (My Tasks)
    if (state.filters.myTasksOnly) {
      if (item.category === 'announcement') {
        // بالتبليغات، اعرض ما لم أطلع عليه أو كل التبليغات
        return false;
      }
      if (item.assigneeId !== state.currentUserId) {
        return false;
      }
    }

    // 4. فلتر الحالة
    if (state.filters.status !== 'all') {
      if (state.filters.status === 'new' && item.status !== 'new') return false;
      if (state.filters.status === 'in_progress' && item.status !== 'in_progress') return false;
      if (state.filters.status === 'ready' && item.status !== 'ready') return false;
      if (state.filters.status === 'completed' && item.status !== 'completed') return false;
    }

    // 5. فلتر الأولوية
    if (state.filters.priority !== 'all') {
      if (item.priority !== state.filters.priority) return false;
    }

    // 6. البحث النصي
    if (state.filters.search.trim()) {
      const query = state.filters.search.trim().toLowerCase();
      const titleMatch = (item.title || '').toLowerCase().includes(query);
      const detailsMatch = (item.details || '').toLowerCase().includes(query);
      const customerMatch = (item.customerName || '').toLowerCase().includes(query);
      const phoneMatch = (item.customerPhone || '').toLowerCase().includes(query);
      const quantityMatch = (item.quantity || '').toLowerCase().includes(query);
      if (!titleMatch && !detailsMatch && !customerMatch && !phoneMatch && !quantityMatch) {
        return false;
      }
    }

    return true;
  }).sort((a, b) => {
    // إذا كان فلتر الشفت السابق مفعلاً: المستعجل أولاً ثم الأقرب موعداً
    if (state.filters.handoverOnly) {
      if (a.priority === 'urgent' && b.priority !== 'urgent') return -1;
      if (b.priority === 'urgent' && a.priority !== 'urgent') return 1;
    }
    // الترتيب الافتراضي: الأحدث أولاً
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
}

function calculateCounts() {
  const otherShift = getOtherShift();
  let total = 0;
  let newCount = 0;
  let progressCount = 0;
  let doneCount = 0;
  let prevShiftOpenCount = 0;
  let myTasksCount = 0;

  let reservationCount = 0;
  let shortageCount = 0;
  let announcementCount = 0;

  state.items.forEach(item => {
    total++;

    if (item.category === 'reservation') reservationCount++;
    if (item.category === 'shortage') shortageCount++;
    if (item.category === 'announcement') announcementCount++;

    if (item.status === 'new') newCount++;
    else if (item.status === 'in_progress' || item.status === 'ready') progressCount++;
    else if (item.status === 'completed') doneCount++;

    // المهام المفتوحة من الشفت السابق
    if (item.shift === otherShift && item.category !== 'announcement' && item.status !== 'completed') {
      prevShiftOpenCount++;
    }

    // طلباتي
    if (item.assigneeId === state.currentUserId && item.status !== 'completed') {
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

// ========================================================
// 6. الرندرة والتحديث المرئي (Render Views)
// ========================================================
function renderHeaderControls() {
  // 1. User selector
  const userSelect = document.getElementById('userSelect');
  userSelect.innerHTML = '';
  state.users.forEach(u => {
    const opt = document.createElement('option');
    opt.value = u.id;
    opt.textContent = `${u.name} (${u.defaultShift})`;
    if (u.id === state.currentUserId) opt.selected = true;
    userSelect.appendChild(opt);
  });

  // 2. Shift Segmented Buttons
  const morningBtn = document.getElementById('shiftMorningBtn');
  const eveningBtn = document.getElementById('shiftEveningBtn');
  if (state.currentShift === 'صباحي') {
    morningBtn.classList.add('active');
    morningBtn.setAttribute('aria-checked', 'true');
    eveningBtn.classList.remove('active');
    eveningBtn.setAttribute('aria-checked', 'false');
  } else {
    eveningBtn.classList.add('active');
    eveningBtn.setAttribute('aria-checked', 'true');
    morningBtn.classList.remove('active');
    morningBtn.setAttribute('aria-checked', 'false');
  }

  // 3. Modal previews
  const currentUser = getCurrentUser();
  const authorPreview = document.getElementById('modalAuthorPreview');
  const shiftPreview = document.getElementById('modalShiftPreview');
  if (authorPreview) authorPreview.textContent = currentUser.name;
  if (shiftPreview) shiftPreview.textContent = state.currentShift;
}

function renderStatsAndTabs() {
  const counts = calculateCounts();

  // Stats cards numbers
  document.getElementById('statTotalCount').textContent = counts.total;
  document.getElementById('statNewCount').textContent = counts.newCount;
  document.getElementById('statProgressCount').textContent = counts.progressCount;
  document.getElementById('statDoneCount').textContent = counts.doneCount;

  // Tabs Badges
  document.getElementById('badgeAll').textContent = counts.total;
  document.getElementById('badgeReservation').textContent = counts.reservationCount;
  document.getElementById('badgeShortage').textContent = counts.shortageCount;
  document.getElementById('badgeAnnouncement').textContent = counts.announcementCount;

  // My Tasks badge
  document.getElementById('myTasksCount').textContent = counts.myTasksCount;

  // Handover Section Texts
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
  if (state.filters.myTasksOnly) chips.push(`طلباتي فقط (${getCurrentUser().name})`);
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

function renderItemsList() {
  const container = document.getElementById('itemsContainer');
  const emptyState = document.getElementById('emptyState');
  container.innerHTML = '';

  const items = getFilteredItems();

  if (items.length === 0) {
    emptyState.style.display = 'flex';
    if (state.filters.handoverOnly) {
      document.getElementById('emptyTitle').textContent = `لا توجد مهام معلّقة من الشفت ${getOtherShift()}`;
      document.getElementById('emptyDesc').textContent = 'رائع! تم تسليم وإنجاز جميع مهام الشفت السابق بنجاح.';
    } else if (state.filters.myTasksOnly) {
      document.getElementById('emptyTitle').textContent = 'ليس لديك طلبات تتابعها حالياً';
      document.getElementById('emptyDesc').textContent = 'يمكنك اختيار أي طلب جديد والضغط على «أني أتابعه» لتبدأ بالعمل عليه.';
    } else {
      document.getElementById('emptyTitle').textContent = 'لا توجد طلبات تطابق التصفية الحالية';
      document.getElementById('emptyDesc').textContent = 'جرّب تغيير التصفية أو أضف طلباً جديداً بالضغط على الزر بالأعلى.';
    }
    return;
  }

  emptyState.style.display = 'none';

  items.forEach(item => {
    const card = createItemCardElement(item);
    container.appendChild(card);
  });
}

// إنشاء عنصر البطاقة
function createItemCardElement(item) {
  const card = document.createElement('article');
  card.className = `request-card type-${item.category} ${item.priority === 'urgent' ? 'is-urgent' : ''} ${item.status === 'completed' ? 'is-completed' : ''}`;
  card.setAttribute('data-id', item.id);

  // تصنيف الأيقونة والاسم
  let categoryLabel = 'طلب';
  let categoryIcon = '📋';
  let badgeClass = 'badge-reservation';
  if (item.category === 'reservation') {
    categoryLabel = 'حجز زبون';
    categoryIcon = '📦';
    badgeClass = 'badge-reservation';
  } else if (item.category === 'shortage') {
    categoryLabel = 'نقص مستلزمات';
    categoryIcon = '🛒';
    badgeClass = 'badge-shortage';
  } else if (item.category === 'announcement') {
    categoryLabel = 'تبليغ عام';
    categoryIcon = '📢';
    badgeClass = 'badge-announcement';
  }

  // نص الحالة واللون
  let statusBadgeHtml = '';
  if (item.category !== 'announcement') {
    if (item.status === 'new') {
      statusBadgeHtml = `<span class="badge badge-status-new">🆕 جديد</span>`;
    } else if (item.status === 'in_progress') {
      statusBadgeHtml = `<span class="badge badge-status-progress">⏳ ${item.category === 'reservation' ? 'قيد التجهيز' : 'قيد المتابعة'}</span>`;
    } else if (item.status === 'ready') {
      statusBadgeHtml = `<span class="badge badge-status-ready">📦 جاهز للاستلام</span>`;
    } else if (item.status === 'completed') {
      statusBadgeHtml = `<span class="badge badge-status-completed">✅ ${item.category === 'reservation' ? 'تم التسليم' : 'مكتمل'}</span>`;
    }
  }

  // وسم الأولوية
  const priorityBadgeHtml = item.priority === 'urgent'
    ? `<span class="badge badge-urgent">⚡ مستعجل</span>`
    : `<span class="badge badge-normal">عادي</span>`;

  // الحقول المخصصة (زبون، هاتف، كمية، موعد)
  let metaChipsHtml = '';
  if (item.quantity) {
    metaChipsHtml += `<span class="meta-chip">🔢 الكمية: <strong>${escapeHtml(item.quantity)}</strong></span>`;
  }
  if (item.customerName) {
    metaChipsHtml += `<span class="meta-chip">👤 الزبون: <strong>${escapeHtml(item.customerName)}</strong></span>`;
  }
  if (item.customerPhone) {
    metaChipsHtml += `<span class="meta-chip">📞 <span dir="ltr">${escapeHtml(item.customerPhone)}</span></span>`;
  }
  if (item.dueDate) {
    metaChipsHtml += `<span class="meta-chip chip-due">⏰ المطلوب: <strong>${escapeHtml(item.dueDate)}</strong></span>`;
  }

  // قسم المسؤول والمتابعة
  let footerHtml = '';

  if (item.category === 'announcement') {
    // التبليغات: لا تحتاج استلاماً كمهمة بل زر "اطّلعت" وعرض أسماء من اطلعوا
    const currentUser = getCurrentUser();
    const hasRead = (item.acknowledgedBy || []).some(a => a.userId === currentUser.id);
    const readersNames = (item.acknowledgedBy || []).map(a => a.userName).join('، ');

    footerHtml = `
      <div class="card-footer">
        <div class="announcement-readers">
          <div class="announcement-readers-title">
            <span>👁️ اطّلع عليه (${(item.acknowledgedBy || []).length}):</span>
          </div>
          <div class="announcement-readers-list">
            ${readersNames || 'لم يطّلع عليه أحد بعد'}
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
    // الحجوزات والنواقص: إدارة الاستلام، الإنجاز، وإلغاء الاستلام
    let assigneeText = '';
    if (!item.assigneeId) {
      assigneeText = `<span class="unassigned-text">⚠️ بدون مسؤول حالياً</span>`;
    } else {
      const isMe = item.assigneeId === state.currentUserId;
      assigneeText = `<span class="assignee-name">👤 المسؤول: <strong>${escapeHtml(item.assigneeName)}</strong> ${isMe ? '(أنت)' : ''}</span>`;
    }

    let actionButtonsHtml = '';

    if (item.status === 'new') {
      // جديد: زر "أني أتابعه" متاح للجميع
      actionButtonsHtml = `
        <button type="button" class="btn btn-card-action btn-take-task" onclick="handleTakeTask('${item.id}')">
          ✋ أني أتابعه
        </button>
      `;
    } else if (item.status === 'in_progress') {
      // قيد المتابعة / قيد التجهيز
      if (item.category === 'reservation') {
        actionButtonsHtml = `
          <button type="button" class="btn btn-card-action btn-step-ready" onclick="handleSetReady('${item.id}')">
            📦 جاهز للاستلام
          </button>
          <button type="button" class="btn btn-card-action btn-cancel-take" onclick="handleCancelTake('${item.id}')" title="إلغاء الاستلام وإعادته لجديد">
            ↩️ إلغاء استلامي
          </button>
        `;
      } else {
        // نواقص
        actionButtonsHtml = `
          <button type="button" class="btn btn-card-action btn-step-done" onclick="handleCompleteTask('${item.id}')">
            ✅ تم التوفير
          </button>
          <button type="button" class="btn btn-card-action btn-cancel-take" onclick="handleCancelTake('${item.id}')" title="إلغاء الاستلام وإعادته لجديد">
            ↩️ إلغاء استلامي
          </button>
        `;
      }
    } else if (item.status === 'ready') {
      // الحجز جاهز للاستلام
      actionButtonsHtml = `
        <button type="button" class="btn btn-card-action btn-step-done" onclick="handleCompleteTask('${item.id}')">
          🤝 تم التسليم للزبون
        </button>
        <button type="button" class="btn btn-card-action btn-outline" onclick="handleBackToProgress('${item.id}')" style="min-width:auto;">
          ↩️ عودة للتجهيز
        </button>
      `;
    } else if (item.status === 'completed') {
      // مكتمل: زر إعادة الفتح إذا تم إكماله بالخطأ
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
      <div class="card-quick-tools">
        <button type="button" class="btn-tool" onclick="openEditModal('${item.id}')" title="تعديل الطلب" aria-label="تعديل">
          ✏️ تعديل
        </button>
        <button type="button" class="btn-tool btn-tool-delete" onclick="openDeleteModal('${item.id}')" title="حذف الطلب" aria-label="حذف">
          🗑️
        </button>
      </div>
    </div>

    <div class="card-body">
      ${item.details ? `<p class="card-details">${escapeHtml(item.details)}</p>` : ''}
      ${metaChipsHtml ? `<div class="card-meta-chips">${metaChipsHtml}</div>` : ''}

      <div class="card-origin-stamp">
        <span>كتبه: <strong class="origin-author">${escapeHtml(item.authorName)}</strong></span>
        <span class="origin-shift">الشفت ${escapeHtml(item.shift)}</span>
        <span>• ${formatRelativeTime(item.createdAt)}</span>
      </div>
    </div>

    ${footerHtml}
  `;

  return card;
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

function renderAll() {
  renderHeaderControls();
  renderStatsAndTabs();
  renderActiveFiltersNotice();
  renderItemsList();
}

// ========================================================
// 7. دورة عمل الطلبات (Workflow Actions)
// ========================================================

// 1. «أني أتابعه» -> يسند الطلب للمستخدم الحالي
window.handleTakeTask = function(id) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;

  const currentUser = getCurrentUser();
  item.assigneeId = currentUser.id;
  item.assigneeName = currentUser.name;
  item.status = 'in_progress';

  saveData();
  renderAll();
  showToast(`تم استلام متابعة "${item.title}" بواسطة ${currentUser.name}`, 'success');
};

// 2. «إلغاء استلامي» -> يعيد الطلب لجديد ويزيل المسؤول
window.handleCancelTake = function(id) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;

  item.assigneeId = null;
  item.assigneeName = null;
  item.status = 'new';

  saveData();
  renderAll();
  showToast(`تم إلغاء الاستلام وأصبح الطلب متاحاً للزملاء`, 'info');
};

// 3. للحجوزات: تحويل إلى "جاهز للاستلام"
window.handleSetReady = function(id) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;

  item.status = 'ready';
  saveData();
  renderAll();
  showToast(`أصبح الحجز جاهزاً لاستلام الزبون`, 'success');
};

// 4. عودة للتجهيز
window.handleBackToProgress = function(id) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;

  item.status = 'in_progress';
  saveData();
  renderAll();
  showToast(`تمت إعادة الطلب إلى قيد التجهيز`, 'info');
};

// 5. إتمام الطلب: "تم التوفير" أو "تم التسليم"
window.handleCompleteTask = function(id) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;

  item.status = 'completed';
  saveData();
  renderAll();
  showToast(`تم إنجاز الطلب بنجاح ✓`, 'success');
};

// 6. إعادة فتح الطلب المكتمل
window.handleReopenTask = function(id) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;

  item.status = item.category === 'reservation' ? 'in_progress' : 'in_progress';
  saveData();
  renderAll();
  showToast(`تمت إعادة فتح الطلب للمتابعة`, 'info');
};

// 7. التبليغات: زر "اطّلعت"
window.handleAcknowledge = function(id) {
  const item = state.items.find(i => i.id === id);
  if (!item || item.category !== 'announcement') return;

  if (!Array.isArray(item.acknowledgedBy)) {
    item.acknowledgedBy = [];
  }

  const currentUser = getCurrentUser();
  const index = item.acknowledgedBy.findIndex(a => a.userId === currentUser.id);

  if (index === -1) {
    // إضافة اطّلاع
    item.acknowledgedBy.push({
      userId: currentUser.id,
      userName: currentUser.name,
      time: 'الآن'
    });
    showToast(`شكراً لك! تم تسجيل اطّلاعك على التبليغ`, 'success');
  } else {
    // تبديل أو تأكيد
    showToast(`أنت مسجل بالفعل ضمن من اطّلعوا على هذا التبليغ`, 'info');
  }

  saveData();
  renderAll();
};

// ========================================================
// 8. إضافة وتعديل الطلبات (Add / Edit Modal Handlers)
// ========================================================
function setupModal() {
  const modal = document.getElementById('requestModal');
  const form = document.getElementById('requestForm');
  const openBtn = document.getElementById('openAddModalBtn');
  const closeBtn = document.getElementById('closeModalBtn');
  const cancelBtn = document.getElementById('cancelModalBtn');
  const emptyActionBtn = document.getElementById('emptyActionBtn');

  // تبديل نوع الطلب لإظهار الحقول المناسبة
  const categoryInputs = form.querySelectorAll('input[name="itemCategory"]');
  const shortageFields = document.getElementById('shortageFields');
  const reservationFields = document.getElementById('reservationFields');

  function updateCategoryFields(cat) {
    if (cat === 'reservation') {
      reservationFields.style.display = 'flex';
      shortageFields.style.display = 'none';
    } else if (cat === 'shortage') {
      reservationFields.style.display = 'none';
      shortageFields.style.display = 'flex';
    } else {
      reservationFields.style.display = 'none';
      shortageFields.style.display = 'none';
    }
  }

  categoryInputs.forEach(input => {
    input.addEventListener('change', (e) => {
      updateCategoryFields(e.target.value);
    });
  });

  // فتح نافذة الإضافة
  function openAddModal() {
    state.editingItemId = null;
    form.reset();
    document.getElementById('editRequestId').value = '';
    document.getElementById('modalHeading').textContent = 'إضافة طلب جديد';
    document.getElementById('saveBtnText').textContent = 'حفظ ونشر الطلب';
    document.getElementById('titleError').style.display = 'none';

    // افتراضياً اختيار القسم الحالي المفلتر، أو حجز
    let defaultCat = 'reservation';
    if (state.filters.category && state.filters.category !== 'all') {
      defaultCat = state.filters.category;
    }
    const targetRadio = form.querySelector(`input[name="itemCategory"][value="${defaultCat}"]`);
    if (targetRadio) targetRadio.checked = true;
    updateCategoryFields(defaultCat);

    // تحديث بيانات الكاتب
    const currentUser = getCurrentUser();
    document.getElementById('modalAuthorPreview').textContent = currentUser.name;
    document.getElementById('modalShiftPreview').textContent = state.currentShift;

    modal.style.display = 'flex';
    setTimeout(() => document.getElementById('reqTitle').focus(), 50);
  }

  openBtn.addEventListener('click', openAddModal);
  if (emptyActionBtn) emptyActionBtn.addEventListener('click', openAddModal);

  function closeModal() {
    modal.style.display = 'none';
    state.editingItemId = null;
  }

  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);

  // إغلاق عند النقر بالخارج
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  // حفظ النموذج (إضافة أو تعديل)
  form.addEventListener('submit', (e) => {
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

    const selectedCategoryRadio = form.querySelector('input[name="itemCategory"]:checked');
    const category = selectedCategoryRadio ? selectedCategoryRadio.value : 'reservation';

    const details = document.getElementById('reqDetails').value.trim();
    const quantity = document.getElementById('reqQuantity').value.trim();
    const customerName = document.getElementById('reqCustomerName').value.trim();
    const customerPhone = document.getElementById('reqCustomerPhone').value.trim();
    const selectedPriorityRadio = form.querySelector('input[name="reqPriority"]:checked');
    const priority = selectedPriorityRadio ? selectedPriorityRadio.value : 'normal';
    const dueDate = document.getElementById('reqDueDate').value.trim();

    const editId = document.getElementById('editRequestId').value;

    if (editId) {
      // تعديل طلب موجود
      const item = state.items.find(i => i.id === editId);
      if (item) {
        item.category = category;
        item.title = title;
        item.details = details;
        item.priority = priority;
        item.dueDate = dueDate;
        item.quantity = category === 'shortage' ? quantity : '';
        item.customerName = category === 'reservation' ? customerName : '';
        item.customerPhone = category === 'reservation' ? customerPhone : '';
        showToast(`تم تحديث الطلب بنجاح`, 'success');
      }
    } else {
      // إضافة طلب جديد
      const currentUser = getCurrentUser();
      const newItem = {
        id: 'req-' + Date.now(),
        category,
        title,
        details,
        priority,
        dueDate,
        quantity: category === 'shortage' ? quantity : '',
        customerName: category === 'reservation' ? customerName : '',
        customerPhone: category === 'reservation' ? customerPhone : '',
        authorId: currentUser.id,
        authorName: currentUser.name,
        shift: state.currentShift,
        createdAt: new Date().toISOString(),
        status: 'new',
        assigneeId: null,
        assigneeName: null,
        acknowledgedBy: category === 'announcement' ? [
          { userId: currentUser.id, userName: currentUser.name, time: 'الآن' }
        ] : []
      };

      state.items.unshift(newItem);
      showToast(`تمت إضافة الطلب ونشره بنجاح`, 'success');
    }

    saveData();
    closeModal();
    renderAll();
  });
}

// فتح نافذة التعديل
window.openEditModal = function(id) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;

  state.editingItemId = id;
  const modal = document.getElementById('requestModal');
  const form = document.getElementById('requestForm');

  document.getElementById('editRequestId').value = item.id;
  document.getElementById('modalHeading').textContent = 'تعديل الطلب';
  document.getElementById('saveBtnText').textContent = 'حفظ التعديلات';
  document.getElementById('titleError').style.display = 'none';

  // تحديد النوع
  const catRadio = form.querySelector(`input[name="itemCategory"][value="${item.category}"]`);
  if (catRadio) catRadio.checked = true;

  // الحقول المشروطة
  const shortageFields = document.getElementById('shortageFields');
  const reservationFields = document.getElementById('reservationFields');
  if (item.category === 'reservation') {
    reservationFields.style.display = 'flex';
    shortageFields.style.display = 'none';
  } else if (item.category === 'shortage') {
    reservationFields.style.display = 'none';
    shortageFields.style.display = 'flex';
  } else {
    reservationFields.style.display = 'none';
    shortageFields.style.display = 'none';
  }

  // تعبئة البيانات
  document.getElementById('reqTitle').value = item.title || '';
  document.getElementById('reqDetails').value = item.details || '';
  document.getElementById('reqQuantity').value = item.quantity || '';
  document.getElementById('reqCustomerName').value = item.customerName || '';
  document.getElementById('reqCustomerPhone').value = item.customerPhone || '';
  document.getElementById('reqDueDate').value = item.dueDate || '';

  const prioRadio = form.querySelector(`input[name="reqPriority"][value="${item.priority}"]`);
  if (prioRadio) prioRadio.checked = true;

  // بيانات الكاتب والشفت الأصلية
  document.getElementById('modalAuthorPreview').textContent = item.authorName;
  document.getElementById('modalShiftPreview').textContent = item.shift;

  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('reqTitle').focus(), 50);
};

// ========================================================
// 9. نافذة تأكيد الحذف (Delete Confirmation Modal)
// ========================================================
function setupDeleteModal() {
  const modal = document.getElementById('deleteConfirmModal');
  const cancelBtn = document.getElementById('cancelDeleteBtn');
  const confirmBtn = document.getElementById('confirmDeleteBtn');

  function closeDeleteModal() {
    modal.style.display = 'none';
    state.deletingItemId = null;
  }

  cancelBtn.addEventListener('click', closeDeleteModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeDeleteModal();
  });

  confirmBtn.addEventListener('click', () => {
    if (!state.deletingItemId) return;

    const item = state.items.find(i => i.id === state.deletingItemId);
    const title = item ? item.title : 'الطلب';

    state.items = state.items.filter(i => i.id !== state.deletingItemId);
    saveData();
    closeDeleteModal();
    renderAll();
    showToast(`تم حذف "${title}" نهائياً`, 'info');
  });
}

window.openDeleteModal = function(id) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;

  state.deletingItemId = id;
  const modal = document.getElementById('deleteConfirmModal');
  document.getElementById('deleteConfirmMessage').textContent =
    `هل أنت متأكد من رغبتك في حذف "${item.title}"؟ لا يمكن التراجع عن هذا الإجراء.`;

  modal.style.display = 'flex';
};

// ========================================================
// 10. إعداد الفلاتر والأحداث (Event Listeners)
// ========================================================
function setupEventListeners() {
  // 1. اختيار الموظف
  const userSelect = document.getElementById('userSelect');
  userSelect.addEventListener('change', (e) => {
    state.currentUserId = e.target.value;
    const user = getCurrentUser();
    saveData();
    renderAll();
    showToast(`أنت الآن تعمل باسم: ${user.name}`, 'info');
  });

  // 2. تبديل الشفت (صباحي / مسائي)
  const morningBtn = document.getElementById('shiftMorningBtn');
  const eveningBtn = document.getElementById('shiftEveningBtn');

  morningBtn.addEventListener('click', () => {
    if (state.currentShift === 'صباحي') return;
    state.currentShift = 'صباحي';
    saveData();
    renderAll();
    showToast('تم التحويل إلى الشفت الصباحي ☀️', 'info');
  });

  eveningBtn.addEventListener('click', () => {
    if (state.currentShift === 'مسائي') return;
    state.currentShift = 'مسائي';
    saveData();
    renderAll();
    showToast('تم التحويل إلى الشفت المسائي 🌙', 'info');
  });

  // 3. تبويبات الأقسام (الكل، الحجوزات، النواقص، التبليغات)
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.filters.category = btn.getAttribute('data-category');
      // إذا اختار قسماً، نلغي فلتر الشفت السابق لعدم التضارب
      state.filters.handoverOnly = false;
      renderAll();
    });
  });

  // 4. بطاقات الإحصائيات (تصفية سريعة بالحالة)
  document.getElementById('statAllCard').addEventListener('click', () => {
    resetAllFilters();
  });

  document.getElementById('statNewCard').addEventListener('click', () => {
    state.filters.status = 'new';
    document.getElementById('statusFilter').value = 'new';
    state.filters.handoverOnly = false;
    renderAll();
  });

  document.getElementById('statProgressCard').addEventListener('click', () => {
    state.filters.status = 'in_progress';
    document.getElementById('statusFilter').value = 'in_progress';
    state.filters.handoverOnly = false;
    renderAll();
  });

  document.getElementById('statDoneCard').addEventListener('click', () => {
    state.filters.status = 'completed';
    document.getElementById('statusFilter').value = 'completed';
    state.filters.handoverOnly = false;
    renderAll();
  });

  // 5. زر الشفت السابق (باقي من الشفت السابق)
  const handoverBtn = document.getElementById('handoverToggleBtn');
  handoverBtn.addEventListener('click', () => {
    state.filters.handoverOnly = !state.filters.handoverOnly;
    if (state.filters.handoverOnly) {
      // إعادة تعيين فلتر القسم لإظهار كافة المهام المنقولة
      state.filters.category = 'all';
      tabBtns.forEach(b => b.classList.toggle('active', b.getAttribute('data-category') === 'all'));
      showToast(`يتم الآن عرض المهام المعلقة من الشفت ${getOtherShift()}`, 'info');
    }
    renderAll();
  });

  // 6. فلتر "طلباتي"
  const myTasksBtn = document.getElementById('myTasksToggle');
  myTasksBtn.addEventListener('click', () => {
    state.filters.myTasksOnly = !state.filters.myTasksOnly;
    myTasksBtn.classList.toggle('active', state.filters.myTasksOnly);
    myTasksBtn.setAttribute('aria-pressed', state.filters.myTasksOnly ? 'true' : 'false');
    renderAll();
  });

  // 7. فلتر الحالة
  const statusFilter = document.getElementById('statusFilter');
  statusFilter.addEventListener('change', (e) => {
    state.filters.status = e.target.value;
    state.filters.handoverOnly = false;
    renderAll();
  });

  // 8. فلتر الأولوية
  const priorityFilter = document.getElementById('priorityFilter');
  priorityFilter.addEventListener('change', (e) => {
    state.filters.priority = e.target.value;
    renderAll();
  });

  // 9. البحث
  const searchInput = document.getElementById('searchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');

  searchInput.addEventListener('input', (e) => {
    state.filters.search = e.target.value;
    clearSearchBtn.style.display = e.target.value ? 'block' : 'none';
    renderAll();
  });

  clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    state.filters.search = '';
    clearSearchBtn.style.display = 'none';
    renderAll();
  });

  // 10. إلغاء جميع الفلاتر
  const clearAllFiltersBtn = document.getElementById('clearAllFiltersBtn');
  if (clearAllFiltersBtn) {
    clearAllFiltersBtn.addEventListener('click', resetAllFilters);
  }

  // 11. زر استعادة البيانات الافتراضية
  const resetDataBtn = document.getElementById('resetDataBtn');
  if (resetDataBtn) {
    resetDataBtn.addEventListener('click', resetToDefaultData);
  }
}

function resetAllFilters() {
  state.filters.category = 'all';
  state.filters.status = 'all';
  state.filters.priority = 'all';
  state.filters.search = '';
  state.filters.myTasksOnly = false;
  state.filters.handoverOnly = false;

  // تحديث عناصر التحكم المرئية
  document.getElementById('statusFilter').value = 'all';
  document.getElementById('priorityFilter').value = 'all';
  document.getElementById('searchInput').value = '';
  document.getElementById('clearSearchBtn').style.display = 'none';
  document.getElementById('myTasksToggle').classList.remove('active');
  document.getElementById('myTasksToggle').setAttribute('aria-pressed', 'false');

  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(b => b.classList.toggle('active', b.getAttribute('data-category') === 'all'));

  renderAll();
  showToast('تمت إعادة ضبط التصفية وعرض كل الطلبات', 'info');
}

// ========================================================
// 11. بدء تشغيل التطبيق (Initialization)
// ========================================================
document.addEventListener('DOMContentLoaded', () => {
  loadData();
  setupModal();
  setupDeleteModal();
  setupEventListeners();
  renderAll();
});
