// Runs PvPoke's own browser JS headless in a Node vm. Dev-only oracle; never imported by src/.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const FILES = [
  'GameMaster.js', 'pokemon/Pokemon.js', 'pokemon/Player.js', 'battle/DamageCalculator.js',
  'battle/timeline/TimelineEvent.js', 'battle/timeline/TimelineAction.js', 'training/DecisionOption.js',
  'battle/actions/ActionLogic.js', 'battle/Battle.js',
];

/** Load PvPoke from a checkout's src/ directory and return a simulate() function. */
function createPvpoke(srcDir) {
  const gamemaster = JSON.parse(fs.readFileSync(path.join(srcDir, 'data', 'gamemaster.json'), 'utf8'));
  const pending = [];
  // jQuery stub: every DOM call is a no-op chain; $.ajax defers the gamemaster callback.
  const chain = new Proxy(function () {}, { get: (_t, k) => (k === 'length' ? 0 : chain), apply: () => chain });
  const $ = new Proxy(function () { return chain; }, {
    get: (_t, k) => {
      if (k === 'ajax') return (o) => { if (String(o.url).includes('gamemaster')) pending.push(() => o.success(gamemaster)); };
      if (k === 'each') return (arr, fn) => arr.forEach((v, i) => fn(i, v));
      return chain;
    },
    apply: () => chain,
  });
  const ctx = {
    $, jQuery: $, host: 'localhost/', webRoot: '', siteVersion: '1', settings: { gamemaster: 'gamemaster' },
    console: { log() {}, error: console.error, warn() {} }, Math, JSON,
    document: { addEventListener() {} }, setTimeout, clearTimeout, setInterval, clearInterval,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const file of FILES) vm.runInContext(fs.readFileSync(path.join(srcDir, 'js', file), 'utf8'), ctx, { filename: file });
  vm.runInContext('var gm = GameMaster.getInstance();', ctx);
  pending.splice(0).forEach((fn) => fn());

  vm.runInContext(`
    function __mk(battle, mon, index, shields, fastOnly) {
      var p = new Pokemon(mon.speciesId, index, battle);
      p.initialize(1500);
      p.selectMove('fast', mon.moveset[0]);
      p.selectMove('charged', mon.moveset[1], 0);
      if (mon.moveset[2]) p.selectMove('charged', mon.moveset[2], 1); else p.selectMove('charged', 'none', 1);
      p.setShields(shields);
      if (fastOnly) p.farmEnergy = true;
      return p;
    }
    function __simulate(req) {
      var b = new Battle(); b.setCP(1500);
      var fastOnly = req.mode === 'fastOnly';
      var a = __mk(b, req.a, 0, req.shields[0], fastOnly), z = __mk(b, req.b, 1, req.shields[1], fastOnly);
      b.setNewPokemon(a, 0, false); b.setNewPokemon(z, 1, false);
      if (req.mode === 'scripted') {
        b.setSandboxMode(true);
        b.setActions(req.script.map(function (s) {
          return new TimelineAction('charged', s.side, s.turn, s.index, { shielded: s.shielded, buffs: false, priority: 0 });
        }));
      }
      var tl = b.simulate();
      return JSON.stringify({
        ratings: b.getBattleRatings(),
        hp: [a.hp, z.hp],
        events: tl.filter(function (e) { return /^(fast|charged|shield)/.test(e.type); })
          .map(function (e) { return { turn: e.turn, side: e.actor, type: e.type, name: e.name, damage: e.values ? e.values[0] : 0 }; }),
      });
    }
  `, ctx);

  return {
    simulate(req) {
      ctx.__req = req;
      return JSON.parse(vm.runInContext('__simulate(__req)', ctx));
    },
  };
}

module.exports = { createPvpoke };
