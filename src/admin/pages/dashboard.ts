export function dashboardRender(): string {
  return '';
}

export function dashboardScript(): string {
  return `
    function dashboardPage(app, params) {
      app.innerHTML = layoutHtml('dashboard',
        '<h1 class="text-2xl font-bold mb-6">' + T.dashboard + '</h1>' +
        '<div id="dash-cards" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">' + spinnerHtml() + '</div>' +
        '<div class="grid grid-cols-1 md:grid-cols-3 gap-4">' +
          '<a href="#keys" class="block p-6 bg-white rounded-xl border border-gray-200 hover:border-brand-300 hover:shadow-md transition-all">' +
            '<h3 class="font-semibold text-gray-800 mb-1">+ ' + T.createKey + '</h3>' +
            '<p class="text-sm text-gray-500">创建新的 API 密钥</p></a>' +
          '<a href="#endpoints" class="block p-6 bg-white rounded-xl border border-gray-200 hover:border-brand-300 hover:shadow-md transition-all">' +
            '<h3 class="font-semibold text-gray-800 mb-1">+ ' + T.addEndpoint + '</h3>' +
            '<p class="text-sm text-gray-500">配置上游 LLM 端点</p></a>' +
          '<a href="#stats" class="block p-6 bg-white rounded-xl border border-gray-200 hover:border-brand-300 hover:shadow-md transition-all">' +
            '<h3 class="font-semibold text-gray-800 mb-1">' + T.stats + '</h3>' +
            '<p class="text-sm text-gray-500">查看使用统计数据</p></a>' +
        '</div>'
      );
      loadDashboard();
    }

    function loadDashboard() {
      Promise.all([API.getStats(), API.listKeys(), API.listEndpoints()]).then(function(results) {
        Store.set('stats', results[0]);
        Store.set('keys', results[1]);
        Store.set('endpoints', results[2]);
        renderDashCards(results[0], results[1], results[2]);
      }).catch(function(err) { toast(err.message, 'error'); });
    }

    function renderDashCards(stats, keys, endpoints) {
      var activeKeys = keys.filter(function(k) { return k.is_active; }).length;
      var cards = [
        { label: T.totalRequests, value: (stats.total_requests || 0).toLocaleString(), icon: '📊', color: 'bg-blue-50 text-blue-600' },
        { label: T.totalTokens, value: (stats.total_tokens || 0).toLocaleString(), icon: '🔤', color: 'bg-purple-50 text-purple-600' },
        { label: T.avgResponseTime, value: (stats.avg_response_time_ms || 0) + ' ' + T.ms, icon: '⚡', color: 'bg-yellow-50 text-yellow-600' },
        { label: T.activeKeys, value: activeKeys + ' / ' + keys.length, icon: '🔑', color: 'bg-green-50 text-green-600' },
      ];
      var html = '';
      for (var i = 0; i < cards.length; i++) {
        var c = cards[i];
        html += '<div class="bg-white rounded-xl border border-gray-200 p-5"><div class="flex items-center gap-3">' +
          '<div class="w-10 h-10 rounded-lg ' + c.color + ' flex items-center justify-center text-lg">' + c.icon + '</div>' +
          '<div><p class="text-sm text-gray-500">' + c.label + '</p><p class="text-xl font-bold">' + c.value + '</p></div></div></div>';
      }
      document.getElementById('dash-cards').innerHTML = html;
    }
  `;
}
