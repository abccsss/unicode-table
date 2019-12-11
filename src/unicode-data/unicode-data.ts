import { createReadStream, existsSync, writeFileSync, readFile, readFileSync, read } from 'fs';
import { createInterface } from "readline";
var XmlStream = require('xml-stream');

function toHex(code: number): string {
    if (code < 0 || code > 0x10FFFF) {
        throw 'toHex: char code out of range.';
    }
    var hex = Math.floor(code).toString(16).toUpperCase();
    while (hex.length < 4) hex = '0' + hex;
    return hex;
}

const gcName = {'Cc':'Control','Cf':'Format','Cn':'Unassigned','Co':'Private Use','Cs':'Surrogate','Ll':'Lowercase Letter','Lm':'Modifier Letter','Lo':'Other Letter','Lt':'Titlecase Letter','Lu':'Uppercase Letter','Mc':'Spacing Mark','Me':'Enclosing Mark','Mn':'Nonspacing Mark','Nd':'Decimal Number','Nl':'Letter Number','No':'Other Number','Pc':'Connector Punctuation','Pd':'Dash Punctuation','Pe':'Close Punctuation','Pf':'Final Punctuation','Pi':'Initial Punctuation','Po':'Other Punctuation','Ps':'Open Punctuation','Sc':'Currency Symbol','Sk':'Modifier Symbol','Sm':'Math Symbol','So':'Other Symbol','Zl':'Line Separator','Zp':'Paragraph Separator','Zs':'Space Separator'}
const ageName = {'2.0':'Unicode 2.0 (1996)','2.1':'Unicode 2.1 (1998)','3.0':'Unicode 3.0 (1999)','3.1':'Unicode 3.1 (2001)','3.2':'Unicode 3.2 (2002)','4.0':'Unicode 4.0 (2003)','4.1':'Unicode 4.1 (2005)','5.0':'Unicode 5.0 (2006)','5.1':'Unicode 5.1 (2008)','5.2':'Unicode 5.2 (2009)','6.0':'Unicode 6.0 (2010)','6.1':'Unicode 6.1 (2012)','6.2':'Unicode 6.2 (2012)','6.3':'Unicode 6.3 (2013)','7.0':'Unicode 7.0 (2014)','8.0':'Unicode 8.0 (2015)','9.0':'Unicode 9.0 (2016)','10.0':'Unicode 10.0 (2017)','11.0':'Unicode 11.0 (2018)','12.0':'Unicode 12.0 (2019)','12.1':'Unicode 12.1 (2019)'};

export class UnicodeCharacter {
    age?: string;
    cf?: string[];
    code: number;
    decomp?: string;    // decomposition
    emoji?: boolean;
    gc: string;         // general category
    html?: string[];
    latex?: string[];
    name?: string;
    type: 'char' | 'noncharacter' | 'reserved' | 'surrogate';

    constructor(data: {
        age?: string,
        cf?: string[],
        code: number,
        decomp?: string,
        emoji?: boolean,
        gc: string,
        html?: string[],
        latex?: string[];
        name?: string,
        type: 'char' | 'noncharacter' | 'reserved' | 'surrogate',
    }) {
        this.age = data.age;
        this.cf = data.cf;
        this.code = data.code;
        this.decomp = data.decomp;
        this.emoji = data.emoji;
        this.gc = data.gc;
        this.html = data.html;
        this.latex = data.latex;
        this.name = data.name;
        this.type = data.type;
    }

    getAge(): string {
        return ageName[this.age];
    }

    getGeneralCategory(): string {
        return gcName[this.gc];
    }

    addHtml(html: string) {
        if (!this.html) this.html = [];
        this.html.push(html);
    }

    addLatex(latex: string) {
        if (!this.latex) this.latex = [];
        this.latex.push(latex);
    }
}

export class UnicodeBlock {
    firstCode: number;
    lastCode: number;
    name: string;
}

export default class UnicodeData {
    charData: UnicodeCharacter[][] = [];
    blockData: UnicodeBlock[];
    emojiData: number[];

    // is not undefined only when initialising
    onInitialised: (() => void)[] = [];

    constructor(creatingDataFiles?: boolean) { 
        if (!creatingDataFiles)
            createDataFiles();
        if (existsSync(`./resources/unicode/ucd.emoji.json`)) {
            readFile(`./resources/unicode/ucd.emoji.json`, (_err, data) => {
                this.emojiData = JSON.parse(data.toString());
            });
        }
    }

    getBlocksAsync(callback: (blocks: UnicodeBlock[]) => void): void {
        if (!this.blockData) {
            this.blockData = [];
            var jsonPath = `./resources/unicode/ucd.blocks.json`;
            readFile(jsonPath, (_err, data) => {
                this.blockData = JSON.parse(data.toString());
                callback(this.blockData);
            });
            return;
        }
        callback(this.blockData);
    }

    getCharAsync(code: number, callback: (char: UnicodeCharacter, hundred: UnicodeCharacter[]) => void): void {
        if (code < 0 || code > 0x10FFFF) {
            throw 'char code out of range.';
        }
        var hundred = Math.floor(code / 0x100);

        // another thread is initialising
        if (this.onInitialised[hundred]) {
            var temp = this.onInitialised[hundred];
            this.onInitialised[hundred] = () => {
                temp();
                callback(this.charData[hundred][code % 0x100], this.charData[hundred]);
            }
            return;
        }

        // the hundred is not initialised, initialise it
        if (!this.charData[hundred]) {
            this.charData[hundred] = [];

            var jsonPath = `./resources/unicode/ucd.${toHex(hundred * 0x100)}.json`;
            if (existsSync(jsonPath)) {
                this.onInitialised[hundred] = () => {
                    callback(this.charData[hundred][code % 0x100], this.charData[hundred]);
                }

                readFile(jsonPath, (_err, data) => {
                    var parsed = JSON.parse(data.toString());

                    for (var i = 0; i < 0x100; i++) {
                        if (parsed[i]) {
                            this.charData[hundred][i] = new UnicodeCharacter(parsed[i]);
                        }
                    }

                    this.onInitialised[hundred]();
                    this.onInitialised[hundred] = undefined;
                })
                return;
            }
        }

        // the hundred is initialised, return the data
        if (this. charData[hundred].length > 0) {
            callback(this.charData[hundred][code % 0x100], this.charData[hundred]);
        }
        else {
            if (code % 0x10000 >= 0xfffe) {
                callback(new UnicodeCharacter({
                    age: '2.0',
                    code: code,
                    type: 'noncharacter',
                    gc: 'Cn'
                }), undefined);
            }
            else {
                callback(new UnicodeCharacter({
                    code: code,
                    type: 'reserved',
                    gc: 'Cn'
                }), undefined);
            }
        }
    }

    // load all data at the same time
    // which is ONLY for creating the data files and never run by the user
    completeInitAsync(callback?: () => void) {
        var stream = createReadStream(`./resources/unicode/raw/ucd.all.flat.xml`);
        var xml = new XmlStream(stream);
        xml.collect('name-alias');
        xml.collect('block');
        xml.on('endElement: char', (item: any) => {
            var code = parseInt(item['$']['cp'], 16); 
            if (isNaN(code)) return;

            var hundred = Math.floor(code / 0x100);
            var name = item['$']['na'].replace('#', item['$']['cp']);

            // choose best name for control chars
            // TODO: if has alias of type 'correction', use it instead of original name
            if (code == 0xa) // line feed
                name = '&lt;control&gt; LINE FEED';
            if (name == '') {
                var abbr = '';
                for (var i = 0; i < item['name-alias'].length; i++) {
                    var subitem = item['name-alias'][i];
                    if (subitem['$']['type'] == 'abbreviation') {
                        if (abbr == '') abbr = subitem['$']['alias']; 
                    }
                    else {
                        if (name == '') name = '&lt;control&gt; ' + subitem['$']['alias'];
                    }
                }
                if (abbr != '') {
                    var regex = '^';
                    for (var i = 0; i < abbr.length; i++)
                        regex += '\\b' + abbr[i] + '.+';
                    var regExp = new RegExp(regex);
                    for (var i = 0; i < item['name-alias'].length; i++) {
                        var subitem = item['name-alias'][i];
                        if (subitem['$']['type'] != 'abbreviation') {
                            if (regExp.test(subitem['$']['alias'])) {
                                name = '&lt;control&gt; ' + subitem['$']['alias'];
                                break;
                            }
                        }
                    }
                }
            }

            if (!this.charData[hundred])
                this.charData[hundred] = [];
            this.charData[hundred][code % 0x100] = new UnicodeCharacter({
                code: code,
                type: 'char',
                name: name,
                gc: item['$']['gc'],
                age: item['$']['age']
            });
        });

        xml.on('endElement: reserved', (item: any) => {
            var start: number, end: number;
            if (item['$']['cp']) {
                start = end = parseInt(item['$']['cp'], 16);
            } else {
                start = parseInt(item['$']['first-cp'], 16);
                end = parseInt(item['$']['last-cp'], 16);
            }
            var startHundred = Math.floor(start / 0x100),
                endHundred = Math.floor(end / 0x100);

            if (!this.charData[startHundred])
                this.charData[startHundred] = [];
            for (var code = start; code <= end && code < (startHundred + 1) * 0x100; code++) {
                this.charData[startHundred][code % 0x100] = new UnicodeCharacter({
                    code: code,
                    gc: 'Cn',
                    type: 'reserved'
                });
            }

            if (endHundred > startHundred &&
                !(end % 0x100 == 0xff || end % 0x10000 == 0xfffd)) {
                if (!this.charData[endHundred])
                    this.charData[endHundred] = [];
                for (var code = endHundred * 0x100; code <= end; code++) {
                    this.charData[endHundred][code % 0x100] = new UnicodeCharacter({
                        code: code,
                        gc: 'Cn',
                        type: 'reserved'
                    });
                }
            }
        });

        // all noncharacters are fdd0--fdef and xfffe--xffff
        xml.on('endElement: noncharacter', (item: any) => {
            var start: number, end: number;
            if (item['$']['cp']) {
                start = end = parseInt(item['$']['cp'], 16);
            } else {
                start = parseInt(item['$']['first-cp'], 16);
                end = parseInt(item['$']['last-cp'], 16);
            }
            var hundred = Math.floor(start / 0x100);

            if (this.charData[hundred]) {
                for (var code = start; code <= end; code++) {
                    this.charData[hundred][code % 0x100] = new UnicodeCharacter({
                        code: code,
                        gc: 'Cn',
                        type: 'noncharacter'
                    });
                }
            }
        });
        
        xml.on('endElement: blocks', (item: any) => {
            var blocks = item['block'];
            this.blockData = [];
            for (var i = 0; i < blocks.length; i++) {
                var block = blocks[i]['$'];
                this.blockData[i] = {
                    firstCode: parseInt(block['first-cp'], 16),
                    lastCode: parseInt(block['last-cp'], 16),
                    name: block['name']
                };
            }
        });

        xml.on('end', () => {
            // read html.json
            var htmlNames = JSON.parse(readFileSync(`./resources/unicode/raw/html.json`).toString());
            htmlNames.forEach((item: any) => {
                if (item['c'].length == 1) {
                    var code = parseInt(item['c'][0], 16);
                    var hundred = Math.floor(code / 0x100);
                    if (this.charData[hundred]) {
                        this.charData[hundred][code % 0x100].html = item['n'];
                    }
                }
            });

            // read latex.json
            var latexNames = JSON.parse(readFileSync(`./resources/unicode/raw/latex.json`).toString());
            latexNames.forEach((item: any) => {
                var code = parseInt(item['c'], 16);
                var hundred = Math.floor(code / 0x100);
                if (this.charData[hundred]) {
                    this.charData[hundred][code % 0x100].latex = item['n'];
                }
            });

            // parse NamesList.txt
            this.parseNamesListAsync(callback);
        });
    }

    parseNamesListAsync(callback?: () => void) {
        var stream = createReadStream(`./resources/unicode/raw/NamesList.txt`);
        var reader = createInterface(stream);

        var code = 0;
        var charHundred: UnicodeCharacter[];

        reader.on('line', input => {
            var result = /^[0-9A-F]+/.exec(input);
            if (result) {
                code = parseInt(result[0], 16);
                charHundred = this.charData[Math.floor(code / 0x100)];
                return;
            }

            if (charHundred) {
                // parse cross refs, marked with 'x'
                if (/^\tx /.test(input)) {
                    var char = charHundred[code % 0x100];
                    if (!char.cf) char.cf = [];

                    result = /\b[0-9A-F]+\b/.exec(input);
                    result.forEach(item => {
                        char.cf.push(item);
                    });
                    char.cf.sort((a, b) => parseInt(a, 16) - parseInt(b, 16));
                }

                // parse decomposition, marked with '#'
                if (/^\t# /.test(input)) {
                    var char = charHundred[code % 0x100];
                    var decomp = '';

                    result = /\b[0-9A-F]+\b/.exec(input);
                    result.forEach(item => {
                        decomp += String.fromCodePoint(parseInt(item, 16));
                    });
                    char.decomp = decomp;
                }
            }
        });

        reader.on('close', () => {
            // parse emoji-data.txt
            var emojiFile = readFileSync(`./resources/unicode/raw/emoji-data.txt`).toString();
            this.emojiData = [];

            emojiFile.match(/(?<=\n|^)[0-9A-F\.]+\b(?= *; Emoji_Presentation)/g).forEach(value => {
                var result = /^([0-9A-F]+)(\.\.([0-9A-F]+))?$/.exec(value);
                var start = parseInt(result[1], 16);
                var end = result[3] ? parseInt(result[3], 16) : start;
                
                for (var code = start; code <= end; code++) {
                    this.emojiData.push(code);
                    var charHundred = this.charData[Math.floor(code / 0x100)];
                    if (charHundred) {
                        charHundred[code % 0x100].emoji = true;
                    }
                }
            })

            callback();
        });
    }
}

function createDataFiles(): void {
    if (existsSync(`./resources/unicode/ucd.0000.json`))
        return;

    var unicodeData = new UnicodeData(true);
    unicodeData.completeInitAsync(() => {
        writeFileSync(`./resources/unicode/ucd.blocks.json`, JSON.stringify(unicodeData.blockData));
        writeFileSync(`./resources/unicode/ucd.emoji.json`, JSON.stringify(unicodeData.emojiData))
        for (var hundred = 0; hundred < 0x10ff; hundred++) {
            if (unicodeData.charData[hundred] && unicodeData.charData[hundred].length > 0) {
                writeFileSync(`./resources/unicode/ucd.${toHex(hundred * 0x100)}.json`, JSON.stringify(unicodeData.charData[hundred]));
            }
        }
    });
}
