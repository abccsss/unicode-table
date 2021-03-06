import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import UnicodeData from './unicode-data/unicode-data';

// Whether is in development environment
let isDev = !app.isPackaged;

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow: BrowserWindow;

// Versions to be shown in the about dialog
let versions = process.versions;
versions['app'] = '0.1.0';
versions['unicode-full'] = '12.1 (May 2019)';

// Create the menu
const menu = Menu.buildFromTemplate([
    {
        label: 'Edit',
        submenu: [
            {
                role: 'undo',
                click: (_, browserWindow) => {
                    browserWindow.webContents.send('command', {
                        command: 'undo',
                    });
                },
            },
            {
                role: 'redo',
                click: (_, browserWindow) => {
                    browserWindow.webContents.send('command', {
                        command: 'redo',
                    });
                },
            },
            { type: 'separator' },
            {
                role: 'cut',
                click: (_, browserWindow) => {
                    browserWindow.webContents.send('command', {
                        command: 'cut',
                    });
                },
            },
            {
                role: 'copy',
                click: (_, browserWindow) => {
                    browserWindow.webContents.send('command', {
                        command: 'copy',
                    });
                },
            },
            {
                role: 'paste',
                click: (_, browserWindow) => {
                    browserWindow.webContents.send('command', {
                        command: 'paste',
                    });
                },
            },
            { type: 'separator' },
            {
                label: 'Normalise',
                submenu: [
                    {
                        label: 'NFC (Canonical Composition)',
                        click: (_, browserWindow) => {
                            browserWindow.webContents.send('command', {
                                command: 'normalise-nfc',
                            });
                        },
                    },
                    {
                        label: 'NFD (Canonical Decomposition)',
                        click: (_, browserWindow) => {
                            browserWindow.webContents.send('command', {
                                command: 'normalise-nfd',
                            });
                        },
                    },
                    {
                        label: 'NFKC (Compatibility Composition)',
                        click: (_, browserWindow) => {
                            browserWindow.webContents.send('command', {
                                command: 'normalise-nfkc',
                            });
                        },
                    },
                    {
                        label: 'NFKD (Compatibility Decomposition)',
                        click: (_, browserWindow) => {
                            browserWindow.webContents.send('command', {
                                command: 'normalise-nfkd',
                            });
                        },
                    },
                ],
            },
        ],
    },
    {
        label: 'Help',
        submenu: [
            {
                role: 'about',
                label: 'About',
                click: (_, browserWindow) => {
                    browserWindow.webContents.send('command', {
                        command: 'about',
                        versions: process.versions,
                    });
                },
            },
        ],
    },
]);
Menu.setApplicationMenu(menu);

// unicode data
let unicodeData = new UnicodeData(`${__dirname}/../resources/unicode`);

const createWindow = () => {
    // Create the browser window.
    mainWindow = new BrowserWindow({
        width: isDev ? 1700 : 1100,
        height: 800,
        frame: false,
        webPreferences: {
            nodeIntegration: true,
            enableRemoteModule: true,
        },
    });

    // and load the index.html of the app.
    mainWindow.loadFile(`${__dirname}/../src/index.html`);

    // Open the DevTools.
    if (isDev) {
        mainWindow.webContents.openDevTools();
    }

    // Emitted when the window is closed.
    mainWindow.on('closed', () => {
        // Dereference the window object, usually you would store windows
        // in an array if your app supports multi windows, this is the time
        // when you should delete the corresponding element.
        mainWindow = null;
    });
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow);

// Quit when all windows are closed.
app.on('window-all-closed', () => {
    // On OS X it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (mainWindow === null) {
        createWindow();
    }
});

// ipc for unicode data
ipcMain.on('asynchronous-message', (event, arg) => {
    switch (arg['type']) {
        case 'init':
            unicodeData.getBlocksAsync((blocks) => {
                event.sender.send('asynchronous-reply', {
                    type: 'init',
                    blocks: blocks,
                    emoji: unicodeData.emojiData,
                    sequences: unicodeData.sequenceData,
                    palettes: unicodeData.paletteData,
                    'is-mac': process.platform === 'darwin',
                });
            });
            break;
        case 'get-char':
            var code = arg['code'];
            unicodeData.getCharAsync(code, (char) => {
                event.sender.send('asynchronous-reply', {
                    type: 'get-char',
                    char: {
                        age: char.getAge(),
                        'cross-references': char.cf,
                        code: char.code,
                        type: char.type,
                        html: char.html,
                        latex: char.latex,
                        name: char.name,
                        'is-emoji': char.emoji,
                        'general-category': char.getGeneralCategory(),
                        'k-definition': char.kd,
                        'k-mandarin': char.kc,
                        'k-japanese-on': char.kjo,
                        'k-japanese-kun': char.kjk,
                        'k-korean': char.kk,
                        'k-vietnamese': char.kv,
                        'k-variants': char.ky,
                    },
                    'sender-position': arg['sender-position'],
                });
            });
            break;
        case 'get-char-name':
            var code = arg['code'];
            unicodeData.getCharAsync(code, (char) => {
                event.sender.send('asynchronous-reply', {
                    type: 'get-char-name',
                    char: {
                        code: char.code,
                        name: char.name,
                        'is-emoji': char.emoji,
                    },
                });
            });
            break;
        case 'get-row':
            var code = arg['code'];
            code = Math.floor(code / 0x10) * 0x10;

            unicodeData.getCharAsync(code, (_char, hundred) => {
                var arr = [];
                for (var i = code; i < code + 0x10; i++) {
                    if (hundred) {
                        var char = hundred[i % 0x100];
                        arr.push({
                            code: char.code,
                            type: char.type,
                            'is-emoji': char.emoji,
                        });
                    } else {
                        arr.push({
                            code: i,
                            type:
                                i % 0x10000 >= 0xfffe
                                    ? 'noncharacter'
                                    : 'reserved',
                        });
                    }
                }

                event.sender.send('asynchronous-reply', {
                    type: 'get-row',
                    code: code,
                    chars: arr,
                });
            });
            break;
        case 'init-search':
            unicodeData.search('', () => {});
            break;
        case 'search':
            unicodeData.search(arg['query'], (results) => {
                event.sender.send('asynchronous-reply', {
                    type: 'search',
                    query: arg['query'],
                    results: results,
                });
            });
            break;
    }
});
