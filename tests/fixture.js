import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const XML = `<node><interface name="org.mpris.MediaPlayer2.Player">
<method name="Play"/><method name="Pause"/>
<property name="PlaybackStatus" type="s" access="read"/>
<property name="CanControl" type="b" access="read"/>
<property name="CanPlay" type="b" access="read"/>
<property name="CanPause" type="b" access="read"/>
<property name="Metadata" type="a{sv}" access="read"/>
</interface></node>`;

// Used only on a private test bus; never connects to the user's Spotify instance.
export class MprisFixture {
    constructor(bus, name = 'org.mpris.MediaPlayer2.spotify') {
        this.bus = bus;
        this.name = name;
        this.status = 'Paused';
        this.calls = [];
        this.reads = 0;
        this.canPlay = this.canPause = this.canControl = true;
        this.silent = this.fail = this.hold = false;
        this.pending = [];
        this.object = Gio.DBusExportedObject.wrapJSObject(XML, this);
        this.object.export(bus, '/org/mpris/MediaPlayer2');
    }
    start() {
        return new Promise(resolve => {
            this.owner = Gio.bus_own_name_on_connection(this.bus, this.name, Gio.BusNameOwnerFlags.NONE, () => resolve(), null);
        });
    }
    get PlaybackStatus() { this.reads++; return this.status; }
    get CanControl() { return this.canControl; }
    get CanPlay() { return this.canPlay; }
    get CanPause() { return this.canPause; }
    get Metadata() {
        return {'xesam:title': new GLib.Variant('s', 'Midnight City'),
            'xesam:artist': new GLib.Variant('as', ['M83'])};
    }
    setStatus(status) {
        this.status = status;
        if (!this.silent) this.object.emit_property_changed('PlaybackStatus', new GLib.Variant('s', status));
    }
    setCapabilities(play, pause, control = true) {
        this.canPlay = play; this.canPause = pause; this.canControl = control;
        for (const [name, value] of [['CanPlay', play], ['CanPause', pause], ['CanControl', control]])
            this.object.emit_property_changed(name, new GLib.Variant('b', value));
    }
    _command(method, invocation) {
        this.calls.push(method);
        if (this.fail) { invocation.return_dbus_error('org.mpris.MediaPlayer2.Error.Failed', 'Test error'); return; }
        if (this.hold) { this.pending.push(invocation); return; }
        this.setStatus(method === 'Play' ? 'Playing' : 'Paused');
        invocation.return_value(null);
    }
    PlayAsync(_args, invocation) { this._command('Play', invocation); }
    PauseAsync(_args, invocation) { this._command('Pause', invocation); }
    close() {
        for (const invocation of this.pending) invocation.return_dbus_error('org.mpris.MediaPlayer2.Error.Closed', 'Test player closed');
        this.pending = [];
        if (this.owner) Gio.bus_unown_name(this.owner);
        this.owner = 0;
        this.object.unexport();
    }
}
