'use strict';

/** There is no filesystem in the browser build — this describes where data lives. */
function paths() {
  return {
    root: 'this browser, on this computer',
    data: 'IndexedDB → medv → medbill.db',
    backups: 'your Downloads folder (when you press Backup)',
    exports: 'your Downloads folder',
    db: 'IndexedDB: medv / medbill.db'
  };
}

module.exports = {
  configure: () => paths(),
  paths,
  base: () => 'browser storage',
  dataDir: () => 'browser storage',
  backupDir: () => 'Downloads',
  exportDir: () => 'Downloads',
  dbFile: () => 'IndexedDB: medv / medbill.db',
  defaultRoot: () => 'browser storage'
};
