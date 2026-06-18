export function endpointsRender(): string {
  return '';
}

export function endpointsScript(): string {
  return `
    function endpointsPage(app, params) {
      app.innerHTML = layoutHtml('endpoints',
        '<div class="flex items-center justify-between mb-6">' +
          '<h1 class="text-2xl font-bold">' + T.endpoints + '</h1>' +
          '<div class="flex gap-2">' +
            '<button onclick="queryAllBalances()" class="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">' + T.queryAllBalances + '</button>' +
            '<button onclick="showCreateEndpointModal()" class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700">+ ' + T.addEndpoint + '</button>' +
          '</div>' +
        '</div>' +
        '<div id="ep-content">' + spinnerHtml() + '</div>'
      );
      loadEndpoints();
    }

    function loadEndpoints() {
      API.listEndpoints().then(function(eps) {
        Store.set('endpoints', eps);
        renderEndpoints(eps);
      }).catch(function(err) { toast(err.message, 'error'); });
    }

    function renderEndpoints(eps) {
      var el = document.getElementById('ep-content');
      if (!eps || eps.length === 0) {
        el.innerHTML = emptyState(T.noData, '+ ' + T.addEndpoint, 'javascript:showCreateEndpointModal()');
        return;
      }
      var html = '<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">';
      for (var i = 0; i < eps.length; i++) {
        var ep = eps[i];
        var modelTags = '';
        for (var j = 0; j < ep.supported_models.length; j++) {
          var m = ep.supported_models[j];
          modelTags += '<span class="inline-block px-2 py-0.5 bg-gray-100 rounded text-xs mr-1 mb-1">' + escHtml(m.name) + '</span>';
        }
        html += '<div class="bg-white rounded-xl border border-gray-200 p-5">' +
          '<div class="flex items-start justify-between mb-3">' +
            '<div><h3 class="font-semibold text-gray-800">' + escHtml(ep.name) + '</h3>' +
            '<p class="text-xs text-gray-500 font-mono mt-1">' + escHtml(ep.base_url) + '</p></div>' +
            '<div class="flex items-center gap-2">' + formatBadge(ep.format) + '</div>' +
          '</div>' +
          '<div class="mb-3">' + modelTags + '</div>' +
          '<div id="ep-balance-' + ep.endpoint_id + '" class="text-xs text-gray-500 mb-3"></div>' +
          '<div class="flex items-center gap-2 pt-3 border-t">' +
            '<button onclick="queryBalance(\\'' + ep.endpoint_id + '\\')" class="text-xs text-brand-600 hover:text-brand-700">' + T.queryBalance + '</button>' +
            '<button onclick="showEditEndpointModal(\\'' + ep.endpoint_id + '\\')" class="text-xs text-brand-600 hover:text-brand-700">' + T.edit + '</button>' +
            '<button onclick="deleteEndpointConfirm(\\'' + ep.endpoint_id + '\\')" class="text-xs text-red-500 hover:text-red-600">' + T.delete + '</button>' +
          '</div></div>';
      }
      html += '</div>';
      el.innerHTML = html;
    }

    function queryBalance(epId) {
      var bEl = document.getElementById('ep-balance-' + epId);
      if (bEl) bEl.innerHTML = '<div class="spinner" style="width:16px;height:16px;border-width:2px;"></div>';
      API.getEndpointBalance(epId).then(function(data) {
        var bEl = document.getElementById('ep-balance-' + epId);
        if (!bEl) return;
        if (data.balance && data.balance.available) {
          var text = '';
          if (data.balance.remaining !== undefined) text += T.remaining + ': ' + data.balance.remaining;
          if (data.balance.used !== undefined) text += (text ? ' | ' : '') + T.used + ': ' + data.balance.used;
          if (data.balance.total !== undefined) text += (text ? ' | ' : '') + T.total + ': ' + data.balance.total;
          if (data.balance.currency) text += ' ' + data.balance.currency;
          bEl.innerHTML = '<span class="text-green-600">' + text + '</span>';
        } else {
          bEl.innerHTML = '<span class="text-gray-400">' + T.unavailable + '</span>';
        }
      }).catch(function(err) {
        var bEl = document.getElementById('ep-balance-' + epId);
        if (bEl) bEl.innerHTML = '<span class="text-red-400">' + err.message + '</span>';
      });
    }

    function queryAllBalances() {
      API.getAllBalances().then(function(data) {
        var list = data.balances || [];
        for (var i = 0; i < list.length; i++) {
          var b = list[i];
          var bEl = document.getElementById('ep-balance-' + b.endpoint_id);
          if (!bEl) continue;
          if (b.balance && b.balance.available) {
            var text = '';
            if (b.balance.remaining !== undefined) text += T.remaining + ': ' + b.balance.remaining;
            if (b.balance.used !== undefined) text += (text ? ' | ' : '') + T.used + ': ' + b.balance.used;
            if (b.balance.total !== undefined) text += (text ? ' | ' : '') + T.total + ': ' + b.balance.total;
            if (b.balance.currency) text += ' ' + b.balance.currency;
            bEl.innerHTML = '<span class="text-green-600">' + text + '</span>';
          } else {
            bEl.innerHTML = '<span class="text-gray-400">' + T.unavailable + '</span>';
          }
        }
        toast(T.operationSuccess, 'success');
      }).catch(function(err) { toast(err.message, 'error'); });
    }

    function showCreateEndpointModal() {
      _epFormMode = 'create'; _epEditId = null;
      showEndpointFormModal({});
    }

    function showEditEndpointModal(epId) {
      var eps = Store.get('endpoints') || [];
      var ep = eps.find(function(e) { return e.endpoint_id === epId; });
      if (!ep) { toast(T.notFound, 'error'); return; }
      _epFormMode = 'edit'; _epEditId = epId;
      showEndpointFormModal(ep);
    }

    var _epFormMode = 'create'; var _epEditId = null;
    function showEndpointFormModal(ep) {
      var isEdit = _epFormMode === 'edit';
      var models = ep.supported_models || [{ name: '', real_model: '', context_window: 128000, max_output_tokens: 4096 }];
      var modelsHtml = '';
      for (var i = 0; i < models.length; i++) {
        modelsHtml += epModelRow(i, models[i]);
      }
      showModal(isEdit ? T.edit : T.addEndpoint,
        '<div class="space-y-4">' +
          '<div><label class="block text-sm font-medium text-gray-700 mb-1">' + T.name + '</label>' +
          '<input id="ep-name" type="text" value="' + (ep.name || '') + '" class="w-full px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-brand-500"></div>' +
          '<div><label class="block text-sm font-medium text-gray-700 mb-1">' + T.baseUrl + '</label>' +
          '<input id="ep-url" type="text" value="' + (ep.base_url || '') + '" placeholder="https://api.openai.com" class="w-full px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-brand-500"></div>' +
          '<div><label class="block text-sm font-medium text-gray-700 mb-1">' + T.apiKey + '</label>' +
          '<input id="ep-apikey" type="password" placeholder="' + (isEdit ? T.unchanged : '') + '" class="w-full px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-brand-500"></div>' +
          '<div><label class="block text-sm font-medium text-gray-700 mb-1">' + T.format + '</label>' +
          '<select id="ep-format" class="w-full px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-brand-500">' +
            '<option value="openai"' + (ep.format === 'openai' ? ' selected' : '') + '>OpenAI</option>' +
            '<option value="anthropic"' + (ep.format === 'anthropic' ? ' selected' : '') + '>Anthropic</option>' +
            '<option value="gemini"' + (ep.format === 'gemini' ? ' selected' : '') + '>Gemini</option>' +
          '</select></div>' +
          '<div><div class="flex items-center justify-between mb-2"><label class="text-sm font-medium text-gray-700">' + T.supportedModels + '</label>' +
          '<button onclick="addEpModelRow()" class="text-xs text-brand-600 hover:text-brand-700">+ ' + T.addModel + '</button></div>' +
          '<div id="ep-models-list" class="space-y-2">' + modelsHtml + '</div></div>' +
        '</div>',
        '<button onclick="closeModal()" class="px-4 py-2 text-sm text-gray-600">' + T.cancel + '</button>' +
        '<button onclick="doSaveEndpoint()" class="px-4 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700">' + T.save + '</button>');
    }

    function epModelRow(idx, m) {
      return '<div class="flex gap-2 items-start">' +
        '<input data-field="name" value="' + (m.name || '') + '" placeholder="' + T.modelName + '" class="flex-1 px-2 py-1.5 border rounded text-sm outline-none focus:ring-1 focus:ring-brand-500">' +
        '<input data-field="real_model" value="' + (m.real_model || '') + '" placeholder="' + T.realModel + '" class="flex-1 px-2 py-1.5 border rounded text-sm outline-none focus:ring-1 focus:ring-brand-500">' +
        '<input data-field="context_window" type="number" value="' + (m.context_window || 128000) + '" placeholder="' + T.contextWindow + '" class="w-24 px-2 py-1.5 border rounded text-sm outline-none focus:ring-1 focus:ring-brand-500">' +
        '<input data-field="max_output_tokens" type="number" value="' + (m.max_output_tokens || 4096) + '" placeholder="' + T.maxOutput + '" class="w-20 px-2 py-1.5 border rounded text-sm outline-none focus:ring-1 focus:ring-brand-500">' +
        '<button onclick="this.parentElement.remove()" class="text-red-400 hover:text-red-500 px-1">&times;</button></div>';
    }

    function addEpModelRow() {
      var list = document.getElementById('ep-models-list');
      var div = document.createElement('div');
      div.innerHTML = epModelRow(list.children.length, { name: '', real_model: '', context_window: 128000, max_output_tokens: 4096 });
      list.appendChild(div.firstElementChild);
    }

    function doSaveEndpoint() {
      var name = document.getElementById('ep-name').value.trim();
      var url = document.getElementById('ep-url').value.trim();
      var apikey = document.getElementById('ep-apikey').value;
      var format = document.getElementById('ep-format').value;
      if (!name || !url) { toast(T.nameRequired, 'warning'); return; }
      if (_epFormMode === 'create' && !apikey) { toast('API Key ' + T.nameRequired.toLowerCase(), 'warning'); return; }
      var modelRows = document.getElementById('ep-models-list').children;
      var models = [];
      for (var i = 0; i < modelRows.length; i++) {
        var row = modelRows[i];
        var mName = row.querySelector('[data-field="name"]').value.trim();
        var mReal = row.querySelector('[data-field="real_model"]').value.trim();
        var mCtx = parseInt(row.querySelector('[data-field="context_window"]').value) || 128000;
        var mOut = parseInt(row.querySelector('[data-field="max_output_tokens"]').value) || 4096;
        if (mName && mReal) models.push({ name: mName, real_model: mReal, context_window: mCtx, max_output_tokens: mOut });
      }
      if (models.length === 0) { toast(T.supportedModels, 'warning'); return; }
      var data = { name: name, base_url: url, format: format, supported_models: models };
      if (apikey) data.api_key = apikey;
      var p = _epFormMode === 'edit' ? API.updateEndpoint(_epEditId, data) : API.createEndpoint(data);
      p.then(function() {
        closeModal(); toast(T.operationSuccess, 'success'); loadEndpoints();
      }).catch(function(err) { toast(err.message, 'error'); });
    }

    function deleteEndpointConfirm(epId) {
      confirmDialog(T.deleteConfirm, function() {
        API.deleteEndpoint(epId).then(function() { toast(T.operationSuccess, 'success'); loadEndpoints(); })
        .catch(function(err) { toast(err.message, 'error'); });
      });
    }
  `;
}
