// Runs PvPoke's own browser JS headless in a Node vm. Dev-only oracle; never imported by src/.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const FILES = [
  'GameMaster.js', 'pokemon/Pokemon.js', 'pokemon/Player.js', 'battle/DamageCalculator.js',
  'battle/timeline/TimelineEvent.js', 'battle/timeline/TimelineAction.js', 'training/DecisionOption.js',
  'battle/actions/ActionLogic.js', 'battle/Battle.js',
];

/** Load PvPoke from a checkout's src/ directory and return its simulate, moveMeta, shieldTrace, shieldAt and ivCombinations probes. */
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
    function __moveInfo(p) {
      return {
        active: p.activeChargedMoves.map(function (m) { return m.moveId; }),
        best: p.bestChargedMove ? p.bestChargedMove.moveId : null,
        fastest: p.fastestChargedMove ? p.fastestChargedMove.moveId : null,
        charged: p.chargedMoves.filter(function (m) { return m; }).map(function (m) {
          return { id: m.moveId, damage: m.damage, dpe: m.dpe, selfDebuffing: !!m.selfDebuffing, hasBuffs: !!m.buffs };
        }),
      };
    }
    function __moveMeta(req) {
      var b = new Battle(); b.setCP(1500);
      var a = __mk(b, req.a, 0, 0, false), z = __mk(b, req.b, 1, 0, false);
      b.setNewPokemon(a, 0, false); b.setNewPokemon(z, 1, false);
      b.start();
      return JSON.stringify([__moveInfo(a), __moveInfo(z)]);
    }
    function __snapSide(p) {
      return {
        hp: p.hp, energy: p.energy, shields: p.shields, buffs: [p.statBuffs[0], p.statBuffs[1]],
        fastDamage: p.fastMove.damage,
        chargedDamage: p.chargedMoves.filter(function (m) { return m; }).map(function (m) { return m.damage; }),
      };
    }
    // Wrap wouldShield once; it only records while a traced useMove has a pending charged move.
    var __pending = null;
    var __origWouldShield = ActionLogic.wouldShield;
    ActionLogic.wouldShield = function (battle, attacker, defender, move) {
      var capture = __pending && !__pending.sides && __pending.move === move;
      var sides = capture ? battle.getPokemon().map(__snapSide) : null;
      var res = __origWouldShield.call(ActionLogic, battle, attacker, defender, move);
      if (capture) { __pending.sides = sides; __pending.wouldShield = res.value; }
      return res;
    };
    function __shieldTrace(req) {
      var b = new Battle(); b.setCP(1500);
      var a = __mk(b, req.a, 0, req.shields[0], false), z = __mk(b, req.b, 1, req.shields[1], false);
      if (req.baitShields) { a.baitShields = req.baitShields[0]; z.baitShields = req.baitShields[1]; }
      b.setNewPokemon(a, 0, false); b.setNewPokemon(z, 1, false);
      var decisions = [];
      var origUseMove = b.useMove;
      b.useMove = function (attacker, defender, move) {
        var before = defender.shields;
        __pending = move.category === 'charged' ? { move: move, sides: null, wouldShield: null } : null;
        var r = origUseMove.apply(this, arguments);
        if (__pending && __pending.sides) {
          decisions.push({
            turn: b.getTurns(), attacker: attacker.index, moveIndex: attacker.chargedMoves.indexOf(move),
            sides: __pending.sides, wouldShield: __pending.wouldShield, shielded: defender.shields < before,
          });
        }
        __pending = null;
        return r;
      };
      b.simulate();
      return JSON.stringify(decisions);
    }
    // Battle.start, override the given fields, then run PvPoke's own Battle.useMove for one charged move.
    function __shieldAt(req) {
      var b = new Battle(); b.setCP(1500);
      var mons = [__mk(b, req.a, 0, req.shields[0], false), __mk(b, req.b, 1, req.shields[1], false)];
      if (req.baitShields) { mons[0].baitShields = req.baitShields[0]; mons[1].baitShields = req.baitShields[1]; }
      b.setNewPokemon(mons[0], 0, false); b.setNewPokemon(mons[1], 1, false);
      b.start();
      for (var i = 0; i < 2; i++) {
        mons[i].energy = req.energy[i];
        if (req.hp) mons[i].hp = req.hp[i];
        if (req.buffs) mons[i].statBuffs = [req.buffs[i][0], req.buffs[i][1]];
      }
      var attacker = mons[req.attacker], defender = mons[1 - req.attacker];
      var move = attacker.chargedMoves[req.moveIndex];
      var before = defender.shields;
      __pending = { move: move, sides: null, wouldShield: null };
      b.useMove(attacker, defender, move);
      var out = { damage: move.damage, sides: __pending.sides, wouldShield: __pending.wouldShield, shielded: defender.shields < before };
      __pending = null;
      return JSON.stringify(out);
    }
    // PvPoke's full IV ranking (Pokemon.generateIVCombinations sorted by "overall") for one species.
    function __ivCombinations(req) {
      var b = new Battle(); b.setCP(req.cap);
      var p = new Pokemon(req.speciesId, 0, b);
      p.initialize(req.cap);
      if (req.chargedMoveIds) {
        for (var i = 0; i < 2; i++) p.selectMove('charged', req.chargedMoveIds[i] || 'none', i);
      }
      return JSON.stringify({
        chargedMoveIds: p.chargedMoves.filter(function (m) { return m; }).map(function (m) { return m.moveId; }),
        combinations: p.generateIVCombinations('overall', 1, 4096, undefined, req.ivFloor).map(function (c) {
          return [c.ivs.atk, c.ivs.def, c.ivs.hp, c.level];
        }),
      });
    }
  `, ctx);

  const run = (fn, req) => {
    ctx.__req = req;
    return JSON.parse(vm.runInContext(`${fn}(__req)`, ctx));
  };
  return {
    simulate: (req) => run('__simulate', req),
    moveMeta: (req) => run('__moveMeta', req),
    shieldTrace: (req) => run('__shieldTrace', req),
    shieldAt: (req) => run('__shieldAt', req),
    ivCombinations: (req) => run('__ivCombinations', req),
  };
}

module.exports = { createPvpoke };
