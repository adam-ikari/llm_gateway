import { loginScript } from './pages/login';
import { dashboardScript } from './pages/dashboard';
import { keysScript } from './pages/keys';
import { endpointsScript } from './pages/endpoints';
import { bindingsScript } from './pages/bindings';
import { statsScript } from './pages/stats';

// Split "</script>" to avoid HTML parser closing the outer <script> tag prematurely
const SC = '</' + 'script>';

export function renderHTML(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LLM Gateway</title>
  <script src="https://cdn.tailwindcss.com">${SC}
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            brand: { 50:'#eff6ff',100:'#dbeafe',200:'#bfdbfe',300:'#93c5fd',400:'#60a5fa',500:'#3b82f6',600:'#2563eb',700:'#1d4ed8',800:'#1e40af',900:'#1e3a8a' }
          }
        }
      }
    }
  ${SC}
  <style>
    .sidebar-link { display:flex; align-items:center; gap:0.75rem; padding:0.625rem 1rem; border-radius:0.5rem; font-size:0.875rem; font-weight:500; color:#6b7280; transition:all .15s; }
    .sidebar-link:hover { background:#f3f4f6; color:#111827; }
    .sidebar-link.active { background:#eff6ff; color:#2563eb; }
    .fade-in { animation: fadeIn .2s ease-out; }
    @keyframes fadeIn { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }
    .spinner { border:3px solid #e5e7eb; border-top-color:#3b82f6; border-radius:50%; width:24px; height:24px; animation:spin .6s linear infinite; }
    @keyframes spin { to { transform:rotate(360deg); } }
    .modal-overlay { background:rgba(0,0,0,0.5); }
    .toggle-track { width:40px; height:22px; border-radius:11px; background:#d1d5db; position:relative; cursor:pointer; transition:background .2s; }
    .toggle-track.on { background:#3b82f6; }
    .toggle-knob { width:18px; height:18px; border-radius:50%; background:white; position:absolute; top:2px; left:2px; transition:left .2s; box-shadow:0 1px 3px rgba(0,0,0,0.2); }
    .toggle-track.on .toggle-knob { left:20px; }
    .bar-chart-bar { height:24px; border-radius:4px; transition:width .3s ease; min-width:2px; }
  </style>
</head>
<body class="bg-gray-50 text-gray-900 min-h-screen">
  <div id="app"></div>
  <div id="toast-container" class="fixed top-4 right-4 z-50 flex flex-col gap-2"></div>
  <div id="modal-container" class="hidden fixed inset-0 z-40"></div>

  <script>
    // ==================== i18n ====================
    var T = {
      appTitle: 'LLM Gateway',
      login: '登录',
      register: '注册',
      email: '邮箱',
      password: '密码',
      confirmPassword: '确认密码',
      dashboard: '仪表盘',
      keys: 'API 密钥',
      endpoints: '端点',
      models: '模型',
      stats: '统计',
      bindings: '绑定配置',
      create: '创建',
      edit: '编辑',
      delete: '删除',
      save: '保存',
      cancel: '取消',
      confirm: '确认',
      close: '关闭',
      name: '名称',
      status: '状态',
      active: '活跃',
      inactive: '已禁用',
      createdAt: '创建时间',
      totalRequests: '总请求数',
      totalTokens: '总 Token 数',
      avgResponseTime: '平均响应时间',
      activeKeys: '活跃密钥数',
      balance: '余额',
      priority: '优先级',
      requestTypes: '请求类型',
      text: '文本',
      image: '图像',
      audio: '音频',
      video: '视频',
      file: '文件',
      contextWindow: '上下文窗口',
      maxOutput: '最大输出',
      keyWarning: '请立即复制此密钥，关闭后将无法再次查看！',
      copyKey: '复制密钥',
      copied: '已复制！',
      copy: '复制',
      logout: '退出登录',
      noData: '暂无数据',
      loading: '加载中...',
      deleteConfirm: '确定要删除吗？此操作不可撤销。',
      logoutConfirm: '确定要退出登录吗？',
      registerSuccess: '注册成功',
      loginSuccess: '登录成功',
      operationSuccess: '操作成功',
      operationFailed: '操作失败',
      addEndpoint: '添加端点',
      addModel: '添加模型',
      queryAllBalances: '查询所有余额',
      queryBalance: '查询余额',
      saveBindings: '保存绑定',
      addBinding: '添加绑定',
      format: '格式',
      baseUrl: 'Base URL',
      apiKey: 'API Key',
      supportedModels: '支持的模型',
      realModel: '真实模型名',
      endpointName: '端点名称',
      modelName: '模型名称',
      available: '可用',
      unavailable: '不可用',
      remaining: '剩余',
      used: '已用',
      total: '总额',
      date: '日期',
      overview: '概览',
      byKey: '按密钥',
      byModel: '按模型',
      capabilities: '能力',
      emailRequired: '请输入邮箱',
      passwordRequired: '请输入密码',
      passwordTooShort: '密码至少 8 个字符',
      nameRequired: '请输入名称',
      passwordMismatch: '两次密码不一致',
      backToLogin: '返回登录',
      goRegister: '没有账号？立即注册',
      goLogin: '已有账号？立即登录',
      saveChanges: '保存更改',
      createKey: '创建密钥',
      keyPrefix: '前缀',
      actions: '操作',
      configureBindings: '配置绑定',
      showKey: '显示密钥',
      masked: '••••••••',
      unchanged: '未更改',
      notFound: '未找到',
      unit: '个',
      ms: 'ms',
      tokens: 'Token',
      request: '请求',
      select: '选择',
    };

    // ==================== Store ====================
    var Store = {
      _s: {
        apiKey: localStorage.getItem('llm_api_key') || null,
        email: localStorage.getItem('llm_email') || null,
        currentPage: 'login',
        keys: [],
        endpoints: [],
        models: [],
        stats: null,
      },
      get: function(k) { return this._s[k]; },
      set: function(k, v) { this._s[k] = v; if (k === 'apiKey') { if (v) localStorage.setItem('llm_api_key', v); else localStorage.removeItem('llm_api_key'); } if (k === 'email') { if (v) localStorage.setItem('llm_email', v); else localStorage.removeItem('llm_email'); } },
      isLoggedIn: function() { return !!this._s.apiKey; },
      logout: function() { localStorage.removeItem('llm_api_key'); localStorage.removeItem('llm_email'); this._s.apiKey = null; this._s.email = null; navigate('login'); }
    };

    // ==================== API Client ====================
    var API = {
      _req: function(method, path, body) {
        var headers = { 'Content-Type': 'application/json' };
        var apiKey = Store.get('apiKey');
        if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;
        var opts = { method: method, headers: headers };
        if (body) opts.body = JSON.stringify(body);
        return fetch('/v1' + path, opts).then(function(res) {
          if (res.status === 401) { Store.logout(); throw new Error('认证失败，请重新登录'); }
          return res.json().then(function(data) {
            if (!res.ok) throw new Error((data.error && data.error.message) || '请求失败');
            return data;
          });
        });
      },
      register: function(email, pw) { return this._req('POST', '/auth/register', { email: email, password: pw }); },
      login: function(email, pw) { return this._req('POST', '/auth/login', { email: email, password: pw }); },
      listKeys: function() { return this._req('GET', '/keys'); },
      createKey: function(name) { return this._req('POST', '/keys', { name: name }); },
      updateKey: function(id, data) { return this._req('PATCH', '/keys/' + id, data); },
      deleteKey: function(id) { return this._req('DELETE', '/keys/' + id); },
      listEndpoints: function() { return this._req('GET', '/endpoints'); },
      createEndpoint: function(data) { return this._req('POST', '/endpoints', data); },
      updateEndpoint: function(id, data) { return this._req('PUT', '/endpoints/' + id, data); },
      deleteEndpoint: function(id) { return this._req('DELETE', '/endpoints/' + id); },
      getEndpointBalance: function(id) { return this._req('GET', '/endpoints/' + id + '/balance'); },
      getAllBalances: function() { return this._req('GET', '/endpoints/balances'); },
      getBindings: function(keyId) { return this._req('GET', '/keys/' + keyId + '/bindings'); },
      setBindings: function(keyId, bindings) { return this._req('PUT', '/keys/' + keyId + '/bindings', { bindings: bindings }); },
      getStats: function(date) { return this._req('GET', '/stats' + (date ? '?date=' + date : '')); },
      getKeyStats: function(keyId, date) { return this._req('GET', '/stats/keys/' + keyId + (date ? '?date=' + date : '')); },
      getModelStats: function(model, date) { return this._req('GET', '/stats/models/' + model + (date ? '?date=' + date : '')); },
      listModels: function() { return this._req('GET', '/models'); },
    };

    // ==================== Components ====================
    function toast(msg, type) {
      type = type || 'info';
      var colors = { success: 'bg-green-500', error: 'bg-red-500', info: 'bg-blue-500', warning: 'bg-yellow-500' };
      var el = document.createElement('div');
      el.className = colors[type] + ' text-white px-4 py-2 rounded-lg shadow-lg text-sm fade-in';
      el.textContent = msg;
      document.getElementById('toast-container').appendChild(el);
      setTimeout(function() { el.remove(); }, 3000);
    }

    function showModal(title, bodyHtml, footerHtml) {
      var c = document.getElementById('modal-container');
      c.innerHTML = '<div class="modal-overlay fixed inset-0 flex items-center justify-center p-4" onclick="if(event.target===this)closeModal()">' +
        '<div class="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-auto fade-in">' +
        '<div class="flex items-center justify-between p-4 border-b"><h3 class="text-lg font-semibold">' + title + '</h3>' +
        '<button onclick="closeModal()" class="text-gray-400 hover:text-gray-600 text-xl">&times;</button></div>' +
        '<div class="p-4">' + bodyHtml + '</div>' +
        (footerHtml ? '<div class="p-4 border-t flex justify-end gap-2">' + footerHtml + '</div>' : '') +
        '</div></div>';
      c.classList.remove('hidden');
    }

    function closeModal() {
      var c = document.getElementById('modal-container');
      c.classList.add('hidden');
      c.innerHTML = '';
    }

    function confirmDialog(msg, onConfirm) {
      showModal(T.confirm, '<p class="text-gray-600">' + msg + '</p>',
        '<button onclick="closeModal()" class="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">' + T.cancel + '</button>' +
        '<button id="confirm-btn" class="px-4 py-2 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600">' + T.confirm + '</button>');
      document.getElementById('confirm-btn').onclick = function() { closeModal(); onConfirm(); };
    }

    function formatBadge(format) {
      var colors = { openai: 'bg-green-100 text-green-700', anthropic: 'bg-orange-100 text-orange-700', gemini: 'bg-blue-100 text-blue-700' };
      return '<span class="px-2 py-0.5 rounded-full text-xs font-medium ' + (colors[format] || 'bg-gray-100 text-gray-700') + '">' + format + '</span>';
    }

    function formatTime(ts) {
      if (!ts) return '-';
      var d = new Date(ts);
      return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0') + ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
    }

    function spinnerHtml() {
      return '<div class="flex justify-center py-8"><div class="spinner"></div></div>';
    }

    function emptyState(msg, actionText, actionHref) {
      var h = '<div class="text-center py-12"><svg class="mx-auto h-12 w-12 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"/></svg><p class="mt-2 text-sm text-gray-500">' + msg + '</p>';
      if (actionText && actionHref) {
        h += '<a href="' + actionHref + '" class="mt-4 inline-block text-sm text-brand-600 hover:text-brand-700 font-medium">' + actionText + '</a>';
      }
      h += '</div>';
      return h;
    }

    // ==================== Layout ====================
    function layoutHtml(page, content) {
      var links = [
        { id: 'dashboard', hash: '#dashboard', icon: '<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"/></svg>', label: T.dashboard },
        { id: 'keys', hash: '#keys', icon: '<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/></svg>', label: T.keys },
        { id: 'endpoints', hash: '#endpoints', icon: '<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2"/></svg>', label: T.endpoints },
        { id: 'stats', hash: '#stats', icon: '<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>', label: T.stats },
      ];
      var sidebarLinks = '';
      for (var i = 0; i < links.length; i++) {
        var l = links[i];
        var cls = 'sidebar-link' + (page === l.id || (page === 'bindings' && l.id === 'keys') ? ' active' : '');
        sidebarLinks += '<a href="' + l.hash + '" class="' + cls + '">' + l.icon + '<span>' + l.label + '</span></a>';
      }
      var email = Store.get('email') || '';
      return '<div class="flex min-h-screen">' +
        '<aside id="sidebar" class="hidden md:flex flex-col w-56 bg-white border-r border-gray-200 fixed h-full z-30">' +
          '<div class="p-4 border-b"><h1 class="text-lg font-bold text-brand-600">' + T.appTitle + '</h1></div>' +
          '<nav class="flex-1 p-3 space-y-1">' + sidebarLinks + '</nav>' +
          '<div class="p-3 border-t"><button onclick="Store.logout()" class="sidebar-link w-full text-red-500 hover:bg-red-50"><svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg><span>' + T.logout + '</span></button></div>' +
        '</aside>' +
        '<div class="md:ml-56 flex-1 flex flex-col">' +
          '<header class="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-20">' +
            '<button id="menu-btn" class="md:hidden text-gray-500" onclick="toggleSidebar()"><svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg></button>' +
            '<span class="text-sm text-gray-500">' + email + '</span>' +
            '<span class="ml-auto md:hidden text-red-500 text-sm cursor-pointer" onclick="Store.logout()">' + T.logout + '</span>' +
          '</header>' +
          '<main class="flex-1 p-4 md:p-6 fade-in">' + content + '</main>' +
        '</div>' +
      '</div>' +
      '<div id="sidebar-overlay" class="hidden fixed inset-0 bg-black/30 z-20 md:hidden" onclick="toggleSidebar()"></div>';
    }

    var _sidebarOpen = false;
    function toggleSidebar() {
      var sb = document.getElementById('sidebar');
      var ov = document.getElementById('sidebar-overlay');
      _sidebarOpen = !_sidebarOpen;
      if (_sidebarOpen) { sb.classList.remove('hidden'); sb.classList.add('flex'); sb.style.position='fixed'; ov.classList.remove('hidden'); }
      else { sb.classList.add('hidden'); sb.classList.remove('flex'); ov.classList.add('hidden'); }
    }

    // ==================== Router ====================
    function navigate(hash) { window.location.hash = hash; }

    function parseRoute() {
      var hash = window.location.hash.slice(1) || '';
      var parts = hash.split('/').filter(Boolean);
      if (parts.length === 0) return { page: Store.isLoggedIn() ? 'dashboard' : 'login', params: {} };
      if (parts[0] === 'keys' && parts.length >= 3 && parts[2] === 'bindings') return { page: 'bindings', params: { keyId: parts[1] } };
      return { page: parts[0], params: {} };
    }

    function renderPage() {
      var route = parseRoute();
      if (!Store.isLoggedIn() && route.page !== 'login') { navigate('login'); return; }
      if (Store.isLoggedIn() && route.page === 'login') { navigate('dashboard'); return; }
      Store.set('currentPage', route.page);
      var app = document.getElementById('app');
      var pageRenderers = {
        login: loginPage,
        dashboard: dashboardPage,
        keys: keysPage,
        endpoints: endpointsPage,
        bindings: bindingsPage,
        stats: statsPage,
      };
      var renderer = pageRenderers[route.page];
      if (renderer) { renderer(app, route.params); }
      else { app.innerHTML = layoutHtml(route.page, emptyState(T.notFound, T.dashboard, '#dashboard')); }
    }

    // ==================== Helpers ====================
    function escHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    function escAttr(s) { return s.replace(/&/g,'&amp;').replace(/"/g,'&quot;'); }

    // ==================== Page Renderers ====================
    ${loginScript()}
    ${dashboardScript()}
    ${keysScript()}
    ${endpointsScript()}
    ${bindingsScript()}
    ${statsScript()}

    // ==================== Init ====================
    window.addEventListener('hashchange', renderPage);
    renderPage();
  ${SC}
</body>
</html>`;
}
