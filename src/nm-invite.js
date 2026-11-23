// nm-invite.js — Lane C "Ajak Main": undang pemain di room untuk main
// aktivitas pasar malam yang sama (wahana / game berhadiah).
//
// Protokol (broadcast generik Multiplayer.broadcast, TANPA ubah
// multiplayer.js). Semua event disiarkan ke SEMUA peer di room; penerima
// hanya bereaksi bila `toKey` (invite) / `inviteId` (jawaban) cocok:
//   'invite'         { inviteId, from, fromKey, toKey, activity, at }
//     activity = { kind: 'ride' | 'game', id }
//   'invite_accept'  { inviteId, from, activity }
//   'invite_decline' { inviteId, from, expired? }
//   'activity_join'  { username, activity }   // info saja, kedua sisi kirim
// inviteId: string acak, unik per undangan.
//
// Perilaku timeout (dipilih lane ini, didokumentasikan di REPORT.md):
// penerima yang tidak menjawab dalam 20 dtk DIANGGAP MENOLAK — dialog
// menutup sendiri dan modul MENGIRIM 'invite_decline' { expired: true },
// supaya pengundang selalu mendapat jawaban eksplisit, bukan menebak.
// Pengundang juga punya pengaman lokal 25 dtk: bila tidak ada jawaban sama
// sekali (paket hilang / peer keluar room), undangan dibersihkan dan toast
// kedaluwarsa tampil. Jadi alur timeout deterministik di kedua sisi.
//
// Solo: bila mp tidak terhubung, semua fungsi no-op — tombol nonaktif,
// tidak ada error, tidak ada toast. Modul TIDAK pernah menyentuh backend
// Supabase (hanya Realtime ephemeral yang sudah ada).
//
// Wiring ke main.js dilakukan koordinator — lihat REPORT.md lane ini untuk
// snippet konstruksi + routing onEvent yang persis dan siap tempel.
export const INVITE_RANGE_M = 10;
export const INVITE_DIALOG_MS = 20000; // dialog penerima hilang sendiri
export const INVITE_OUT_TIMEOUT_MS = 25000; // pengaman pengundang

function genInviteId() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    return `inv-${buf[0].toString(36)}${buf[1].toString(36)}`;
  }
  return `inv-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function validActivity(a) {
  return !!a && typeof a === 'object'
    && (a.kind === 'ride' || a.kind === 'game')
    && typeof a.id === 'string' && a.id.length > 0;
}

function sameActivity(a, b) {
  return !!a && !!b && a.kind === b.kind && a.id === b.id;
}

export class NmInvite {
  constructor(opts = {}) {
    this.game = opts.game || null;
    this.mp = opts.mp || null;
    // toast(m): tampilkan toast kecil (ui.toast). t(k, vars): teks i18n
    // bahasa aktif — penutup (closure) di Game membaca state.lang live.
    this.toast = typeof opts.toast === 'function' ? opts.toast : (() => {});
    this.t = typeof opts.t === 'function' ? opts.t : ((k) => k);
    this.getSelfName = typeof opts.getSelfName === 'function'
      ? opts.getSelfName : (() => 'Tamu');
    this.getSelfKey = typeof opts.getSelfKey === 'function'
      ? opts.getSelfKey : (() => this.mp?._presenceKey || null);
    this.getLocalPosition = typeof opts.getLocalPosition === 'function'
      ? opts.getLocalPosition
      : (() => {
        const p = this.game?.player;
        return p ? { x: p.x, z: p.z } : null;
      });
    // getActivity(): { kind, id } | null — aktivitas pemain lokal saat ini:
    // _ctx board point, ATAU wahana yang sedang dinaiki / game yang terbuka.
    this.getActivity = typeof opts.getActivity === 'function'
      ? opts.getActivity : (() => this._defaultActivity());
    // joinActivity(activity): boolean — masuk aktivitas (onUse ride/game).
    this.joinActivity = typeof opts.joinActivity === 'function'
      ? opts.joinActivity : ((a) => this._defaultJoin(a));
    this.inviteTimeoutMs = Number.isFinite(opts.inviteTimeoutMs) && opts.inviteTimeoutMs > 0
      ? opts.inviteTimeoutMs : INVITE_DIALOG_MS;
    this.outTimeoutMs = Number.isFinite(opts.outTimeoutMs) && opts.outTimeoutMs > 0
      ? opts.outTimeoutMs : INVITE_OUT_TIMEOUT_MS;

    this._pendingOut = null; // { inviteId, toKey, toName, activity, timer }
    this._pendingIn = null; // { inviteId, from, fromKey, activity, timer }
    this._lastJoin = null; // activity_join terakhir yang diterima (debug)
    this._target = null; // pemain terdekat saat ini { username, key, dist }

    // DOM (ada di index.html sejak load): tombol + dialog + Ya/Tidak.
    this._btn = document.getElementById('btn-invite');
    this._dialog = document.getElementById('invite-dialog');
    this._dialogText = document.getElementById('invite-dialog-text');
    this._btnYes = document.getElementById('btn-invite-yes');
    this._btnNo = document.getElementById('btn-invite-no');
    this._onBtnClick = () => this.sendInvite();
    this._onYes = () => this._answerIncoming(true);
    this._onNo = () => this._answerIncoming(false);
    this._btn?.addEventListener('click', this._onBtnClick);
    this._btnYes?.addEventListener('click', this._onYes);
    this._btnNo?.addEventListener('click', this._onNo);
    this._refreshButton();
  }

  // ---------- Aktivitas default (dipakai bila wiring tidak memberi
  // getActivity/joinActivity sendiri — baca langsung dari Game) ----------
  _defaultActivity() {
    const g = this.game;
    if (!g) return null;
    if (g.nmRides?.isRiding?.()) {
      const rid = g.nmRides.debug?.state?.().riding;
      if (rid) return { kind: 'ride', id: rid };
    }
    const open = g.nmGames?.debug?.state?.().open;
    if (open) return { kind: 'game', id: open };
    const ctx = g._ctx;
    if (ctx?.type === 'nm') return { kind: 'ride', id: ctx.id };
    if (ctx?.type === 'nmGame') return { kind: 'game', id: ctx.id };
    return null;
  }

  _defaultJoin(activity) {
    const g = this.game;
    if (!g || !validActivity(activity)) return false;
    if (activity.kind === 'ride') {
      if (g.nmRides?.isRiding?.()) {
        if (g.nmRides.debug?.state?.().riding === activity.id) return true;
        g.nmRides.stopRide();
      }
      return !!g.nmRides?.onUse?.(activity.id, g);
    }
    // Game: turun dulu bila sedang naik wahana — panel + wahana tidak
    // dimainkan bersamaan.
    if (g.nmRides?.isRiding?.()) g.nmRides.stopRide();
    return !!g.nmGames?.onUse?.(activity.id, g);
  }

  // ---------- Label aktivitas (untuk dialog + title tombol) ----------
  activityLabel(activity) {
    if (!validActivity(activity)) return activity?.id || '';
    const list = activity.kind === 'ride'
      ? this.game?.nmRides?.interactables
      : this.game?.nmGames?.interactables;
    const it = list?.find((x) => x.id === activity.id);
    return it ? this.t(it.labelKey) : activity.id;
  }

  // ---------- Update tiap frame (dipanggil dari loop Game) ----------
  // Hanya me-refresh tombol + membersihkan state bila room putus.
  // Timeout dialog/undangan memakai setTimeout sendiri (bukan dt).
  update() {
    if (!this.mp?.connected) {
      if (this._pendingOut || this._pendingIn) this._clearAllPending(false);
    }
    this._refreshButton();
  }

  _nearestPlayer() {
    const mp = this.mp;
    if (!mp?.connected || typeof mp.getPlayers !== 'function') return null;
    const pos = this.getLocalPosition();
    if (!pos) return null;
    let best = null;
    for (const p of mp.getPlayers()) {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
      const d = Math.hypot(p.x - pos.x, p.z - pos.z);
      if (d <= INVITE_RANGE_M && (!best || d < best.dist)) {
        best = { username: p.username, key: p.key, dist: d };
      }
    }
    return best;
  }

  _refreshButton() {
    const btn = this._btn;
    if (!btn) return;
    this._target = this._nearestPlayer();
    const activity = this.getActivity();
    let disabled = true;
    let title;
    if (!this.mp?.connected) {
      title = this.t('inviteNeedRoom');
    } else if (this._pendingOut) {
      title = this.t('inviteWaiting', { u: this._pendingOut.toName });
    } else if (!activity) {
      title = this.t('inviteNeedActivity');
    } else if (!this._target) {
      title = this.t('inviteNeedNear');
    } else {
      disabled = false;
      title = this.t('inviteReady', { u: this._target.username, a: this.activityLabel(activity) });
    }
    btn.disabled = disabled;
    btn.title = title;
  }

  // ---------- Pengundang: kirim undangan ke pemain terdekat ----------
  sendInvite() {
    if (!this.mp?.connected) return false;
    if (this._pendingOut) return false; // max 1 undangan tertunda
    const activity = this.getActivity();
    const target = this._nearestPlayer();
    if (!activity || !target) return false;
    const inviteId = genInviteId();
    const payload = {
      inviteId,
      from: this.getSelfName(),
      fromKey: this.getSelfKey(),
      toKey: target.key,
      activity: { kind: activity.kind, id: activity.id },
      at: Date.now(),
    };
    if (!this.mp.broadcast('invite', payload)) return false;
    this._pendingOut = {
      inviteId, toKey: target.key, toName: target.username,
      activity: payload.activity,
      timer: setTimeout(() => this._expireOutgoing(), this.outTimeoutMs),
    };
    this._refreshButton();
    return true;
  }

  _expireOutgoing() {
    const p = this._pendingOut;
    if (!p) return;
    this._pendingOut = null;
    this.toast(this.t('inviteExpired', { u: p.toName }));
    this._refreshButton();
  }

  // ---------- Event masuk dari mp.onEvent (dirute Game, lihat REPORT) ----------
  handleEvent(type, data) {
    if (!data || typeof data !== 'object') return;
    switch (type) {
      case 'invite': this._onInvite(data); break;
      case 'invite_accept': this._onAccept(data); break;
      case 'invite_decline': this._onDecline(data); break;
      case 'activity_join': this._lastJoin = data; break;
      default: break;
    }
  }

  // ---------- Penerima: dialog Ya/Tidak ----------
  _onInvite(data) {
    if (!this.mp?.connected) return;
    if (!validActivity(data.activity)) return;
    if (typeof data.toKey !== 'string' || data.toKey !== this.getSelfKey()) return;
    if (data.fromKey && data.fromKey === this.getSelfKey()) return;
    if (this._pendingIn) return; // hanya 1 dialog tertunda; sisanya diabaikan
    const from = String(data.from || '').slice(0, 16) || '?';
    this._pendingIn = {
      inviteId: String(data.inviteId || ''),
      from,
      fromKey: data.fromKey || null,
      activity: { kind: data.activity.kind, id: data.activity.id },
      timer: setTimeout(() => this._expireIncoming(), this.inviteTimeoutMs),
    };
    if (this._dialogText) {
      this._dialogText.textContent = this.t('inviteTitle', {
        u: from, a: this.activityLabel(this._pendingIn.activity),
      });
    }
    this._dialog?.classList.remove('hidden');
  }

  _hideDialog() {
    this._dialog?.classList.add('hidden');
  }

  _answerIncoming(accept) {
    const p = this._pendingIn;
    if (!p) return;
    clearTimeout(p.timer);
    this._pendingIn = null;
    this._hideDialog();
    if (!accept) {
      this.mp?.broadcast('invite_decline', { inviteId: p.inviteId, from: this.getSelfName() });
      return;
    }
    // Ya: masuk aktivitas yang sama (lewati onUse bila sudah DIJALANI —
    // onUse wahana/game bersifat toggle dan akan MENURUNKAN/MENUTUP).
    // Bila join GAGAL (mis. wahana bergate belum giliran): jangan klaim
    // "Main bareng" — kirim decline{failed:true} supaya pengundang tahu.
    if (!this._joinIfNeeded(p.activity)) {
      this.mp?.broadcast('invite_decline', {
        inviteId: p.inviteId, from: this.getSelfName(), failed: true,
      });
      return;
    }
    this.mp?.broadcast('invite_accept', {
      inviteId: p.inviteId, from: this.getSelfName(), activity: p.activity,
    });
    this.mp?.broadcast('activity_join', { username: this.getSelfName(), activity: p.activity });
    this.toast(this.t('inviteJoined', { u: p.from }));
  }

  _expireIncoming() {
    const p = this._pendingIn;
    if (!p) return;
    this._pendingIn = null;
    this._hideDialog();
    // Timeout = decline: pengundang mendapat jawaban eksplisit (expired).
    this.mp?.broadcast('invite_decline', {
      inviteId: p.inviteId, from: this.getSelfName(), expired: true,
    });
  }

  // ---------- Pengundang: jawaban masuk ----------
  _onAccept(data) {
    const p = this._pendingOut;
    if (!p || data.inviteId !== p.inviteId) return;
    clearTimeout(p.timer);
    this._pendingOut = null;
    const activity = validActivity(data.activity) ? data.activity : p.activity;
    // Pengundang ikut masuk; bila join-nya gagal (wahana bergate), jangan
    // klaim "Main bareng" — beri tahu dengan toast gagal saja.
    if (!this._joinIfNeeded(activity)) {
      this.toast(this.t('inviteJoinFailed'));
      this._refreshButton();
      return;
    }
    this.mp?.broadcast('activity_join', { username: this.getSelfName(), activity });
    this.toast(this.t('inviteJoined', { u: String(data.from || '').slice(0, 16) || '?' }));
    this._refreshButton();
  }

  _onDecline(data) {
    const p = this._pendingOut;
    if (!p || data.inviteId !== p.inviteId) return;
    clearTimeout(p.timer);
    this._pendingOut = null;
    const who = String(data.from || '').slice(0, 16) || p.toName;
    this.toast(this.t(data.failed ? 'inviteJoinFailed' : (data.expired ? 'inviteExpired' : 'inviteDeclined'), { u: who }));
    this._refreshButton();
  }

  // Aktivitas yang SEDANG DIJALANI (bukan sekadar konteks board point):
  // wahana yang sedang dinaiki / panel game yang sedang terbuka. Dipakai
  // _joinIfNeeded supaya "berdiri di board point" TIDAK dianggap sudah
  // masuk aktivitas — _ctx saja bukan bukti naik (onUse harus dipanggil).
  _activeActivity() {
    const g = this.game;
    if (!g) return null;
    if (g.nmRides?.isRiding?.()) {
      const rid = g.nmRides.debug?.state?.().riding;
      if (rid) return { kind: 'ride', id: rid };
    }
    const open = g.nmGames?.debug?.state?.().open;
    if (open) return { kind: 'game', id: open };
    return null;
  }

  // Masuk aktivitas bila belum DIJALANI; sudah naik/buka = tidak ada aksi
  // (onUse wahana/game bersifat toggle — panggil ulang = turun/tutup!).
  _joinIfNeeded(activity) {
    if (!validActivity(activity)) return false;
    if (sameActivity(this._activeActivity(), activity)) return true;
    return !!this.joinActivity(activity);
  }

  _clearAllPending() {
    if (this._pendingOut) clearTimeout(this._pendingOut.timer);
    if (this._pendingIn) clearTimeout(this._pendingIn.timer);
    this._pendingOut = null;
    this._pendingIn = null;
    this._hideDialog();
  }

  destroy() {
    this._clearAllPending();
    this._btn?.removeEventListener('click', this._onBtnClick);
    this._btnYes?.removeEventListener('click', this._onYes);
    this._btnNo?.removeEventListener('click', this._onNo);
  }
}
