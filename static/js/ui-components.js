/**
 * UI Components
 * Reusable UI building blocks for modals, tabs, buttons, and more
 */

class UIComponents {
  /**
   * Create a modal dialog
   */
  static createModal(config = {}) {
    const {
      title = 'Dialog',
      content = '',
      buttons = [],
      onClose = null,
      size = 'medium' // small, medium, large
    } = config;

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.dataset.modal = 'true';

    const sizeClasses = {
      'small': 'max-w-sm',
      'medium': 'max-w-md',
      'large': 'max-w-2xl'
    };

    modal.innerHTML = `
      <div class="modal-content ${sizeClasses[size] || sizeClasses['medium']} bg-white dark:bg-gray-900 rounded-lg shadow-lg p-6">
        <div class="modal-header flex justify-between items-center mb-4 pb-4 border-b">
          <h2 class="text-xl font-bold">${UIComponents.escapeHtml(title)}</h2>
          <button class="modal-close text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300 text-2xl leading-none">&times;</button>
        </div>
        <div class="modal-body mb-4">
          ${typeof content === 'string' ? UIComponents.escapeHtml(content) : ''}
        </div>
        <div class="modal-footer flex gap-2 justify-end">
          ${buttons.map(btn => `
            <button class="btn btn-${btn.variant || 'secondary'}" data-action="${btn.action || 'close'}">
              ${UIComponents.escapeHtml(btn.label)}
            </button>
          `).join('')}
        </div>
      </div>
    `;

    // Add close handler
    const closeBtn = modal.querySelector('.modal-close');
    closeBtn.addEventListener('click', () => {
      modal.remove();
      if (onClose) onClose();
    });

    // Add button handlers
    modal.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        if (action === 'close') {
          modal.remove();
          if (onClose) onClose();
        }
      });
    });

    // Close on background click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
        if (onClose) onClose();
      }
    });

    return modal;
  }

  /**
   * Create a tabbed interface
   */
  static createTabs(config = {}) {
    const {
      tabs = [],
      activeTab = 0,
      onChange = null
    } = config;

    const container = document.createElement('div');
    container.className = 'tabs';

    // Tab buttons
    const tabButtons = document.createElement('div');
    tabButtons.className = 'tab-buttons flex border-b';

    tabs.forEach((tab, index) => {
      const btn = document.createElement('button');
      btn.className = `tab-button px-4 py-2 font-medium transition-colors ${
        index === activeTab
          ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400'
          : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
      }`;
      btn.textContent = tab.label;
      btn.dataset.tabIndex = index;

      btn.addEventListener('click', () => {
        // Update active button
        tabButtons.querySelectorAll('.tab-button').forEach((b, i) => {
          if (i === index) {
            b.classList.add('border-b-2', 'border-blue-500', 'text-blue-600', 'dark:text-blue-400');
            b.classList.remove('text-gray-600', 'dark:text-gray-400');
          } else {
            b.classList.remove('border-b-2', 'border-blue-500', 'text-blue-600', 'dark:text-blue-400');
            b.classList.add('text-gray-600', 'dark:text-gray-400');
          }
        });

        // Update tab content
        tabContent.querySelectorAll('.tab-pane').forEach((pane, i) => {
          pane.style.display = i === index ? 'block' : 'none';
        });

        if (onChange) onChange(index);
      });

      tabButtons.appendChild(btn);
    });

    container.appendChild(tabButtons);

    // Tab content
    const tabContent = document.createElement('div');
    tabContent.className = 'tab-content mt-4';

    tabs.forEach((tab, index) => {
      const pane = document.createElement('div');
      pane.className = 'tab-pane';
      pane.style.display = index === activeTab ? 'block' : 'none';
      pane.innerHTML = typeof tab.content === 'string' ? tab.content : '';
      tabContent.appendChild(pane);
    });

    container.appendChild(tabContent);
    return container;
  }

  /**
   * Create an alert/notification
   */
  static createAlert(config = {}) {
    const {
      message = '',
      type = 'info', // info, success, warning, error
      duration = 5000,
      dismissible = true
    } = config;

    const alert = document.createElement('div');
    const typeClasses = {
      'info': 'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-900 dark:border-blue-700 dark:text-blue-200',
      'success': 'bg-green-50 border-green-200 text-green-800 dark:bg-green-900 dark:border-green-700 dark:text-green-200',
      'warning': 'bg-yellow-50 border-yellow-200 text-yellow-800 dark:bg-yellow-900 dark:border-yellow-700 dark:text-yellow-200',
      'error': 'bg-red-50 border-red-200 text-red-800 dark:bg-red-900 dark:border-red-700 dark:text-red-200'
    };

    alert.className = `alert border-l-4 p-4 mb-4 rounded ${typeClasses[type] || typeClasses['info']}`;
    alert.innerHTML = `
      <div class="flex justify-between items-center">
        <span>${UIComponents.escapeHtml(message)}</span>
        ${dismissible ? '<button class="text-current hover:opacity-75">&times;</button>' : ''}
      </div>
    `;

    if (dismissible) {
      const closeBtn = alert.querySelector('button');
      closeBtn.addEventListener('click', () => alert.remove());
    }

    if (duration > 0) {
      setTimeout(() => alert.remove(), duration);
    }

    return alert;
  }

  /**
   * Create a loading spinner
   */
  static createSpinner(config = {}) {
    const {
      size = 'medium', // small, medium, large
      text = 'Loading...'
    } = config;

    const sizeClasses = {
      'small': 'w-4 h-4',
      'medium': 'w-8 h-8',
      'large': 'w-12 h-12'
    };

    const container = document.createElement('div');
    container.className = 'flex items-center gap-3 justify-center p-4';
    container.innerHTML = `
      <svg class="animate-spin ${sizeClasses[size] || sizeClasses['medium']} text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" opacity="0.25"></circle>
        <path d="M4 12a8 8 0 018-8" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
      </svg>
      <span class="text-gray-700 dark:text-gray-300">${UIComponents.escapeHtml(text)}</span>
    `;
    return container;
  }

  /**
   * Create a progress bar
   */
  static createProgressBar(config = {}) {
    const {
      percentage = 0,
      label = '',
      showLabel = true
    } = config;

    const container = document.createElement('div');
    container.className = 'progress-container';

    let html = '';
    if (label && showLabel) {
      html += `<div class="flex justify-between mb-2 text-sm"><span>${UIComponents.escapeHtml(label)}</span><span>${Math.round(percentage)}%</span></div>`;
    }

    html += `
      <div class="progress-bar bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
        <div class="progress-fill bg-blue-500 h-full transition-all" style="width: ${Math.min(100, Math.max(0, percentage))}%"></div>
      </div>
    `;

    container.innerHTML = html;
    return container;
  }

  /**
   * Create a collapsible section
   */
  static createCollapsible(config = {}) {
    const {
      title = 'Details',
      content = '',
      isOpen = false
    } = config;

    const container = document.createElement('div');
    container.className = 'collapsible';

    container.innerHTML = `
      <details ${isOpen ? 'open' : ''}>
        <summary class="cursor-pointer font-semibold hover:bg-gray-100 dark:hover:bg-gray-800 px-2 py-1 rounded transition-colors">
          ${UIComponents.escapeHtml(title)}
        </summary>
        <div class="content mt-2 ml-4">
          ${typeof content === 'string' ? content : ''}
        </div>
      </details>
    `;

    return container;
  }

  /**
   * Create a form input
   */
  static createInput(config = {}) {
    const {
      type = 'text',
      name = '',
      label = '',
      placeholder = '',
      value = '',
      required = false
    } = config;

    const container = document.createElement('div');
    container.className = 'form-group mb-4';

    let html = '';
    if (label) {
      html += `<label class="block text-sm font-medium mb-2">${UIComponents.escapeHtml(label)}</label>`;
    }

    html += `
      <input
        type="${type}"
        name="${name}"
        placeholder="${UIComponents.escapeHtml(placeholder)}"
        value="${UIComponents.escapeHtml(value)}"
        ${required ? 'required' : ''}
        class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    `;

    container.innerHTML = html;
    return container;
  }

  /**
   * Create a select dropdown
   */
  static createSelect(config = {}) {
    const {
      name = '',
      label = '',
      options = [],
      value = '',
      required = false
    } = config;

    const container = document.createElement('div');
    container.className = 'form-group mb-4';

    let html = '';
    if (label) {
      html += `<label class="block text-sm font-medium mb-2">${UIComponents.escapeHtml(label)}</label>`;
    }

    html += `
      <select
        name="${name}"
        ${required ? 'required' : ''}
        class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        ${options.map(opt => `
          <option value="${opt.value}" ${opt.value === value ? 'selected' : ''}>
            ${UIComponents.escapeHtml(opt.label)}
          </option>
        `).join('')}
      </select>
    `;

    container.innerHTML = html;
    return container;
  }

  /**
   * Create a button group
   */
  static createButtonGroup(config = {}) {
    const {
      buttons = [],
      vertical = false
    } = config;

    const container = document.createElement('div');
    container.className = `button-group flex gap-2 ${vertical ? 'flex-col' : 'flex-row'}`;

    buttons.forEach(btn => {
      const button = document.createElement('button');
      button.className = `btn btn-${btn.variant || 'secondary'} flex-${vertical ? '1' : 'none'}`;
      button.textContent = btn.label;
      if (btn.onClick) {
        button.addEventListener('click', btn.onClick);
      }
      container.appendChild(button);
    });

    return container;
  }

  /**
   * Create a badge/tag
   */
  static createBadge(config = {}) {
    const {
      label = '',
      variant = 'default', // default, primary, success, warning, error
      size = 'medium' // small, medium, large
    } = config;

    const sizeClasses = {
      'small': 'text-xs px-2 py-1',
      'medium': 'text-sm px-3 py-1',
      'large': 'text-base px-4 py-2'
    };

    const variantClasses = {
      'default': 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
      'primary': 'bg-blue-200 text-blue-800 dark:bg-blue-700 dark:text-blue-200',
      'success': 'bg-green-200 text-green-800 dark:bg-green-700 dark:text-green-200',
      'warning': 'bg-yellow-200 text-yellow-800 dark:bg-yellow-700 dark:text-yellow-200',
      'error': 'bg-red-200 text-red-800 dark:bg-red-700 dark:text-red-200'
    };

    const badge = document.createElement('span');
    badge.className = `badge rounded-full font-medium ${sizeClasses[size] || sizeClasses['medium']} ${variantClasses[variant] || variantClasses['default']}`;
    badge.textContent = label;
    return badge;
  }

  /**
   * HTML escape utility
   */
  static escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Copy text to clipboard
   */
  static copyToClipboard(text) {
    return navigator.clipboard.writeText(text).catch(err => {
      console.error('Failed to copy:', err);
      return false;
    });
  }

  /**
   * Download data as file
   */
  static downloadFile(data, filename, mimeType = 'text/plain') {
    const blob = new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}

// Export for use in browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = UIComponents;
}
