/**
 * Цвета системной полоски окна под каждую тему OPS.
 * color / symbolColor — Win/Linux (полоска + иконки кнопок).
 * scheme — light|dark для nativeTheme на Mac (системный хром вокруг светофоров).
 * На Mac сами кружки Apple не перекрашиваются — красится фон полоски.
 */
const THEME_CHROME = {
  rose: {
    color: '#1a0f1c',
    symbolColor: '#fceef8',
    backgroundColor: '#120a14',
    scheme: 'dark',
  },
  dark: {
    color: '#0f0f10',
    symbolColor: '#f4f4f5',
    backgroundColor: '#0a0a0b',
    scheme: 'dark',
  },
  light: {
    color: '#fbf7fa',
    symbolColor: '#1f1220',
    backgroundColor: '#f7f2f6',
    scheme: 'light',
  },
  ocean: {
    color: '#0a1a26',
    symbolColor: '#e8f4fb',
    backgroundColor: '#07131c',
    scheme: 'dark',
  },
  mint: {
    color: '#f5fbf7',
    symbolColor: '#122018',
    backgroundColor: '#f0f7f3',
    scheme: 'light',
  },
  amber: {
    color: '#fbf6ee',
    symbolColor: '#2a1e12',
    backgroundColor: '#f8f3ea',
    scheme: 'light',
  },
  slate: {
    color: '#121820',
    symbolColor: '#e8edf4',
    backgroundColor: '#0e1218',
    scheme: 'dark',
  },
  crimson: {
    color: '#1a0c12',
    symbolColor: '#fde8ee',
    backgroundColor: '#14080c',
    scheme: 'dark',
  },
  nord: {
    color: '#131a22',
    symbolColor: '#e6edf5',
    backgroundColor: '#0f1419',
    scheme: 'dark',
  },
  latte: {
    color: '#f7f2ea',
    symbolColor: '#2c241c',
    backgroundColor: '#f3eee6',
    scheme: 'light',
  },
  indigo: {
    color: '#121428',
    symbolColor: '#eceaf8',
    backgroundColor: '#0c0e1c',
    scheme: 'dark',
  },
  ember: {
    color: '#1a100c',
    symbolColor: '#fdeee4',
    backgroundColor: '#140c08',
    scheme: 'dark',
  },
  forest: {
    color: '#0e1a14',
    symbolColor: '#e6f5ec',
    backgroundColor: '#0a120e',
    scheme: 'dark',
  },
  graphite: {
    color: '#16181c',
    symbolColor: '#eceef0',
    backgroundColor: '#101214',
    scheme: 'dark',
  },
  orchid: {
    color: '#faf4fb',
    symbolColor: '#2a1830',
    backgroundColor: '#f7f0f8',
    scheme: 'light',
  },
  peach: {
    color: '#fcf6f2',
    symbolColor: '#2c1e18',
    backgroundColor: '#faf3ee',
    scheme: 'light',
  },
  sky: {
    color: '#f4f8fc',
    symbolColor: '#142030',
    backgroundColor: '#eef4fa',
    scheme: 'light',
  },
};

const OVERLAY_HEIGHT = 36;

function chromeFor(themeId) {
  return THEME_CHROME[themeId] || THEME_CHROME.rose;
}

/** Win / Linux — полный overlay с цветом кнопок. */
function overlayOptions(themeId) {
  const c = chromeFor(themeId);
  return {
    color: c.color,
    symbolColor: c.symbolColor,
    height: OVERLAY_HEIGHT,
  };
}

/** macOS — только высота (цвет кнопок OS не отдаёт). */
function overlayOptionsMac() {
  return { height: OVERLAY_HEIGHT };
}

module.exports = {
  THEME_CHROME,
  OVERLAY_HEIGHT,
  chromeFor,
  overlayOptions,
  overlayOptionsMac,
};
