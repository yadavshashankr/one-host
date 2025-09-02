// Notification Service
import { dom } from '../utils/dom.js';
import { UI_CONFIG } from '../config/constants.js';

class NotificationService {
    constructor() {
        this.notifications = [];
        this.isInitialized = false;
    }

    // Initialize notification system
    init() {
        if (this.isInitialized) return;
        
        // Add CSS styles for notifications
        this.addNotificationStyles();
        this.isInitialized = true;
    }

    // Add notification styles
    addNotificationStyles() {
        if (document.getElementById('notification-styles')) return;

        const style = document.createElement('style');
        style.id = 'notification-styles';
        style.textContent = `
            .notification {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 12px 16px;
                margin-bottom: 8px;
                border-radius: 8px;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
                animation: slideIn 0.3s ease-out;
                transition: opacity 0.3s ease-out;
                max-width: 400px;
                word-wrap: break-word;
            }
            
            .notification.fade-out {
                opacity: 0;
            }
            
            .notification-icon {
                font-size: 1.2em;
                flex-shrink: 0;
            }
            
            .notification-content {
                flex: 1;
                font-size: 14px;
                line-height: 1.4;
            }
            
            .notification.info {
                background-color: #e0f2fe;
                color: #0369a1;
                border-left: 4px solid #2196F3;
            }
            
            .notification.success {
                background-color: #e8f5e8;
                color: #2e7d32;
                border-left: 4px solid #4CAF50;
            }
            
            .notification.warning {
                background-color: #fff3e0;
                color: #ef6c00;
                border-left: 4px solid #ff9800;
            }
            
            .notification.error {
                background-color: #ffebee;
                color: #c62828;
                border-left: 4px solid #f44336;
            }
            
            @keyframes slideIn {
                from {
                    transform: translateX(100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
            
            .notifications {
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 1000;
                max-width: 400px;
                max-height: 80vh;
                overflow-y: auto;
            }
            
            @media (max-width: 768px) {
                .notifications {
                    top: 10px;
                    right: 10px;
                    left: 10px;
                    max-width: none;
                }
                
                .notification {
                    max-width: none;
                }
            }
        `;
        document.head.appendChild(style);
    }

    // Show notification
    show(message, type = 'info', duration = UI_CONFIG.notificationTimeout) {
        this.init();

        const notification = this.createNotification(message, type);
        this.addNotification(notification);

        // Auto-remove after duration
        if (duration > 0) {
            setTimeout(() => {
                this.removeNotification(notification);
            }, duration);
        }

        return notification;
    }

    // Create notification element
    createNotification(message, type) {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        
        const icon = this.getNotificationIcon(type);
        const content = document.createElement('div');
        content.className = 'notification-content';
        content.textContent = this.capitalizeFirst(message);

        notification.innerHTML = `
            <span class="notification-icon" translate="no">${icon}</span>
            <div class="notification-content">${this.capitalizeFirst(message)}</div>
        `;

        // Add close button for persistent notifications
        if (type === 'error' || type === 'warning') {
            const closeBtn = document.createElement('button');
            closeBtn.innerHTML = '<span translate="no">&times;</span>';
            closeBtn.className = 'notification-close';
            closeBtn.style.cssText = `
                background: none;
                border: none;
                font-size: 18px;
                cursor: pointer;
                color: inherit;
                opacity: 0.7;
                margin-left: 8px;
            `;
            closeBtn.onclick = () => this.removeNotification(notification);
            notification.appendChild(closeBtn);
        }

        return notification;
    }

    // Get notification icon
    getNotificationIcon(type) {
        const icons = {
            info: 'ℹ️',
            success: '✅',
            warning: '⚠️',
            error: '❌'
        };
        return icons[type] || icons.info;
    }

    // Capitalize first letter
    capitalizeFirst(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    // Add notification to DOM
    addNotification(notification) {
        const container = dom.get('notifications');
        if (container) {
            container.appendChild(notification);
            this.notifications.push(notification);
            
            // Limit number of notifications
            if (this.notifications.length > 5) {
                const oldest = this.notifications.shift();
                this.removeNotification(oldest);
            }
        }
    }

    // Remove notification
    removeNotification(notification) {
        if (!notification || !notification.parentNode) return;

        notification.classList.add('fade-out');
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
            const index = this.notifications.indexOf(notification);
            if (index > -1) {
                this.notifications.splice(index, 1);
            }
        }, 300);
    }

    // Clear all notifications
    clearAll() {
        this.notifications.forEach(notification => {
            this.removeNotification(notification);
        });
        this.notifications = [];
    }

    // Show info notification
    info(message, duration) {
        return this.show(message, 'info', duration);
    }

    // Show success notification
    success(message, duration) {
        return this.show(message, 'success', duration);
    }

    // Show warning notification
    warning(message, duration) {
        return this.show(message, 'warning', duration);
    }

    // Show error notification
    error(message, duration) {
        return this.show(message, 'error', duration);
    }

    // Show progress notification
    showProgress(message, progress = 0) {
        const notification = this.createNotification(`${message} ${progress}%`, 'info');
        notification.dataset.progress = progress;
        notification.dataset.message = message;
        this.addNotification(notification);
        return notification;
    }

    // Update progress notification
    updateProgress(notification, progress) {
        if (notification && notification.dataset) {
            const message = notification.dataset.message || '';
            const content = notification.querySelector('.notification-content');
            if (content) {
                content.textContent = `${message} ${Math.floor(progress)}%`;
            }
            notification.dataset.progress = progress;
        }
    }

    // Show toast notification (shorter duration)
    toast(message, type = 'info') {
        return this.show(message, type, 2000);
    }

    // Show persistent notification (no auto-remove)
    persistent(message, type = 'info') {
        return this.show(message, type, 0);
    }

    // Show confirmation dialog
    async confirm(message, title = 'Confirm') {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 2000;
            `;

            const dialog = document.createElement('div');
            dialog.style.cssText = `
                background: white;
                padding: 24px;
                border-radius: 8px;
                max-width: 400px;
                margin: 20px;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
            `;

            dialog.innerHTML = `
                <h3 style="margin: 0 0 16px 0; color: #333;">${title}</h3>
                <p style="margin: 0 0 24px 0; color: #666;">${message}</p>
                <div style="display: flex; gap: 12px; justify-content: flex-end;">
                    <button id="confirm-cancel" style="
                        padding: 8px 16px;
                        border: 1px solid #ddd;
                        background: white;
                        border-radius: 4px;
                        cursor: pointer;
                    ">Cancel</button>
                    <button id="confirm-ok" style="
                        padding: 8px 16px;
                        border: none;
                        background: #2196F3;
                        color: white;
                        border-radius: 4px;
                        cursor: pointer;
                    ">OK</button>
                </div>
            `;

            overlay.appendChild(dialog);
            document.body.appendChild(overlay);

            const handleResult = (result) => {
                document.body.removeChild(overlay);
                resolve(result);
            };

            dialog.querySelector('#confirm-ok').onclick = () => handleResult(true);
            dialog.querySelector('#confirm-cancel').onclick = () => handleResult(false);
            overlay.onclick = (e) => {
                if (e.target === overlay) handleResult(false);
            };
        });
    }

    // Show input dialog
    async prompt(message, defaultValue = '', title = 'Input') {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 2000;
            `;

            const dialog = document.createElement('div');
            dialog.style.cssText = `
                background: white;
                padding: 24px;
                border-radius: 8px;
                max-width: 400px;
                margin: 20px;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
            `;

            dialog.innerHTML = `
                <h3 style="margin: 0 0 16px 0; color: #333;">${title}</h3>
                <p style="margin: 0 0 16px 0; color: #666;">${message}</p>
                <input id="prompt-input" type="text" value="${defaultValue}" style="
                    width: 100%;
                    padding: 8px 12px;
                    border: 1px solid #ddd;
                    border-radius: 4px;
                    margin-bottom: 24px;
                    box-sizing: border-box;
                ">
                <div style="display: flex; gap: 12px; justify-content: flex-end;">
                    <button id="prompt-cancel" style="
                        padding: 8px 16px;
                        border: 1px solid #ddd;
                        background: white;
                        border-radius: 4px;
                        cursor: pointer;
                    ">Cancel</button>
                    <button id="prompt-ok" style="
                        padding: 8px 16px;
                        border: none;
                        background: #2196F3;
                        color: white;
                        border-radius: 4px;
                        cursor: pointer;
                    ">OK</button>
                </div>
            `;

            overlay.appendChild(dialog);
            document.body.appendChild(overlay);

            const input = dialog.querySelector('#prompt-input');
            input.focus();
            input.select();

            const handleResult = (result) => {
                document.body.removeChild(overlay);
                resolve(result);
            };

            dialog.querySelector('#prompt-ok').onclick = () => handleResult(input.value);
            dialog.querySelector('#prompt-cancel').onclick = () => handleResult(null);
            overlay.onclick = (e) => {
                if (e.target === overlay) handleResult(null);
            };

            input.onkeypress = (e) => {
                if (e.key === 'Enter') handleResult(input.value);
                if (e.key === 'Escape') handleResult(null);
            };
        });
    }
}

// Create and export singleton instance
export const notificationService = new NotificationService(); 