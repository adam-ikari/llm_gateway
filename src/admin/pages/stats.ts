export function statsRender(): string {
  return '';
}

export function statsScript(): string {
  return `
    function statsPage(app, params) {
      var today = new Date().toISOString().slice(0, 10);
      app.innerHTML = layoutHtml('stats',
        '<div class="flex items-center justify-between mb-6">' +
          '<h1 class="text-2xl font-bold">' + T.stats + '</h1>' +
          '<div class="flex items-center gap-2">' +
            '<label class="text-sm text-gray-600">' + T.date + ':</label>' +
            '<input id="stats-date" type="date" value="' + today + '" onchange="loadStats()" class="border rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand-500">' +
          '</div>' +
        '</div>' +
        '<div id="stats-content">' + spinnerHtml() + '</div>'
      );
      loadStats();
    }

    function loadStats() {
      var dateEl = document.getElementById('stats-date');
      var date = dateEl ? dateEl.value : '';
      API.getStats(date).then(function(stats) {
        Store.set('stats', stats);
        renderStats(stats);
      }).catch(function(err) { toast(err.message, 'error'); });
    }

    function renderStats(stats) {
      var el = document.getElementById('stats-content');
      var overviewCards = '<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">' +
        statCard(T.totalRequests, (stats.total_requests || 0).toLocaleString(), '📊', 'bg-blue-50 text-blue-600') +
        statCard(T.totalTokens, (stats.total_tokens || 0).toLocaleString(), '🔤', 'bg-purple-50 text-purple-600') +
        statCard(T.avgResponseTime, (stats.avg_response_time_ms || 0) + ' ' + T.ms, '⚡', 'bg-yellow-50 text-yellow-600') +
        statCard(T.status, Object.keys(stats.status_codes || {}).length + ' ' + T.unit, '📈', 'bg-green-50 text-green-600') +
      '</div>';

      var statusHtml = '<div class="bg-white rounded-xl border border-gray-200 p-5 mb-8"><h3 class="font-semibold text-gray-800 mb-4">' + T.status + '</h3>';
      var codes = stats.status_codes || {};
      var maxCount = 0;
      var codeKeys = Object.keys(codes);
      for (var i = 0; i < codeKeys.length; i++) { if (codes[codeKeys[i]] > maxCount) maxCount = codes[codeKeys[i]]; }
      if (codeKeys.length > 0) {
        statusHtml += '<div class="space-y-2">';
        for (var i = 0; i < codeKeys.length; i++) {
          var code = codeKeys[i];
          var count = codes[code];
          var pct = maxCount > 0 ? Math.round(count / maxCount * 100) : 0;
          var color = code.startsWith('2') ? 'bg-green-500' : code.startsWith('4') ? 'bg-yellow-500' : 'bg-red-500';
          statusHtml += '<div class="flex items-center gap-3"><span class="text-sm font-mono w-12">' + code + '</span>' +
            '<div class="flex-1 bg-gray-100 rounded-full h-6 overflow-hidden"><div class="bar-chart-bar ' + color + '" style="width:' + pct + '%"></div></div>' +
            '<span class="text-sm text-gray-600 w-16 text-right">' + count + '</span></div>';
        }
        statusHtml += '</div>';
      } else {
        statusHtml += '<p class="text-sm text-gray-400">' + T.noData + '</p>';
      }
      statusHtml += '</div>';

      var byKeyHtml = renderEntityTable(T.byKey, stats.by_key, 'key');
      var byModelHtml = renderEntityTable(T.byModel, stats.by_model, 'model');

      el.innerHTML = overviewCards + statusHtml + byKeyHtml + byModelHtml;
    }

    function statCard(label, value, icon, color) {
      return '<div class="bg-white rounded-xl border border-gray-200 p-5"><div class="flex items-center gap-3">' +
        '<div class="w-10 h-10 rounded-lg ' + color + ' flex items-center justify-center text-lg">' + icon + '</div>' +
        '<div><p class="text-sm text-gray-500">' + label + '</p><p class="text-xl font-bold">' + value + '</p></div></div></div>';
    }

    function renderEntityTable(title, data, type) {
      var html = '<div class="bg-white rounded-xl border border-gray-200 p-5 mb-8"><h3 class="font-semibold text-gray-800 mb-4">' + title + '</h3>';
      var keys = Object.keys(data || {});
      if (keys.length === 0) {
        html += '<p class="text-sm text-gray-400">' + T.noData + '</p></div>';
        return html;
      }
      html += '<div class="overflow-x-auto"><table class="w-full text-sm"><thead class="border-b"><tr>' +
        '<th class="px-3 py-2 text-left text-gray-600 font-medium">' + (type === 'key' ? T.keyPrefix : T.modelName) + '</th>' +
        '<th class="px-3 py-2 text-right text-gray-600 font-medium">' + T.totalRequests + '</th>' +
        '<th class="px-3 py-2 text-right text-gray-600 font-medium">' + T.totalTokens + '</th>' +
        '<th class="px-3 py-2 text-right text-gray-600 font-medium">' + T.avgResponseTime + '</th>' +
        '</tr></thead><tbody>';
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var d = data[k];
        html += '<tr class="border-b last:border-0">' +
          '<td class="px-3 py-2 font-mono text-xs">' + escHtml(k) + '</td>' +
          '<td class="px-3 py-2 text-right">' + (d.requests || 0).toLocaleString() + '</td>' +
          '<td class="px-3 py-2 text-right">' + (d.tokens || 0).toLocaleString() + '</td>' +
          '<td class="px-3 py-2 text-right">' + (d.avg_response_time_ms || 0) + ' ' + T.ms + '</td>' +
        '</tr>';
      }
      html += '</tbody></table></div></div>';
      return html;
    }
  `;
}
