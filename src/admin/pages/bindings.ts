export function bindingsRender(): string {
  return '';
}

export function bindingsScript(): string {
  return `
    function bindingsPage(app, params) {
      var keyId = params.keyId;
      var keys = Store.get('keys') || [];
      var key = keys.find(function(k) { return k.key_id === keyId; });
      var keyName = key ? key.name : keyId;

      app.innerHTML = layoutHtml('bindings',
        '<div class="mb-4">' +
          '<nav class="text-sm text-gray-500"><a href="#keys" class="hover:text-brand-600">' + T.keys + '</a> <span class="mx-1">/</span> <span class="text-gray-800">' + escHtml(keyName) + '</span> <span class="mx-1">/</span> <span class="text-gray-800">' + T.bindings + '</span></nav>' +
        '</div>' +
        '<div class="flex items-center justify-between mb-6">' +
          '<h1 class="text-2xl font-bold">' + T.bindings + '</h1>' +
          '<div class="flex gap-2">' +
            '<button onclick="addBindingRow()" class="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">+ ' + T.addBinding + '</button>' +
            '<button onclick="saveBindings(\\'' + keyId + '\\')" class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700">' + T.saveBindings + '</button>' +
          '</div>' +
        '</div>' +
        '<div id="bindings-content">' + spinnerHtml() + '</div>'
      );
      _bindingKeyId = keyId;
      loadBindings(keyId);
    }

    var _bindingKeyId = '';
    var _bindingRows = [];

    function loadBindings(keyId) {
      Promise.all([API.getBindings(keyId), API.listEndpoints(), API.listModels()]).then(function(results) {
        Store.set('endpoints', results[1]);
        _bindingRows = (results[0].bindings || []).map(function(b) {
          return { model_name: b.model_name, endpoint_id: b.endpoint_id, priority: b.priority, request_types: b.request_types || ['text'] };
        });
        renderBindingsTable(results[1], results[2].data || []);
      }).catch(function(err) { toast(err.message, 'error'); });
    }

    function renderBindingsTable(endpoints, models) {
      var el = document.getElementById('bindings-content');
      if (_bindingRows.length === 0) {
        el.innerHTML = emptyState(T.noData, '+ ' + T.addBinding, 'javascript:addBindingRow()');
        return;
      }
      var epOptions = '<option value="">' + T.select + '...</option>';
      for (var i = 0; i < endpoints.length; i++) {
        epOptions += '<option value="' + endpoints[i].endpoint_id + '">' + escHtml(endpoints[i].name) + ' (' + endpoints[i].format + ')</option>';
      }
      var modelOptions = '<option value="">' + T.select + '...</option>';
      for (var i = 0; i < models.length; i++) {
        modelOptions += '<option value="' + models[i].name + '">' + escHtml(models[i].display_name) + ' (' + models[i].name + ')</option>';
      }
      var html = '<div class="bg-white rounded-xl border border-gray-200 overflow-hidden"><table class="w-full text-sm">' +
        '<thead class="bg-gray-50 border-b"><tr>' +
        '<th class="px-4 py-3 text-left font-medium text-gray-600">' + T.modelName + '</th>' +
        '<th class="px-4 py-3 text-left font-medium text-gray-600">' + T.endpointName + '</th>' +
        '<th class="px-4 py-3 text-left font-medium text-gray-600">' + T.requestTypes + '</th>' +
        '<th class="px-4 py-3 text-left font-medium text-gray-600">' + T.priority + '</th>' +
        '<th class="px-4 py-3 text-right font-medium text-gray-600">' + T.actions + '</th>' +
        '</tr></thead><tbody>';
      for (var i = 0; i < _bindingRows.length; i++) {
        var b = _bindingRows[i];
        var typesHtml = '';
        var allTypes = ['text', 'image', 'audio', 'video', 'file'];
        for (var t = 0; t < allTypes.length; t++) {
          var checked = b.request_types.indexOf(allTypes[t]) >= 0 ? ' checked' : '';
          typesHtml += '<label class="inline-flex items-center gap-1 mr-2"><input type="checkbox" data-bidx="' + i + '" data-type="' + allTypes[t] + '"' + checked + ' onchange="updateBindingType(' + i + ',\\'' + allTypes[t] + '\\',this.checked)" class="rounded text-brand-600"><span class="text-xs">' + T[allTypes[t]] + '</span></label>';
        }
        html += '<tr class="border-b">' +
          '<td class="px-4 py-3"><select data-bidx="' + i + '" data-field="model_name" onchange="updateBindingField(' + i + ',\\'model_name\\',this.value)" class="border rounded px-2 py-1 text-sm">' + modelOptions + '</select></td>' +
          '<td class="px-4 py-3"><select data-bidx="' + i + '" data-field="endpoint_id" onchange="updateBindingField(' + i + ',\\'endpoint_id\\',this.value)" class="border rounded px-2 py-1 text-sm">' + epOptions + '</select></td>' +
          '<td class="px-4 py-3">' + typesHtml + '</td>' +
          '<td class="px-4 py-3"><input type="number" value="' + b.priority + '" onchange="updateBindingField(' + i + ',\\'priority\\',parseInt(this.value)||0)" class="w-16 border rounded px-2 py-1 text-sm"></td>' +
          '<td class="px-4 py-3 text-right"><button onclick="removeBindingRow(' + i + ')" class="text-red-500 hover:text-red-600 text-xs">' + T.delete + '</button></td>' +
        '</tr>';
      }
      html += '</tbody></table></div>';
      el.innerHTML = html;
      // Set selected values for dropdowns
      for (var i = 0; i < _bindingRows.length; i++) {
        var modelSel = document.querySelector('select[data-bidx="' + i + '"][data-field="model_name"]');
        var epSel = document.querySelector('select[data-bidx="' + i + '"][data-field="endpoint_id"]');
        if (modelSel) modelSel.value = _bindingRows[i].model_name;
        if (epSel) epSel.value = _bindingRows[i].endpoint_id;
      }
    }

    function addBindingRow() {
      _bindingRows.push({ model_name: '', endpoint_id: '', priority: 0, request_types: ['text'] });
      var eps = Store.get('endpoints') || [];
      var models = Store.get('models') || [];
      // fetch models if not cached
      if (models.length === 0) {
        API.listModels().then(function(d) { Store.set('models', d.data || []); renderBindingsTable(eps, d.data || []); });
      } else {
        renderBindingsTable(eps, models);
      }
    }

    function removeBindingRow(idx) {
      _bindingRows.splice(idx, 1);
      var eps = Store.get('endpoints') || [];
      var models = Store.get('models') || [];
      renderBindingsTable(eps, models);
    }

    function updateBindingField(idx, field, value) {
      _bindingRows[idx][field] = value;
    }

    function updateBindingType(idx, type, checked) {
      var types = _bindingRows[idx].request_types;
      if (checked && types.indexOf(type) < 0) types.push(type);
      if (!checked) _bindingRows[idx].request_types = types.filter(function(t) { return t !== type; });
    }

    function saveBindings(keyId) {
      var valid = _bindingRows.filter(function(b) { return b.model_name && b.endpoint_id; });
      if (valid.length === 0 && _bindingRows.length > 0) {
        toast('请至少填写模型名称和端点', 'warning'); return;
      }
      API.setBindings(keyId, valid).then(function() {
        toast(T.operationSuccess, 'success');
      }).catch(function(err) { toast(err.message, 'error'); });
    }
  `;
}
