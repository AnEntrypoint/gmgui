(function() {
  var activeDialogs = [];
  var dialogZIndex = 10000;

  function escapeHtml(text) {
    var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(text).replace(/[&<>"']/g, function(c) { return map[c]; });
  }

  function createOverlay() {
    var overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = '<div class="dialog-backdrop"></div>';
    return overlay;
  }

  function showDialog(dialog, overlay) {
    dialogZIndex++;
    if (overlay) {
      overlay.style.zIndex = dialogZIndex;
      document.body.appendChild(overlay);
    }
    dialog.style.zIndex = dialogZIndex + 1;
    document.body.appendChild(dialog);
    activeDialogs.push({ dialog: dialog, overlay: overlay });

    requestAnimationFrame(function() {
      dialog.classList.add('visible');
      if (overlay) overlay.classList.add('visible');
      var input = dialog.querySelector('input, textarea');
      if (input) input.focus();
      else {
        var btn = dialog.querySelector('.dialog-btn-primary');
        if (btn) btn.focus();
      }
    });
  }

  function closeDialog(dialog, overlay) {
    dialog.classList.remove('visible');
    if (overlay) overlay.classList.remove('visible');
    setTimeout(function() {
      if (dialog.parentNode) dialog.remove();
      if (overlay && overlay.parentNode) overlay.remove();
    }, 200);
    activeDialogs = activeDialogs.filter(function(d) {
      return d.dialog !== dialog;
    });
  }

  function closeAllDialogs() {
    activeDialogs.forEach(function(d) {
      closeDialog(d.dialog, d.overlay);
    });
  }

  window.UIDialog = {
    alert: function(message, title) {
      return new Promise(function(resolve) {
        var overlay = createOverlay();
        var dialog = document.createElement('div');
        dialog.className = 'dialog-container';
        dialog.innerHTML = 
          '<div class="dialog-box">' +
            '<div class="dialog-header">' +
              '<h3 class="dialog-title">' + escapeHtml(title || 'Alert') + '</h3>' +
            '</div>' +
            '<div class="dialog-body">' +
              '<p class="dialog-message">' + escapeHtml(message) + '</p>' +
            '</div>' +
            '<div class="dialog-footer">' +
              '<button class="dialog-btn dialog-btn-primary" data-action="ok">OK</button>' +
            '</div>' +
          '</div>';
        
        var okBtn = dialog.querySelector('[data-action="ok"]');
        okBtn.addEventListener('click', function() {
          closeDialog(dialog, overlay);
          resolve(true);
        });
        
        overlay.querySelector('.dialog-backdrop').addEventListener('click', function() {
          closeDialog(dialog, overlay);
          resolve(true);
        });
        
        document.addEventListener('keydown', function handler(e) {
          if (e.key === 'Escape' || e.key === 'Enter') {
            document.removeEventListener('keydown', handler);
            closeDialog(dialog, overlay);
            resolve(true);
          }
        });
        
        showDialog(dialog, overlay);
      });
    },

    confirm: function(message, title) {
      return new Promise(function(resolve) {
        var overlay = createOverlay();
        var dialog = document.createElement('div');
        dialog.className = 'dialog-container';
        dialog.innerHTML = 
          '<div class="dialog-box">' +
            '<div class="dialog-header">' +
              '<h3 class="dialog-title">' + escapeHtml(title || 'Confirm') + '</h3>' +
            '</div>' +
            '<div class="dialog-body">' +
              '<p class="dialog-message">' + escapeHtml(message).replace(/\n/g, '<br>') + '</p>' +
            '</div>' +
            '<div class="dialog-footer">' +
              '<button class="dialog-btn dialog-btn-secondary" data-action="cancel">Cancel</button>' +
              '<button class="dialog-btn dialog-btn-primary dialog-btn-danger" data-action="confirm">Confirm</button>' +
            '</div>' +
          '</div>';
        
        var cancelBtn = dialog.querySelector('[data-action="cancel"]');
        var confirmBtn = dialog.querySelector('[data-action="confirm"]');
        
        cancelBtn.addEventListener('click', function() {
          closeDialog(dialog, overlay);
          resolve(false);
        });
        
        confirmBtn.addEventListener('click', function() {
          closeDialog(dialog, overlay);
          resolve(true);
        });
        
        overlay.querySelector('.dialog-backdrop').addEventListener('click', function() {
          closeDialog(dialog, overlay);
          resolve(false);
        });
        
        document.addEventListener('keydown', function handler(e) {
          if (e.key === 'Escape') {
            document.removeEventListener('keydown', handler);
            closeDialog(dialog, overlay);
            resolve(false);
          } else if (e.key === 'Enter') {
            document.removeEventListener('keydown', handler);
            closeDialog(dialog, overlay);
            resolve(true);
          }
        });
        
        showDialog(dialog, overlay);
      });
    },

    prompt: function(message, defaultValue, title) {
      return new Promise(function(resolve) {
        var overlay = createOverlay();
        var dialog = document.createElement('div');
        dialog.className = 'dialog-container';
        dialog.innerHTML = 
          '<div class="dialog-box">' +
            '<div class="dialog-header">' +
              '<h3 class="dialog-title">' + escapeHtml(title || 'Input') + '</h3>' +
            '</div>' +
            '<div class="dialog-body">' +
              '<label class="dialog-label">' + escapeHtml(message) + '</label>' +
              '<input type="text" class="dialog-input" value="' + escapeHtml(defaultValue || '') + '">' +
            '</div>' +
            '<div class="dialog-footer">' +
              '<button class="dialog-btn dialog-btn-secondary" data-action="cancel">Cancel</button>' +
              '<button class="dialog-btn dialog-btn-primary" data-action="ok">OK</button>' +
            '</div>' +
          '</div>';
        
        var input = dialog.querySelector('.dialog-input');
        var cancelBtn = dialog.querySelector('[data-action="cancel"]');
        var okBtn = dialog.querySelector('[data-action="ok"]');
        
        cancelBtn.addEventListener('click', function() {
          closeDialog(dialog, overlay);
          resolve(null);
        });
        
        okBtn.addEventListener('click', function() {
          closeDialog(dialog, overlay);
          resolve(input.value);
        });
        
        input.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') {
            closeDialog(dialog, overlay);
            resolve(input.value);
          }
        });
        
        overlay.querySelector('.dialog-backdrop').addEventListener('click', function() {
          closeDialog(dialog, overlay);
          resolve(null);
        });
        
        document.addEventListener('keydown', function handler(e) {
          if (e.key === 'Escape') {
            document.removeEventListener('keydown', handler);
            closeDialog(dialog, overlay);
            resolve(null);
          }
        });
        
        showDialog(dialog, overlay);
      });
    },

    showProgress: function(config) {
      var overlay = createOverlay();
      var dialog = document.createElement('div');
      dialog.className = 'dialog-container';
      dialog.innerHTML = 
        '<div class="dialog-box dialog-box-progress">' +
          '<div class="dialog-header">' +
            '<h3 class="dialog-title">' + escapeHtml(config.title || 'Please wait') + '</h3>' +
          '</div>' +
          '<div class="dialog-body">' +
            '<p class="dialog-message progress-message">' + escapeHtml(config.message || 'Loading...') + '</p>' +
            '<div class="dialog-progress-bar">' +
              '<div class="dialog-progress-fill" style="width: 0%"></div>' +
            '</div>' +
            '<p class="dialog-progress-percent">0%</p>' +
          '</div>' +
        '</div>';
      
      showDialog(dialog, overlay);
      
      var progressFill = dialog.querySelector('.dialog-progress-fill');
      var progressPercent = dialog.querySelector('.dialog-progress-percent');
      var progressMessage = dialog.querySelector('.progress-message');
      
      return {
        update: function(percent, message) {
          progressFill.style.width = percent + '%';
          progressPercent.textContent = Math.round(percent) + '%';
          if (message) progressMessage.textContent = message;
        },
        close: function() {
          closeDialog(dialog, overlay);
        }
      };
    },

    showToast: function(message, type, duration) {
      var existing = document.querySelector('.toast-notification');
      if (existing) existing.remove();
      
      var toast = document.createElement('div');
      toast.className = 'toast-notification toast-' + (type || 'info');
      toast.innerHTML = '<span class="toast-message">' + escapeHtml(message) + '</span>';
      document.body.appendChild(toast);
      
      requestAnimationFrame(function() {
        toast.classList.add('visible');
      });
      
      setTimeout(function() {
        toast.classList.remove('visible');
        setTimeout(function() { if (toast.parentNode) toast.remove(); }, 300);
      }, duration || 3000);
    },

    closeAll: closeAllDialogs
  };
})();
