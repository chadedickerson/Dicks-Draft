// Fantasy playoff (NFL weeks 15-17) schedules & matchup favorability.
// Opponents: Establish The Run 2026 playoff schedules. Favorability ("fav",
// higher = easier matchup) and overall rank (1 = most favorable playoff
// schedule of 32): Fantasy Team Advice playoff SOS. Fetched Aug 14, 2026.
// fav is offense-generic (not positional) — treat as approximate.
const PLAYOFF_SOS = {
  JAC: { rank: 1,  sos:  7.9, w: [{ opp: '@HOU', fav: -14.1 }, { opp: '@DAL', fav: 22.5 }, { opp: 'WAS',  fav: 14.2 }] },
  MIN: { rank: 2,  sos:  6.9, w: [{ opp: 'DET',  fav: 3.9 },  { opp: 'WAS',  fav: 14.2 }, { opp: '@NYJ', fav: 9.6 }] },
  LAR: { rank: 3,  sos:  5.5, w: [{ opp: 'DAL',  fav: 22.5 }, { opp: '@SEA', fav: -9.4 }, { opp: '@TB',  fav: 4.0 }] },
  TEN: { rank: 4,  sos:  4.9, w: [{ opp: 'IND',  fav: 7.1 },  { opp: '@LV',  fav: -0.2 }, { opp: 'PIT',  fav: 8.8 }] },
  BAL: { rank: 5,  sos:  4.6, w: [{ opp: '@PIT', fav: 8.8 },  { opp: 'CLE',  fav: -7.6 }, { opp: '@CIN', fav: 13.0 }] },
  CLE: { rank: 6,  sos:  4.0, w: [{ opp: '@NYG', fav: 5.6 },  { opp: '@BAL', fav: 4.3 },  { opp: 'IND',  fav: 7.1 }] },
  NYG: { rank: 7,  sos:  2.4, w: [{ opp: 'CLE',  fav: -7.6 }, { opp: '@DET', fav: 3.9 },  { opp: '@DAL', fav: 22.5 }] },
  KC:  { rank: 8,  sos:  1.6, w: [{ opp: 'NE',   fav: 0.0 },  { opp: 'SF',   fav: 4.9 },  { opp: '@LAC', fav: -11.3 }] },
  BUF: { rank: 9,  sos:  1.3, w: [{ opp: 'CHI',  fav: 7.7 },  { opp: '@DEN', fav: -8.1 }, { opp: '@MIA', fav: 8.7 }] },
  CAR: { rank: 10, sos:  1.1, w: [{ opp: 'CIN',  fav: 13.0 }, { opp: '@PIT', fav: 8.8 },  { opp: 'SEA',  fav: -9.4 }] },
  LAC: { rank: 11, sos:  0.8, w: [{ opp: 'SF',   fav: 4.9 },  { opp: '@MIA', fav: 8.7 },  { opp: 'KC',   fav: -10.2 }] },
  ATL: { rank: 12, sos:  0.6, w: [{ opp: '@WAS', fav: 14.2 }, { opp: 'TB',   fav: 4.0 },  { opp: 'NO',   fav: -8.1 }] },
  CHI: { rank: 13, sos:  0.6, w: [{ opp: '@BUF', fav: -7.4 }, { opp: 'GB',   fav: -3.0 }, { opp: 'DET',  fav: 3.9 }] },
  DAL: { rank: 14, sos:  0.7, w: [{ opp: '@LAR', fav: -1.9 }, { opp: 'JAC',  fav: -1.5 }, { opp: 'NYG',  fav: 5.6 }] },
  DEN: { rank: 15, sos:  0.5, w: [{ opp: '@LV',  fav: -0.2 }, { opp: 'BUF',  fav: -7.4 }, { opp: '@NE',  fav: 0.0 }] },
  PIT: { rank: 16, sos:  0.4, w: [{ opp: 'BAL',  fav: 4.3 },  { opp: 'CAR',  fav: -6.7 }, { opp: '@TEN', fav: 5.5 }] },
  ARI: { rank: 17, sos:  0.4, w: [{ opp: 'NYJ',  fav: 9.6 },  { opp: '@NO',  fav: -8.1 }, { opp: 'LV',   fav: -0.2 }] },
  NO:  { rank: 18, sos:  0.3, w: [{ opp: '@TB',  fav: 4.0 },  { opp: 'ARI',  fav: 5.0 },  { opp: '@ATL', fav: -1.0 }] },
  DET: { rank: 19, sos: -0.5, w: [{ opp: '@MIN', fav: -20.5 }, { opp: 'NYG', fav: 5.6 },  { opp: '@CHI', fav: 7.7 }] },
  IND: { rank: 20, sos: -0.7, w: [{ opp: '@TEN', fav: 5.5 },  { opp: 'CIN',  fav: 13.0 }, { opp: '@CLE', fav: -7.6 }] },
  HOU: { rank: 21, sos: -1.0, w: [{ opp: 'JAC',  fav: -1.5 }, { opp: '@PHI', fav: -13.8 }, { opp: '@GB', fav: -3.0 }] },
  GB:  { rank: 22, sos: -1.3, w: [{ opp: 'MIA',  fav: 8.7 },  { opp: '@CHI', fav: 7.7 },  { opp: 'HOU', fav: -14.1 }] },
  CIN: { rank: 23, sos: -1.4, w: [{ opp: '@CAR', fav: -6.7 }, { opp: '@IND', fav: 7.1 },  { opp: 'BAL', fav: 4.3 }] },
  TB:  { rank: 24, sos: -1.7, w: [{ opp: 'NO',   fav: -8.1 }, { opp: '@ATL', fav: -1.0 }, { opp: 'LAR', fav: -1.9 }] },
  LV:  { rank: 25, sos: -2.2, w: [{ opp: 'DEN',  fav: -8.1 }, { opp: 'TEN',  fav: 5.5 },  { opp: '@ARI', fav: 5.0 }] },
  PHI: { rank: 26, sos: -2.9, w: [{ opp: 'SEA',  fav: -9.4 }, { opp: 'HOU',  fav: -14.1 }, { opp: '@SF', fav: 4.9 }] },
  MIA: { rank: 27, sos: -3.5, w: [{ opp: '@GB',  fav: -3.0 }, { opp: 'LAC',  fav: -11.3 }, { opp: 'BUF', fav: -7.4 }] },
  SEA: { rank: 28, sos: -4.2, w: [{ opp: '@PHI', fav: -13.8 }, { opp: 'LAR', fav: -1.9 }, { opp: '@CAR', fav: -6.7 }] },
  NYJ: { rank: 29, sos: -5.9, w: [{ opp: '@ARI', fav: 5.0 },  { opp: 'NE',   fav: 0.0 },  { opp: 'MIN', fav: -20.5 }] },
  NE:  { rank: 30, sos: -7.3, w: [{ opp: '@KC',  fav: -10.2 }, { opp: '@NYJ', fav: 9.6 }, { opp: 'DEN', fav: -8.1 }] },
  WAS: { rank: 31, sos: -9.3, w: [{ opp: 'ATL',  fav: -1.0 }, { opp: '@MIN', fav: -20.5 }, { opp: '@JAC', fav: -1.5 }] },
  SF:  { rank: 32, sos: -9.3, w: [{ opp: '@LAC', fav: -11.3 }, { opp: '@KC', fav: -10.2 }, { opp: 'PHI', fav: -13.8 }] },
};
const PLAYOFF_WEEKS = [15, 16, 17];
if (typeof module !== 'undefined') module.exports = { PLAYOFF_SOS, PLAYOFF_WEEKS };
