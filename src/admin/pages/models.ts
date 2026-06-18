export function modelsRender(): string {
  return '';
}

export function modelsScript(): string {
  return `
    function modelsPage(app, params) {
      app.innerHTML = layoutHtml('models',
        '<h1 class="text-2xl font-bold mb-6">' + T.models + '</h1>' +
        '<div id="models-content">' + spinnerHtml() + '</div>'
      );
      loadModels();
    }

    function loadModels() {
      API.listModels().then(function(data) {
        var models = data.data || [];
        Store.set('models', models);
        renderModels(models);
      }).catch(function(err) { toast(err.message, 'error'); });
    }

    function renderModels(models) {
      var el = document.getElementById('models-content');
      if (!models || models.length === 0) {
        el.innerHTML = emptyState(T.noData);
        return;
      }
      var html = '<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">';
      for (var i = 0; i < models.length; i++) {
        var m = models[i];
        var capBadges = '';
        var capMap = { text: T.text, image: T.image, audio: T.audio, video: T.video, file: T.file };
        var capColors = { text: 'bg-blue-100 text-blue-700', image: 'bg-green-100 text-green-700', audio: 'bg-purple-100 text-purple-700', video: 'bg-red-100 text-red-700', file: 'bg-yellow-100 text-yellow-700' };
        for (var cap in m.capabilities) {
          if (m.capabilities[cap]) {
            capBadges += '<span class="inline-block px-2 py-0.5 rounded-full text-xs font-medium mr-1 mb-1 ' + (capColors[cap] || 'bg-gray-100 text-gray-700') + '">' + capMap[cap] + '</span>';
          }
        }
        html += '<div class="bg-white rounded-xl border border-gray-200 p-5">' +
          '<div class="flex items-start justify-between mb-2">' +
            '<div><h3 class="font-semibold text-gray-800">' + escHtml(m.display_name) + '</h3>' +
            '<p class="text-xs font-mono text-gray-500 mt-0.5">' + escHtml(m.name) + '</p></div>' +
            formatBadge(m.default_format) +
          '</div>' +
          '<p class="text-sm text-gray-600 mb-3">' + escHtml(m.description) + '</p>' +
          '<div class="mb-3">' + capBadges + '</div>' +
          '<div class="flex gap-4 text-xs text-gray-500">' +
            '<span>' + T.contextWindow + ': ' + (m.context_window / 1000) + 'K</span>' +
            '<span>' + T.maxOutput + ': ' + (m.max_output_tokens / 1000) + 'K</span>' +
          '</div>' +
        '</div>';
      }
      html += '</div>';
      el.innerHTML = html;
    }
  `;
}
