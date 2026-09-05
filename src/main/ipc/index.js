/**
 * Loads every IPC module. Each one registers its own handlers on require, so
 * this file is simply the list of what the renderer is allowed to ask for.
 */
require('./settings');
require('./servers');
require('./localisation');
require('./updates');
require('./tray-wake');
require('./network');
require('./dialogs');
require('./installer');
require('./server');
require('./files');
require('./tunnel');
require('./properties');
require('./gamerules');
require('./players');
require('./backups');
require('./worlds');
require('./mods');
require('./modrinth');
require('./datapacks');
require('./scheduler');
