// debug.js — hook uji untuk verifikasi otomatis koordinator.
// window.__LH = { state, player, farm, animals, economy, time, api }.
// Hook ini tidak berbahaya (tanpa secret) dan tidak tampil di UI.
export function attachDebug(game) {
  const api = {
    teleport: (x, z) => game.teleport(x, z),
    hoeAt: (ix, iz) => game.hoeAt(ix, iz),
    plantAt: (ix, iz, crop) => game.plantAt(ix, iz, crop),
    waterAt: (ix, iz) => game.waterAt(ix, iz),
    harvestAt: (ix, iz) => game.harvestAt(ix, iz),
    sleep: () => game.sleep(),
    addCoins: (n) => game.addCoins(n),
    setLang: (lang) => game.setLang(lang),
    sellAll: () => game.sellAll(),
    buySeed: (crop) => game.buySeed(crop),
    buyFeed: () => game.buyFeed(),
    feedAnimal: (kind) => game.feedAnimal(kind),
    collectAnimal: (kind) => game.collectAnimal(kind),
    getFps: () => game.fps,
    getState: () => game.getStateSnapshot(),
    // Revisi: kustomisasi + save/load + orientasi.
    setCustom: (custom, gender) => game.applyCustom(custom, gender),
    getCustom: () => JSON.parse(JSON.stringify(game.state.custom)),
    saveNow: () => game.saveNow(),
    loadNow: () => game.loadNow(),
    cloudSync: () => game.cloudSync(),
    getSessionUser: () => (game.session ? game.session.username : null),
    isOfflineMode: () => game.offlineMode,
    checkOrientation: () => {
      game.checkOrientation();
      return !document.getElementById('orientation-overlay').classList.contains('hidden');
    },
    isPortraitViewport: () => window.innerWidth < window.innerHeight,
  };
  window.__LH = {
    get state() { return game.state; },
    get player() { return game.player; },
    get farm() { return game.farm; },
    get animals() { return game.animals; },
    get economy() { return { coins: game.state.coins, inv: game.state.inv }; },
    get time() { return { day: game.state.day, minutes: game.state.minutes }; },
    api,
  };
  return window.__LH;
}
