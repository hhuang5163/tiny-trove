// Generic stick-figure pose sketches, shown until a photo exists for a figure.
// They're simple stand-ins keyed by words in the figure's English name, not drawings of the real figures.
(function () {
  const c = (x, y, r) => `M${x - r} ${y} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0`;
  const P = {
    stand: c(16, 9, 3.2) + ' M16 12 V21 M16 21 L12.5 28 M16 21 L19.5 28 M16 15 L11 18 M16 15 L21 18',
    sit: c(11, 9, 3) + ' M11 12 L12 20 M12 20 H21 L22 27 M11.5 15 L17 18',
    knees: c(13, 10, 3) + ' M13 13 L15 22 M15 22 L21 17 L20 25 M14 16 L20 18',
    lie: c(7, 22, 3) + ' M10 22 H22 M22 22 L28 24 M22 22 L28 20 M13 22 L15 19',
    sleep: c(7, 22, 3) + ' M10 22 H22 M22 22 L28 24 M22 22 L28 20 M13 22 L15 19 M20 7 H24 L20 11 H24',
    peek: 'M3 14 H17 V29 ' + c(21, 11, 3) + ' M18 16 L21 15 M21 14 V24',
    hide: 'M4 12 H20 V29 ' + c(23, 17, 3) + ' M21 22 L23 20',
    lift: c(16, 8, 3) + ' M16 11 V21 M16 21 L12 29 M16 21 L20 29 M16 14 L10 6 M16 14 L22 6 M6 5 H26',
    think: c(14, 8, 3) + ' M14 11 V21 M14 21 L11 29 M14 21 L17 29 M14 14 L19 14 L17 10 M14 14 L10 19',
    dream: c(10, 10, 3) + ' M10 13 L12 21 M12 21 H21 L23 28 M11 16 L17 19 ' + c(22, 7, 1.5) + ' ' + c(26.5, 4.5, 2.2),
    play: c(11, 8, 3) + ' M11 11 L13 20 M13 20 L9 28 M13 20 L18 27 M12 14 L18 12 M12 14 L7 17 ' + c(23, 11, 2.5),
    climb: 'M24 3 V29 ' + c(17, 9, 3) + ' M17 12 L19 20 M19 20 L24 18 M19 20 L16 27 M18 14 L24 11 M18 14 L24 16',
    flip: c(16, 25, 3) + ' M16 22 V12 M16 12 L12 5 M16 12 L20 5 M16 19 L11 26 M16 19 L21 26',
    flower: c(12, 8, 3) + ' M12 11 V21 M12 21 L9 29 M12 21 L15 29 M12 14 L20 15 M12 14 L8 18 M21 29 V12 ' + c(21, 8, 2) + ' ' + c(21, 8, 4.2),
    ball: c(12, 10, 3) + ' M12 13 V22 M12 22 L9 29 M12 22 L15 29 M12 16 L17 13 M12 16 L8 19 ' + c(21, 9, 1.6) + ' ' + c(25, 5, 2.4) + ' ' + c(26, 11, 1.2),
    wave: c(16, 9, 3.2) + ' M16 12 V21 M16 21 L12.5 28 M16 21 L19.5 28 M16 15 L10 9 M16 15 L22 9',
    carry: c(14, 10, 3) + ' M14 13 V22 M14 22 L11 29 M14 22 L17 29 M14 16 L20 14 M20 6 H28 V14 H20 Z',
    small: c(16, 16, 2.4) + ' M16 18.5 V24 M16 24 L13.5 28 M16 24 L18.5 28 M16 20.5 L13 22.5 M16 20.5 L19 22.5',
    two: c(10, 10, 2.6) + ' M10 13 V21 M10 21 L8 27 M10 21 L12 27 M10 15 L15 17 ' + c(22, 10, 2.6) + ' M22 13 V21 M22 21 L20 27 M22 21 L24 27 M22 15 L17 17'
  };
  const RULES = [
    [/sleep|nap|dozing|at sleep|lounging|lazy|laid back|floating|rest/i, 'sleep'],
    [/sunflower|garden|bouquet|green thumb/i, 'flower'],
    [/bubble|balloon|confetti/i, 'ball'],
    [/peek|looking out|look/i, 'peek'],
    [/hid|sneak|stuck|curled/i, 'hide'],
    [/lift|dumbbell|carrying|box|wrapped|present/i, 'lift'],
    [/think|idea|research|reading|message/i, 'think'],
    [/dream|daydream|sunbath|relax/i, 'dream'],
    [/play|drum|march|sing|skate|aerob|hoop|dance|cheer|music/i, 'play'],
    [/climb|trying/i, 'climb'],
    [/handstand|upside|bridge|shoulderstand|flip|diving|falling/i, 'flip'],
    [/sit|kneel|squat|lotus|twist|toilet|holding/i, 'sit'],
    [/hug|knees/i, 'knees'],
    [/little|mini|chibi/i, 'small'],
    [/twin|two|fujin|teamwork|co-sleep/i, 'two'],
    [/ladder|carry|smartphone/i, 'carry'],
    [/wave|stretch|approv|cheering/i, 'wave'],
  ];
  window.TroveSketch = function (name) {
    for (const [re, key] of RULES) if (re.test(name)) return P[key];
    return P.stand;
  };
})();
