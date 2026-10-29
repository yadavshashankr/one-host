// Theme Manager Service
// Dark mode switch in the social media menu. Follows the device's
// prefers-color-scheme setting until the user flips the switch. The flipped
// choice is kept in sessionStorage, so it lasts through refreshes of that tab
// only; every new tab starts from the device setting again. Flipping back to
// whatever the device uses clears the saved choice.
// The saved choice is applied early by an inline script in index.html's <head>
// to avoid a flash of the wrong theme.

class ThemeManager {
    constructor() {
        this.STORAGE_KEY = 'one-host-theme';
        this.systemQuery = window.matchMedia('(prefers-color-scheme: dark)');
        this.savedTheme = this.getSavedTheme(); // 'light', 'dark' or null (follow device)
        this.toggleButton = null;
        this.toggleIcon = null;
        this.fadeTimeout = null;
    }

    init() {
        this.toggleButton = document.getElementById('theme-toggle');
        this.toggleIcon = document.getElementById('theme-toggle-icon');

        this.applyTheme();

        // Keep the switch in step with the device while no choice is saved
        const onSystemChange = () => {
            if (!this.savedTheme) this.applyTheme();
        };
        if (this.systemQuery.addEventListener) {
            this.systemQuery.addEventListener('change', onSystemChange);
        } else if (this.systemQuery.addListener) {
            this.systemQuery.addListener(onSystemChange); // Older Safari
        }

        if (!this.toggleButton) {
            console.error('Theme toggle element not found!');
            return;
        }

        this.toggleButton.addEventListener('click', (e) => {
            e.stopPropagation(); // Keep the social media menu open
            this.toggle();
        });
    }

    prefersReducedMotion() {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    // Switch themes with an animation. Only used for taps on the switch;
    // page load and device theme changes switch instantly.
    animateThemeChange(apply) {
        if (this.prefersReducedMotion()) {
            apply();
            return;
        }

        // Knob: sun spins into moon (or back)
        if (this.toggleIcon) {
            this.toggleIcon.classList.remove('theme-icon-spin');
            void this.toggleIcon.offsetWidth; // Restart the animation
            this.toggleIcon.classList.add('theme-icon-spin');
        }

        // Page: new theme grows out of the switch as a circle (View Transitions API)
        if (document.startViewTransition && this.toggleButton) {
            // Start from the knob where it sits at the moment of the tap, before it slides across
            const knob = this.toggleButton.querySelector('.theme-switch-knob') || this.toggleButton;
            const rect = knob.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            const radius = Math.hypot(
                Math.max(x, window.innerWidth - x),
                Math.max(y, window.innerHeight - y)
            );

            const transition = document.startViewTransition(apply);
            transition.ready.then(() => {
                document.documentElement.animate(
                    {
                        clipPath: [
                            `circle(0px at ${x}px ${y}px)`,
                            `circle(${radius}px at ${x}px ${y}px)`
                        ]
                    },
                    {
                        // Ease in so the circle is visibly born at the knob before it speeds up
                        duration: 700,
                        easing: 'cubic-bezier(0.65, 0, 0.35, 1)',
                        pseudoElement: '::view-transition-new(root)'
                    }
                );
            }).catch(() => {});
            return;
        }

        // Fallback for browsers without View Transitions (e.g. Firefox): cross-fade colours
        const root = document.documentElement;
        root.classList.add('theme-fading');
        apply();
        clearTimeout(this.fadeTimeout);
        this.fadeTimeout = setTimeout(() => root.classList.remove('theme-fading'), 350);
    }

    getSystemTheme() {
        return this.systemQuery.matches ? 'dark' : 'light';
    }

    getEffectiveTheme() {
        return this.savedTheme || this.getSystemTheme();
    }

    getSavedTheme() {
        try {
            // Older versions saved the choice for all tabs; drop it so new tabs follow the device
            localStorage.removeItem(this.STORAGE_KEY);
            const saved = sessionStorage.getItem(this.STORAGE_KEY);
            if (saved === 'light' || saved === 'dark') {
                return saved;
            }
        } catch (error) {
            console.debug('Theme preference not readable:', error);
        }
        return null;
    }

    toggle() {
        const nextTheme = this.getEffectiveTheme() === 'dark' ? 'light' : 'dark';
        // Matching the device again means "follow the device"
        this.savedTheme = nextTheme === this.getSystemTheme() ? null : nextTheme;

        try {
            if (this.savedTheme) {
                sessionStorage.setItem(this.STORAGE_KEY, this.savedTheme);
            } else {
                sessionStorage.removeItem(this.STORAGE_KEY);
            }
        } catch (error) {
            console.debug('Theme preference not saved:', error);
        }

        this.animateThemeChange(() => this.applyTheme());

        if (typeof Analytics !== 'undefined') {
            Analytics.track('theme_changed', {
                theme: nextTheme,
                follows_system: !this.savedTheme
            });
        }
    }

    applyTheme() {
        // No saved choice removes the attribute so the prefers-color-scheme media query decides
        if (this.savedTheme) {
            document.documentElement.setAttribute('data-theme', this.savedTheme);
        } else {
            document.documentElement.removeAttribute('data-theme');
        }

        const isDark = this.getEffectiveTheme() === 'dark';
        if (this.toggleIcon) {
            this.toggleIcon.textContent = isDark ? 'dark_mode' : 'light_mode';
        }
        if (this.toggleButton) {
            this.toggleButton.setAttribute('aria-checked', String(isDark));
            this.toggleButton.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
        }

        // Let parts drawn in JS (e.g. the QR code) pick up the new colours
        window.dispatchEvent(new CustomEvent('themechange', {
            detail: { theme: this.getEffectiveTheme() }
        }));
    }
}

// Export for use in other modules or attach to window
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ThemeManager;
} else {
    window.ThemeManager = ThemeManager;
    window.themeManager = new ThemeManager();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => window.themeManager.init());
    } else {
        window.themeManager.init();
    }
}
