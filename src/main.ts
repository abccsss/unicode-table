import { app, BrowserWindow, ipcMain, Menu, MenuItem } from 'electron';
import UnicodeData from './unicode-data/unicode-data';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) { // eslint-disable-line global-require
    app.quit();
}

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow: any;

// Create the menu
const menu = Menu.buildFromTemplate([
    {
        label: "Edit",
        submenu: [
            { role: 'undo', click: (_, browserWindow) => { browserWindow.webContents.send('command', { command: 'undo' }); } },
            { role: 'redo', click: (_, browserWindow) => { browserWindow.webContents.send('command', { command: 'redo' }); } },
            { type: 'separator' },
            { role: 'cut', click: (_, browserWindow) => { browserWindow.webContents.send('command', { command: 'cut' }); } },
            { role: 'copy', click: (_, browserWindow) => { browserWindow.webContents.send('command', { command: 'copy' }); } },
            { role: 'paste', click: (_, browserWindow) => { browserWindow.webContents.send('command', { command: 'paste' }); } },
            { type: 'separator' },
            {
                label: 'Normalise',
                submenu: [
                    { label: 'NFC (Canonical Composition)', click: (_, browserWindow) => { browserWindow.webContents.send('command', { command: 'normalise-nfc' }); } },
                    { label: 'NFD (Canonical Decomposition)', click: (_, browserWindow) => { browserWindow.webContents.send('command', { command: 'normalise-nfd' }); } },
                    { label: 'NFKC (Compatibility Composition)', click: (_, browserWindow) => { browserWindow.webContents.send('command', { command: 'normalise-nfkc' }); } },
                    { label: 'NFKD (Compatibility Decomposition)', click: (_, browserWindow) => { browserWindow.webContents.send('command', { command: 'normalise-nfkd' }); } }
                ]
            }
        ]
    },
    {
        label: "Help",
        submenu: [
            { role: 'about', label: 'About', click: (_, browserWindow) => { browserWindow.webContents.send('command', { command: 'about', versions: process.versions }); } }
        ]
    }
]);
Menu.setApplicationMenu(menu);

// unicode data
let unicodeData = new UnicodeData();

const createWindow = () => {
    // Create the browser window.
    mainWindow = new BrowserWindow({
        width: 1700,
        height: 800,
        frame: false,
        webPreferences: {
            nodeIntegration: true,
        }
    });

    // and load the index.html of the app.
    mainWindow.loadURL(`${__dirname}/../src/index.html`);

    // Open the DevTools.
    mainWindow.webContents.openDevTools();

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
            unicodeData.getBlocksAsync(blocks => {
                event.sender.send('asynchronous-reply', {
                    'type': 'init',
                    'blocks': blocks,
                    'emoji': unicodeData.emojiData,
                    'is-mac': process.platform === 'darwin'
                });
            });
            break;
        case 'get-char':
            var code = arg['code'];
            unicodeData.getCharAsync(code, char => {
                event.sender.send('asynchronous-reply', {
                    'type': 'get-char',
                    'char': {
                        'age': char.getAge(),
                        'cross-references': char.cf,
                        'code': char.code,
                        'type': char.type,
                        'html': char.html,
                        'latex': char.latex,
                        'name': char.name,
                        'is-emoji': char.emoji,
                        'general-category': char.getGeneralCategory()
                    },
                    'sender-position': arg['sender-position']
                });
            });
            break;
        case 'get-char-name':
            var code = arg['code'];
            unicodeData.getCharAsync(code, char => {
                event.sender.send('asynchronous-reply', {
                    'type': 'get-char-name',
                    'char': {
                        'code': char.code,
                        'name': char.name,
                        'is-emoji': char.emoji,
                    }
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
                            'code': char.code,
                            'type': char.type,
                            'is-emoji': char.emoji
                        })
                    }
                    else {
                        arr.push({
                            'code': i,
                            'type': i % 0x10000 >= 0xfffe ? 'noncharacter' : 'reserved'
                        });
                    }
                }

                event.sender.send('asynchronous-reply', {
                    'type': 'get-row',
                    'code': code,
                    'chars': arr
                });
            });
            break;
        case 'search':
            unicodeData.search(arg['query'], results => {
                event.sender.send('asynchronous-reply', {
                    'type': 'search',
                    'query': arg['query'],
                    'results': results
                });
            });
            break;
    }
});
