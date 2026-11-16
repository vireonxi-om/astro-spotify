import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {SpotifyPlayer} from './player.js';

const SpotifyIndicator = GObject.registerClass(
class AstroSpotifyIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.5, 'Spotify playback controls', true);
        this.add_style_class_name('astro-spotify');
        this.can_focus = false; // The three child buttons have their own focus stops.
        this._tooltipTimer = 0;
        this._tooltipTarget = null;
        this._state = {status: 'Offline', available: false};
        this._capsule = new St.BoxLayout({style_class: 'as-capsule', y_align: Clutter.ActorAlign.CENTER});
        this.add_child(this._capsule);
        const icon = name => new St.Icon({
            gicon: Gio.FileIcon.new(Gio.File.new_for_path(`${extension.path}/icons/${name}-symbolic.svg`)),
            icon_size: 13, style_class: 'as-icon', y_align: Clutter.ActorAlign.CENTER});
        const brand = new St.BoxLayout({style_class: 'as-brand-content', y_align: Clutter.ActorAlign.CENTER});
        this._brandIcon = icon('spotify');
        this._brandIcon.add_style_class_name('as-spotify-icon');
        brand.add_child(this._brandIcon);
        this._label = new St.Label({text: 'Spotify', style_class: 'as-brand-label', y_align: Clutter.ActorAlign.CENTER});
        brand.add_child(this._label);
        this._brand = this._button(brand, 'Open Spotify', 'as-brand');
        this._brand.connect('clicked', () => this._openSpotify());
        this._capsule.add_child(this._brand);
        this._capsule.add_child(new St.Widget({style_class: 'as-divider', width: 1, height: 11,
            y_align: Clutter.ActorAlign.CENTER}));
        this._play = this._button(icon('play'), 'Play Spotify', 'as-control');
        this._pause = this._button(icon('pause'), 'Pause Spotify', 'as-control');
        this._play.connect('clicked', () => this._player.command('Play'));
        this._pause.connect('clicked', () => this._player.command('Pause'));
        this._capsule.add_child(this._play);
        this._capsule.add_child(this._pause);
        this._tooltip = new St.Label({style_class: 'as-tooltip', visible: false, reactive: false});
        this._tooltip.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        Main.uiGroup.add_child(this._tooltip);
        this.connect('notify::mapped', () => { if (!this.mapped) this._hideTooltip(); });
        this._animationSettings = St.Settings.get();
        this._animationId = this._animationSettings.connect('notify::enable-animations', () => this._syncAnimations());
        this._syncAnimations();
        this._player = new SpotifyPlayer(state => this._render(state));
        this._render(this._player.snapshot());
    }
    _button(child, name, style) {
        const button = new St.Button({child, style_class: `as-button ${style}`, accessible_name: name,
            reactive: true, can_focus: true, track_hover: true, y_align: Clutter.ActorAlign.CENTER,
            button_mask: St.ButtonMask.ONE});
        button.connect('notify::hover', () => {
            if (button.hover) this._queueTooltip(button);
            else if (this._tooltipTarget === button) this._hideTooltip();
        });
        return button;
    }
    _syncAnimations() {
        const motion = this._animationSettings.enable_animations;
        for (const button of [this._brand, this._play, this._pause])
            button.set_style(`transition-duration: ${motion ? 120 : 0}ms;`);
    }
    _render(state) {
        this._state = state;
        const playing = state.status === 'Playing';
        const setEnabled = (button, enabled) => {
            button.reactive = enabled;
            button.can_focus = enabled;
            if (enabled) button.remove_style_pseudo_class('insensitive');
            else button.add_style_pseudo_class('insensitive');
        };
        setEnabled(this._play, state.canPlay && !playing && !state.busy);
        setEnabled(this._pause, state.canPause && playing && !state.busy);
        this._capsule.set_style_class_name(`as-capsule${playing ? ' as-playing' : ''}${state.error ? ' as-error' : ''}`);
        this._label.text = state.error ? 'Retry' : 'Spotify';
        const track = [state.title, state.artist].filter(Boolean).join(' — ');
        this._brand.accessible_name = state.error || (state.available ? `Open Spotify. ${state.status}${track ? `: ${track}` : ''}` : 'Open Spotify');
        this.accessible_name = `Spotify playback controls. ${state.error || (state.available ? state.status : 'Spotify is closed')}`;
        if (this._tooltip.visible) this._tooltip.text = this._tooltipText(this._tooltipTarget);
    }
    _tooltipText(button) {
        if (button === this._brand) {
            if (this._state.error) return this._state.error;
            const track = [this._state.title, this._state.artist].filter(Boolean).join(' — ');
            return this._state.available ? `${this._state.status}${track ? ` · ${track}` : ''} · Open Spotify` : 'Open Spotify';
        }
        return button === this._play ? 'Play Spotify' : 'Pause Spotify';
    }
    _queueTooltip(button) {
        this._hideTooltip();
        this._tooltipTarget = button;
        this._tooltipTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._tooltipTimer = 0;
            if (!button.hover || !this.mapped) return GLib.SOURCE_REMOVE;
            this._tooltip.text = this._tooltipText(button);
            const [x, y] = button.get_transformed_position();
            const [, width] = this._tooltip.get_preferred_width(-1);
            const monitor = Main.layoutManager.findMonitorForActor(this);
            const left = monitor?.x ?? 0, right = left + (monitor?.width ?? global.stage.width);
            this._tooltip.set_position(Math.max(left + 8, Math.min(x + button.width / 2 - width / 2, right - width - 8)),
                y + button.height + 8);
            this._tooltip.show();
            return GLib.SOURCE_REMOVE;
        });
    }
    _hideTooltip() {
        if (this._tooltipTimer) GLib.Source.remove(this._tooltipTimer);
        this._tooltipTimer = 0;
        this._tooltipTarget = null;
        this._tooltip?.hide();
    }
    _openSpotify() {
        this._hideTooltip();
        if (this._state.error) { this._player.reconnect(); return; }
        const system = Shell.AppSystem.get_default();
        const app = ['spotify_spotify.desktop', 'spotify.desktop', 'com.spotify.Client.desktop']
            .map(id => system.lookup_app(id)).find(Boolean);
        if (app) app.activate();
        else Main.notify('Astro Spotify', 'Open the Spotify desktop app to use the playback buttons.');
    }
    destroy() {
        this._hideTooltip();
        this._player.destroy();
        this._animationSettings.disconnect(this._animationId);
        this._tooltip.destroy();
        this._player = this._tooltip = this._animationSettings = null;
        super.destroy();
    }
});

export default class AstroSpotifyExtension extends Extension {
    enable() {
        this._indicator = new SpotifyIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, 'right');
    }
    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
