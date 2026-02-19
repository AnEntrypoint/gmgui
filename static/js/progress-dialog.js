/**
 * Progress Dialog
 * Modal dialog for displaying download/upload progress
 */

class ProgressDialog {
  constructor(config = {}) {
    this.title = config.title || 'Progress';
    this.message = config.message || 'Processing...';
    this.percentage = config.percentage || 0;
    this.cancellable = config.cancellable || false;
    this.onCancel = config.onCancel || null;
    this.overlay = null;
    this.progressBar = null;
    this.progressText = null;
    this.messageEl = null;
    this._create();
  }

  _create() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'folder-modal-overlay visible';
    this.overlay.style.zIndex = '3000';

    const modal = document.createElement('div');
    modal.className = 'folder-modal';
    modal.style.width = '400px';

    const header = document.createElement('div');
    header.className = 'folder-modal-header';
    header.innerHTML = `
      <h3>${this._escapeHtml(this.title)}</h3>
      ${this.cancellable ? '<button class="folder-modal-close" aria-label="Cancel">&times;</button>' : ''}
    `;

    const body = document.createElement('div');
    body.style.padding = '1.5rem 1rem';

    this.messageEl = document.createElement('div');
    this.messageEl.style.marginBottom = '1rem';
    this.messageEl.style.fontSize = '0.875rem';
    this.messageEl.style.color = 'var(--color-text-primary)';
    this.messageEl.textContent = this.message;

    const progressContainer = document.createElement('div');
    progressContainer.style.marginBottom = '0.5rem';

    this.progressBar = document.createElement('div');
    this.progressBar.style.width = '100%';
    this.progressBar.style.height = '8px';
    this.progressBar.style.backgroundColor = 'var(--color-bg-secondary)';
    this.progressBar.style.borderRadius = '4px';
    this.progressBar.style.overflow = 'hidden';

    const progressFill = document.createElement('div');
    progressFill.className = 'progress-fill';
    progressFill.style.height = '100%';
    progressFill.style.backgroundColor = 'var(--color-primary)';
    progressFill.style.width = this.percentage + '%';
    progressFill.style.transition = 'width 0.3s ease';

    this.progressBar.appendChild(progressFill);
    progressContainer.appendChild(this.progressBar);

    this.progressText = document.createElement('div');
    this.progressText.style.fontSize = '0.75rem';
    this.progressText.style.color = 'var(--color-text-secondary)';
    this.progressText.style.textAlign = 'right';
    this.progressText.style.marginTop = '0.25rem';
    this.progressText.textContent = Math.round(this.percentage) + '%';

    body.appendChild(this.messageEl);
    body.appendChild(progressContainer);
    body.appendChild(this.progressText);

    modal.appendChild(header);
    modal.appendChild(body);
    this.overlay.appendChild(modal);

    if (this.cancellable) {
      const closeBtn = header.querySelector('.folder-modal-close');
      closeBtn.addEventListener('click', () => this._handleCancel());
    }

    document.body.appendChild(this.overlay);
  }

  update(percentage, message) {
    if (message !== undefined) {
      this.message = message;
      if (this.messageEl) {
        this.messageEl.textContent = message;
      }
    }

    if (percentage !== undefined) {
      this.percentage = Math.min(100, Math.max(0, percentage));
      const fill = this.progressBar?.querySelector('.progress-fill');
      if (fill) {
        fill.style.width = this.percentage + '%';
      }
      if (this.progressText) {
        this.progressText.textContent = Math.round(this.percentage) + '%';
      }
    }
  }

  close() {
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.remove();
    }
  }

  _handleCancel() {
    if (this.onCancel) {
      this.onCancel();
    }
    this.close();
  }

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ProgressDialog;
}
