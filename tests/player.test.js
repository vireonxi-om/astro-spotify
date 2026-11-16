import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {SpotifyPlayer, isSpotify} from '../player.js';
import {MprisFixture} from './fixture.js';

let assertions = 0;
function check(value, message) { assertions++; if (!value) throw new Error(message); }
const delay = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { resolve(); return GLib.SOURCE_REMOVE; }));
async function until(condition, message, max = 4500) {
    const deadline = GLib.get_monotonic_time() + max * 1000;
    while (!condition() && GLib.get_monotonic_time() < deadline) await delay(20);
    check(condition(), message);
}
async function test() {
    check(isSpotify('org.mpris.MediaPlayer2.spotify'), 'native Spotify name');
    check(isSpotify('org.mpris.MediaPlayer2.spotify.instance1'), 'Spotify instance name');
    for (const name of ['org.mpris.MediaPlayer2.chromium.instance1', 'org.mpris.MediaPlayer2.spotifyClone', 'org.mpris.MediaPlayer2.vlc'])
        check(!isSpotify(name), `must ignore ${name}`);
    const bus = Gio.bus_get_sync(Gio.BusType.SESSION, null);
    let updates = 0;
    const client = new SpotifyPlayer(() => updates++, bus);
    check(!client.snapshot().available, 'starts offline');
    let fixture = new MprisFixture(bus, 'org.mpris.MediaPlayer2.chromium.instance1');
    await fixture.start(); await delay(150);
    check(!client.snapshot().available, 'a non-Spotify player is never selected');
    fixture.close();
    fixture = new MprisFixture(bus);
    await fixture.start();
    await until(() => client.snapshot().available, 'discovers Spotify after startup');
    check(client.snapshot().status === 'Paused', 'initial state correct');
    check(client.snapshot().title === 'Midnight City', 'metadata unpacked');
    check(client.command('Play'), 'play accepted');
    check(!client.command('Pause'), 'concurrent click rejected');
    await until(() => client.snapshot().status === 'Playing' && !client.snapshot().busy, 'play updates status');
    check(fixture.calls.join(',') === 'Play', 'only the explicit Play method was sent');
    check(client.command('Pause'), 'pause accepted');
    await until(() => client.snapshot().status === 'Paused' && !client.snapshot().busy, 'pause updates status');
    fixture.setStatus('Playing');
    await until(() => client.snapshot().status === 'Playing', 'external playback changes update without polling');
    fixture.setCapabilities(false, false);
    await until(() => !client.snapshot().canPause, 'capability changes applied');
    check(!client.command('Pause'), 'unsupported controls blocked');
    fixture.setCapabilities(true, true);
    await until(() => client.snapshot().canPause, 'capabilities recover');
    fixture.silent = true;
    client.command('Pause');
    await until(() => client.snapshot().status === 'Paused' && !client.snapshot().busy, 'one action refresh handles missing property signals');
    fixture.silent = false;
    fixture.fail = true;
    client.command('Play');
    await until(() => Boolean(client.snapshot().error) && !client.snapshot().busy, 'errors unlock controls');
    fixture.fail = false;
    client.reconnect();
    await until(() => client.snapshot().available && !client.snapshot().error, 'manual reconnect recovers');
    fixture.hold = true;
    client.command('Play');
    await until(() => Boolean(client.snapshot().error) && !client.snapshot().busy, 'timeout unlocks controls');
    fixture.close();
    await until(() => !client.snapshot().available, 'Spotify closing clears state');
    fixture = new MprisFixture(bus);
    await fixture.start();
    await until(() => client.snapshot().available, 'Spotify restart reconnects');
    const reads = fixture.reads, beforeUpdates = updates;
    await delay(1200);
    check(fixture.reads === reads && updates === beforeUpdates, 'idle causes no reads or UI callbacks');
    for (let i = 0; i < 5; i++) {
        const temporary = new SpotifyPlayer(() => {}, bus);
        await until(() => temporary.snapshot().available, 'reenable connects');
        temporary.destroy();
    }
    fixture.hold = true;
    client.command('Play');
    await delay(30);
    client.destroy();
    const finalUpdates = updates;
    fixture.close();
    await delay(100);
    check(updates === finalUpdates, 'destroy cancels in-flight actions and callbacks');
    check(client._players.size === 0, 'destroy releases proxies');
    print(`PASS: ${assertions} assertions using a private D-Bus MPRIS fixture; no live Spotify playback touched.`);
}
const loop = new GLib.MainLoop(null, false);
let failure;
test().catch(e => { failure = e; }).finally(() => loop.quit());
loop.run();
if (failure) throw failure;
