export function keysRender(): string {
  return '';
}

export function keysScript(): string {
  return `
    function keysPage(app, params) {
      app.innerHTML = layoutHtml('keys',
        '<div class="flex items-center justify-between mb-6">' +
          '<h1 class="text-2xl font-bold">' + T.keys + '</h1>' +
          '<button onclick="showCreateKeyModal()" class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700">+ ' + T.createKey + '</button>' +
        '</div>' +
        '<div id="keys-content">' + spinnerHtml() + '</div>'
      );
      loadKeys();
    }

    function loadKeys() {
      API.listKeys().then(function(keys) {
        Store.set('keys', keys);
        renderKeysTable(keys);
      }).catch(function(err) { toast(err.message, 'error'); });
    }

    function renderKeysTable(keys) {
      var el = document.getElementById('keys-content');
      if (!keys || keys.length === 0) {
        el.innerHTML = emptyState(T.noData, '+ ' + T.createKey, 'javascript:showCreateKeyModal()');
        return;
      }
      var html = '<div class="bg-white rounded-xl border border-gray-200 overflow-hidden"><table class="w-full text-sm">' +
        '<thead class="bg-gray-50 border-b"><tr>' +
        '<th class="px-4 py-3 text-left font-medium text-gray-600">' + T.name + '</th>' +
        '<th class="px-4 py-3 text-left font-medium text-gray-600">' + T.keyPrefix + '</th>' +
        '<th class="px-4 py-3 text-left font-medium text-gray-600">' + T.status + '</th>' +
        '<th class="px-4 py-3 text-left font-medium text-gray-600">' + T.createdAt + '</th>' +
        '<th class="px-4 py-3 text-right font-medium text-gray-600">' + T.actions + '</th>' +
        '</tr></thead><tbody>';
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var statusHtml = '<div class="toggle-track ' + (k.is_active ? 'on' : '') + '" onclick="toggleKey(\\'' + k.key_id + '\\',' + !k.is_active + ')"><div class="toggle-knob"></div></div>';
        html += '<tr class="border-b hover:bg-gray-50">' +
          '<td class="px-4 py-3"><a href="#keys/' + k.key_id + '/bindings" class="text-brand-600 hover:underline font-medium">' + escHtml(k.name) + '</a></td>' +
          '<td class="px-4 py-3 font-mono text-xs text-gray-500">' + escHtml(k.key_prefix) + '</td>' +
          '<td class="px-4 py-3">' + statusHtml + '</td>' +
          '<td class="px-4 py-3 text-gray-500">' + formatTime(k.created_at) + '</td>' +
          '<td class="px-4 py-3 text-right space-x-2">' +
            '<button onclick="showEditKeyModal(\\'' + k.key_id + '\\',\\'' + escAttr(k.name) + '\\')" class="text-brand-600 hover:text-brand-700 text-xs">' + T.edit + '</button>' +
            '<button onclick="deleteKeyConfirm(\\'' + k.key_id + '\\')" class="text-red-500 hover:text-red-600 text-xs">' + T.delete + '</button>' +
          '</td></tr>';
      }
      html += '</tbody></table></div>';
      el.innerHTML = html;
    }

    function showCreateKeyModal() {
      showModal(T.createKey,
        '<div><label class="block text-sm font-medium text-gray-700 mb-1">' + T.name + '</label>' +
        '<input id="new-key-name" type="text" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500 outline-none" placeholder="My API Key"></div>',
        '<button onclick="closeModal()" class="px-4 py-2 text-sm text-gray-600">' + T.cancel + '</button>' +
        '<button onclick="doCreateKey()" class="px-4 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700">' + T.create + '</button>');
    }

    function doCreateKey() {
      var name = document.getElementById('new-key-name').value.trim();
      if (!name) { toast(T.nameRequired, 'warning'); return; }
      API.createKey(name).then(function(data) {
        closeModal();
        showKeyCreatedModal(data.api_key);
        loadKeys();
      }).catch(function(err) { toast(err.message, 'error'); });
    }

    function showKeyCreatedModal(apiKey) {
      showModal(T.createKey,
        '<p class="text-sm text-red-600 font-medium mb-3">' + T.keyWarning + '</p>' +
        '<div class="flex items-center gap-2"><input id="created-key" type="text" value="' + apiKey + '" readonly class="flex-1 px-3 py-2 bg-gray-50 border rounded-lg font-mono text-sm">' +
        '<button onclick="copyCreatedKey()" class="px-3 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700">' + T.copy + '</button></div>',
        '<button onclick="closeModal()" class="px-4 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700">' + T.close + '</button>');
    }

    function copyCreatedKey() {
      var el = document.getElementById('created-key');
      if (!el) return;
      navigator.clipboard.writeText(el.value).then(function() { toast(T.copied, 'success'); });
    }

    function toggleKey(keyId, newActive) {
      API.updateKey(keyId, { is_active: newActive }).then(function() {
        toast(T.operationSuccess, 'success');
        loadKeys();
      }).catch(function(err) { toast(err.message, 'error'); });
    }

    function showEditKeyModal(keyId, currentName) {
      showModal(T.edit,
        '<div><label class="block text-sm font-medium text-gray-700 mb-1">' + T.name + '</label>' +
        '<input id="edit-key-name" type="text" value="' + currentName + '" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500 outline-none"></div>',
        '<button onclick="closeModal()" class="px-4 py-2 text-sm text-gray-600">' + T.cancel + '</button>' +
        '<button onclick="doEditKey(\\'' + keyId + '\\')" class="px-4 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700">' + T.save + '</button>');
    }

    function doEditKey(keyId) {
      var name = document.getElementById('edit-key-name').value.trim();
      if (!name) { toast(T.nameRequired, 'warning'); return; }
      API.updateKey(keyId, { name: name }).then(function() {
        closeModal(); toast(T.operationSuccess, 'success'); loadKeys();
      }).catch(function(err) { toast(err.message, 'error'); });
    }

    function deleteKeyConfirm(keyId) {
      confirmDialog(T.deleteConfirm, function() {
        API.deleteKey(keyId).then(function() { toast(T.operationSuccess, 'success'); loadKeys(); })
        .catch(function(err) { toast(err.message, 'error'); });
      });
    }

    function escHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    function escAttr(s) { return s.replace(/'/g, "\\\\'").replace(/"/g, '&quot;'); }
  `;
}
