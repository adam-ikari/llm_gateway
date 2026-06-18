export function loginRender(): string {
  return '';
}

export function loginScript(): string {
  return `
    function loginPage(app, params) {
      app.innerHTML =
        '<div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-500 to-brand-700 p-4">' +
          '<div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">' +
            '<h1 class="text-2xl font-bold text-center mb-6">' + T.appTitle + '</h1>' +
            '<div class="flex mb-6 bg-gray-100 rounded-lg p-1">' +
              '<button id="tab-login" onclick="switchAuthTab(' + "'" + 'login' + "'" + ')" class="flex-1 py-2 text-sm font-medium rounded-md transition-all bg-white shadow text-brand-600">' + T.login + '</button>' +
              '<button id="tab-register" onclick="switchAuthTab(' + "'" + 'register' + "'" + ')" class="flex-1 py-2 text-sm font-medium rounded-md transition-all text-gray-500">' + T.register + '</button>' +
            '</div>' +
            '<form id="auth-form" onsubmit="handleAuth(event)">' +
              '<div class="space-y-4">' +
                '<div><label class="block text-sm font-medium text-gray-700 mb-1">' + T.email + '</label>' +
                '<input id="auth-email" type="email" required class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none" placeholder="user@example.com"></div>' +
                '<div><label class="block text-sm font-medium text-gray-700 mb-1">' + T.password + '</label>' +
                '<input id="auth-password" type="password" required minlength="8" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none" placeholder="********"></div>' +
                '<div id="confirm-pw-group" class="hidden"><label class="block text-sm font-medium text-gray-700 mb-1">' + T.confirmPassword + '</label>' +
                '<input id="auth-confirm-pw" type="password" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none" placeholder="********"></div>' +
              '</div>' +
              '<div id="auth-error" class="mt-3 text-sm text-red-600 hidden"></div>' +
              '<button id="auth-submit" type="submit" class="w-full mt-6 py-2.5 bg-brand-600 text-white rounded-lg font-medium hover:bg-brand-700 transition-colors">' + T.login + '</button>' +
            '</form>' +
            '<p id="auth-switch" class="mt-4 text-center text-sm text-gray-500">' + T.goRegister + '</p>' +
          '</div>' +
        '</div>';
      _authTab = 'login';
    }

    var _authTab = 'login';
    function switchAuthTab(tab) {
      _authTab = tab;
      var loginBtn = document.getElementById('tab-login');
      var regBtn = document.getElementById('tab-register');
      var confirmGroup = document.getElementById('confirm-pw-group');
      var submitBtn = document.getElementById('auth-submit');
      var switchText = document.getElementById('auth-switch');
      if (tab === 'login') {
        loginBtn.className = 'flex-1 py-2 text-sm font-medium rounded-md transition-all bg-white shadow text-brand-600';
        regBtn.className = 'flex-1 py-2 text-sm font-medium rounded-md transition-all text-gray-500';
        confirmGroup.classList.add('hidden');
        submitBtn.textContent = T.login;
        switchText.innerHTML = T.goRegister;
      } else {
        regBtn.className = 'flex-1 py-2 text-sm font-medium rounded-md transition-all bg-white shadow text-brand-600';
        loginBtn.className = 'flex-1 py-2 text-sm font-medium rounded-md transition-all text-gray-500';
        confirmGroup.classList.remove('hidden');
        submitBtn.textContent = T.register;
        switchText.innerHTML = T.goLogin;
      }
      document.getElementById('auth-error').classList.add('hidden');
    }

    function handleAuth(e) {
      e.preventDefault();
      var email = document.getElementById('auth-email').value.trim();
      var password = document.getElementById('auth-password').value;
      var errEl = document.getElementById('auth-error');
      errEl.classList.add('hidden');
      if (!email) { showAuthErr(T.emailRequired); return; }
      if (!password || password.length < 8) { showAuthErr(T.passwordTooShort); return; }
      if (_authTab === 'register') {
        var confirmPw = document.getElementById('auth-confirm-pw').value;
        if (password !== confirmPw) { showAuthErr(T.passwordMismatch); return; }
      }
      var btn = document.getElementById('auth-submit');
      btn.disabled = true; btn.textContent = T.loading;
      var p = _authTab === 'login' ? API.login(email, password) : API.register(email, password);
      p.then(function(data) {
        Store.set('apiKey', data.api_key);
        Store.set('email', email);
        if (_authTab === 'register' && data.api_key) {
          showKeyModal(data.api_key);
        } else {
          toast(T.loginSuccess, 'success');
          navigate('dashboard');
        }
      }).catch(function(err) { showAuthErr(err.message); })
      .finally(function() { btn.disabled = false; btn.textContent = _authTab === 'login' ? T.login : T.register; });
    }

    function showAuthErr(msg) {
      var el = document.getElementById('auth-error');
      el.textContent = msg; el.classList.remove('hidden');
    }

    function showKeyModal(apiKey) {
      showModal(T.registerSuccess,
        '<p class="text-sm text-gray-600 mb-3">' + T.keyWarning + '</p>' +
        '<div class="flex items-center gap-2"><input id="new-key-display" type="text" value="' + apiKey + '" readonly class="flex-1 px-3 py-2 bg-gray-50 border rounded-lg font-mono text-sm">' +
        '<button onclick="copyKey()" class="px-3 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700">' + T.copy + '</button></div>',
        '<button onclick="closeModal();navigate(' + "'" + 'dashboard' + "'" + ')" class="px-4 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700">' + T.close + '</button>');
    }

    function copyKey() {
      var el = document.getElementById('new-key-display');
      if (!el) return;
      navigator.clipboard.writeText(el.value).then(function() { toast(T.copied, 'success'); });
    }
  `;
}
