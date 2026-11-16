import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const PATH = '/org/mpris/MediaPlayer2';
const IFACE = 'org.mpris.MediaPlayer2.Player';
export const isSpotify = name => /^org\.mpris\.MediaPlayer2\.spotify(?:[.-][A-Za-z0-9_.-]+)?$/.test(name);
const unpack = value => value?.recursiveUnpack();

// All communications are asynchronous and limited to Spotify's MPRIS names.
// There is no periodic timer, background process, artwork fetch or position poll.
export class SpotifyPlayer {
    constructor(onChange, bus = Gio.DBus.session) {
        this._bus = bus;
        this._onChange = onChange;
        this._cancel = new Gio.Cancellable();
        this._players = new Map();
        this._seen = new Set();
        this._busy = null;
        this._error = '';
        this._subscription = bus.signal_subscribe('org.freedesktop.DBus', 'org.freedesktop.DBus',
            'NameOwnerChanged', '/org/freedesktop/DBus', 'org.mpris.MediaPlayer2',
            Gio.DBusSignalFlags.MATCH_ARG0_NAMESPACE, (_bus, _sender, _path, _iface, _signal, params) => {
                const [name, _oldOwner, owner] = params.deepUnpack();
                if (!isSpotify(name)) return;
                this._seen?.add(name);
                this._remove(name);
                if (owner) this._add(name);
                this._error = '';
                this._emit();
            });
        bus.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'ListNames',
            null, new GLib.VariantType('(as)'), Gio.DBusCallFlags.NONE, 3000, this._cancel,
            (connection, result) => {
                try {
                    const [names] = connection.call_finish(result).deepUnpack();
                    if (this._cancel.is_cancelled()) return;
                    for (const name of names) if (isSpotify(name) && !this._seen.has(name)) this._add(name);
                    this._seen = null;
                } catch (e) {
                    if (!this._cancel.is_cancelled()) { this._error = 'Unable to connect to Spotify'; this._emit(); }
                }
            });
    }
    _add(name) {
        if (this._players.has(name) || this._cancel.is_cancelled()) return;
        const entry = {name, cancel: new Gio.Cancellable(), proxy: null, signals: [], retry: 0, attempts: 0, revision: 0};
        this._players.set(name, entry);
        Gio.DBusProxy.new(this._bus,
            Gio.DBusProxyFlags.DO_NOT_AUTO_START | Gio.DBusProxyFlags.GET_INVALIDATED_PROPERTIES,
            null, name, PATH, IFACE, entry.cancel, (_source, result) => {
                let proxy;
                try { proxy = Gio.DBusProxy.new_finish(result); }
                catch (e) {
                    if (this._players.get(name) === entry && !entry.cancel.is_cancelled()) {
                        this._error = 'Spotify is not ready. Click to reconnect.';
                        this._emit();
                    }
                    return;
                }
                if (entry.cancel.is_cancelled() || this._players.get(name) !== entry) return;
                entry.proxy = proxy;
                entry.signals.push(proxy.connect('g-properties-changed', () => {
                    entry.revision++;
                    this._error = '';
                    this._emit();
                }));
                entry.signals.push(proxy.connect('notify::g-name-owner', () => this._emit()));
                if (!proxy.get_cached_property('PlaybackStatus')) this._bootstrap(entry);
                this._emit();
            });
    }
    _bootstrap(entry) {
        // Some players acquire the bus name before publishing their object.
        // At most three startup retries; no idle polling afterward.
        if (entry.attempts >= 3 || entry.cancel.is_cancelled()) return;
        const delays = [250, 1000, 3000];
        entry.retry = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delays[entry.attempts++], () => {
            entry.retry = 0;
            if (!entry.proxy?.get_cached_property('PlaybackStatus'))
                this._refresh(entry, () => {
                    if (!entry.proxy?.get_cached_property('PlaybackStatus')) this._bootstrap(entry);
                });
            return GLib.SOURCE_REMOVE;
        });
    }
    _remove(name) {
        const entry = this._players.get(name);
        if (!entry) return;
        this._players.delete(name);
        entry.cancel.cancel();
        if (entry.retry) GLib.Source.remove(entry.retry);
        for (const signal of entry.signals) entry.proxy.disconnect(signal);
        entry.proxy = null;
        if (this._busy === entry) this._busy = null;
    }
    _selected() {
        return [...this._players.values()].filter(e => e.proxy?.g_name_owner).sort((a, b) => {
            const playingA = unpack(a.proxy.get_cached_property('PlaybackStatus')) === 'Playing';
            const playingB = unpack(b.proxy.get_cached_property('PlaybackStatus')) === 'Playing';
            return Number(playingB) - Number(playingA) || a.name.localeCompare(b.name);
        })[0] ?? null;
    }
    snapshot() {
        const entry = this._selected();
        const get = key => entry ? unpack(entry.proxy.get_cached_property(key)) : undefined;
        const status = get('PlaybackStatus');
        const available = ['Playing', 'Paused', 'Stopped'].includes(status);
        const metadata = get('Metadata') ?? {};
        return {
            available, status: available ? status : 'Offline', busy: this._busy !== null,
            canPlay: available && get('CanControl') === true && get('CanPlay') === true,
            canPause: available && get('CanControl') === true && get('CanPause') === true,
            title: typeof metadata['xesam:title'] === 'string' ? metadata['xesam:title'].slice(0, 256) : '',
            artist: Array.isArray(metadata['xesam:artist']) ? metadata['xesam:artist'].filter(x => typeof x === 'string').join(', ').slice(0, 256) : '',
            error: this._error,
        };
    }
    _emit() { if (!this._cancel.is_cancelled()) this._onChange(this.snapshot()); }
    _refresh(entry, done = () => {}) {
        if (entry.cancel.is_cancelled()) return;
        const revision = entry.revision;
        this._bus.call(entry.name, PATH, 'org.freedesktop.DBus.Properties', 'GetAll',
            new GLib.Variant('(s)', [IFACE]), new GLib.VariantType('(a{sv})'),
            Gio.DBusCallFlags.NO_AUTO_START, 3000, entry.cancel, (bus, result) => {
                try {
                    const [props] = bus.call_finish(result).deepUnpack();
                    if (entry.cancel.is_cancelled()) return;
                    if (entry.revision === revision) {
                        for (const [key, value] of Object.entries(props)) entry.proxy.set_cached_property(key, value);
                        entry.revision++;
                    }
                    this._error = '';
                } catch (e) {
                    if (entry.cancel.is_cancelled()) return;
                    this._error = 'Spotify is not responding. Click to reconnect.';
                }
                this._emit();
                done();
            });
    }
    reconnect() {
        this._error = '';
        for (const name of [...this._players.keys()]) { this._remove(name); this._add(name); }
        this._emit();
    }
    command(method) {
        if (!['Play', 'Pause'].includes(method) || this._busy || this._cancel.is_cancelled()) return false;
        const entry = this._selected(), state = this.snapshot();
        if (!entry || !(method === 'Play' ? state.canPlay : state.canPause)) return false;
        // Explicit, idempotent methods avoid an accidental double-toggle.
        this._busy = entry;
        this._error = '';
        this._emit();
        entry.proxy.call(method, null, Gio.DBusCallFlags.NO_AUTO_START, 3000, entry.cancel, (proxy, result) => {
            try {
                proxy.call_finish(result);
                if (entry.cancel.is_cancelled()) return;
                this._busy = null;
                this._refresh(entry); // One read after a user action, even if Spotify omits its signal.
            } catch (e) {
                if (entry.cancel.is_cancelled()) return;
                this._busy = null;
                this._error = 'Could not control Spotify. Click to reconnect.';
                this._emit();
            }
        });
        return true;
    }
    destroy() {
        this._cancel.cancel();
        this._bus.signal_unsubscribe(this._subscription);
        for (const name of [...this._players.keys()]) this._remove(name);
        this._seen?.clear();
        this._onChange = null;
    }
}
