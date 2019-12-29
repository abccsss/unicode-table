import { createReadStream, existsSync, writeFileSync, readFile, readFileSync } from 'fs';
import { createInterface } from "readline";
try { var XmlStream = require('xml-stream'); } catch {}

function toHex(code: number): string {
    if (code < 0 || code > 0x10FFFF) {
        throw 'toHex: char code out of range.';
    }
    var hex = Math.floor(code).toString(16).toUpperCase();
    while (hex.length < 4) hex = '0' + hex;
    return hex;
}

const gcName = {'Cc':'Control','Cf':'Format','Cn':'Unassigned','Co':'Private Use','Cs':'Surrogate','Ll':'Lowercase Letter','Lm':'Modifier Letter','Lo':'Other Letter','Lt':'Titlecase Letter','Lu':'Uppercase Letter','Mc':'Spacing Mark','Me':'Enclosing Mark','Mn':'Nonspacing Mark','Nd':'Decimal Number','Nl':'Letter Number','No':'Other Number','Pc':'Connector Punctuation','Pd':'Dash Punctuation','Pe':'Close Punctuation','Pf':'Final Punctuation','Pi':'Initial Punctuation','Po':'Other Punctuation','Ps':'Open Punctuation','Sc':'Currency Symbol','Sk':'Modifier Symbol','Sm':'Math Symbol','So':'Other Symbol','Zl':'Line Separator','Zp':'Paragraph Separator','Zs':'Space Separator'}
const ageName = {'2.0':'Unicode 2.0 (1996)','2.1':'Unicode 2.1 (1998)','3.0':'Unicode 3.0 (1999)','3.1':'Unicode 3.1 (2001)','3.2':'Unicode 3.2 (2002)','4.0':'Unicode 4.0 (2003)','4.1':'Unicode 4.1 (2005)','5.0':'Unicode 5.0 (2006)','5.1':'Unicode 5.1 (2008)','5.2':'Unicode 5.2 (2009)','6.0':'Unicode 6.0 (2010)','6.1':'Unicode 6.1 (2012)','6.2':'Unicode 6.2 (2012)','6.3':'Unicode 6.3 (2013)','7.0':'Unicode 7.0 (2014)','8.0':'Unicode 8.0 (2015)','9.0':'Unicode 9.0 (2016)','10.0':'Unicode 10.0 (2017)','11.0':'Unicode 11.0 (2018)','12.0':'Unicode 12.0 (2019)','12.1':'Unicode 12.1 (2019)','E1.0':'Emoji 1.0 (2015)','E2.0':'Emoji 2.0 (2015)','E3.0':'Emoji 3.0 (2016)','E4.0':'Emoji 4.0 (2016)','E5.0':'Emoji 5.0 (2017)','E11.0':'Emoji 11.0 (2018)','E12.0':'Emoji 12.0 (2019)','E12.1':'Emoji 12.1 (2019)'};

export class UnicodeCharacter {
    age?: string;
    cf?: string[];
    code: number;
    decomp?: string;    // decomposition
    emoji?: boolean;
    gc: string;         // general category
    html?: string[];
    kc?: string;        // Pinyin reading
    kd?: string;        // Unihan definition
    kjo?: string;       // Japanese On reading
    kjk?: string;       // Japanese Kun reading
    kk?: string;        // Korean reading
    kv?: string;        // Vietnamese reading
    ky?: number[];      // y-variant(s)
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
        kc?: string,
        kd?: string,
        kjo?: string,
        kjk?: string,
        kk?: string,
        kv?: string,
        ky?: number[],
        latex?: string[],
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
        this.kd = data.kd;
        this.kc = data.kc;
        this.kjo = data.kjo;
        this.kjk = data.kjk;
        this.kk = data.kk;
        this.kv = data.kv;
        this.ky = data.ky;
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

export class UnicodeCharSet {
    name: string;
    description?: string;
    sections?: UnicodeCharSet[];
    chars?: string[];
}

export class UnicodeSequence {
    age?: string;
    codes: string;
    name: string;
    type: string;
}

export class UnicodeSearchResult {
    type: 'char' | 'sequence';
    codes: number[];
    char?: UnicodeCharacter;
    matchedProperties?: string[];
    relevance: number;
}

const searchSynonyms: string[][] = [
    [ '0', 'zero' ],
    [ '1', 'one' ],
    [ '2', 'two' ],
    [ '3', 'three' ],
    [ '4', 'four' ],
    [ '5', 'five' ],
    [ '6', 'six' ],
    [ '7', 'seven' ],
    [ '8', 'eight' ],
    [ '9', 'nine' ],
    [ '10', 'ten' ],
    [ '11', 'eleven' ],
    [ '12', 'twelve' ],
    [ '13', 'thirteen' ],
    [ '14', 'fourteen' ],
    [ '15', 'fifteen' ],
    [ '16', 'sixteen' ],
    [ '17', 'seventeen' ],
    [ '18', 'eighteen' ],
    [ '19', 'nineteen' ],
    [ '20', 'twenty' ],
    [ '-', 'minus' ],
    [ '\\+', 'plus' ],
    [ '/', 'slash', 'solidus' ],
    [ 'math', 'mathematical' ]
];

const normaliseString = (s: string) => s.normalize('NFKD').replace(/⁄/g, '/');

export default class UnicodeData {
    resourcesDir: string;
    charData: UnicodeCharacter[][] = [];
    blockData: UnicodeBlock[];
    emojiData: number[];
    paletteData: UnicodeCharSet[];
    sequenceData: UnicodeSequence[];
    allHundredsInitialised: boolean = false;

    // is not undefined only when initialising
    onInitialised: (() => void)[] = [];

    constructor(resourcesDir: string, creatingDataFiles?: boolean) { 
        this.resourcesDir = resourcesDir;
        if (!creatingDataFiles)
            createDataFiles(resourcesDir);
        if (existsSync(`${this.resourcesDir}/ucd.emoji.json`)) {
            this.emojiData = JSON.parse(readFileSync(`${this.resourcesDir}/ucd.emoji.json`).toString());
        }
        if (existsSync(`${this.resourcesDir}/ucd.sequences.json`)) {
            this.sequenceData = JSON.parse(readFileSync(`${this.resourcesDir}/ucd.sequences.json`).toString());
            this.sequenceData.forEach(sequence => {
                if (sequence.age && sequence.age.startsWith('E')) {
                    sequence.age = ageName[sequence.age];
                }
            });
        }
        if (existsSync(`${this.resourcesDir}/palettes.json`)) {
            this.paletteData = JSON.parse(readFileSync(`${this.resourcesDir}/palettes.json`).toString());
        }
    }

    getBlocksAsync(callback: (blocks: UnicodeBlock[]) => void): void {
        if (!this.blockData) {
            this.blockData = [];
            var jsonPath = `${this.resourcesDir}/ucd.blocks.json`;
            readFile(jsonPath, (_err, data) => {
                this.blockData = JSON.parse(data.toString());
                callback(this.blockData);
            });
            return;
        }
        callback(this.blockData);
    }

    initialiseHundred(hundred: number, callback: () => void): void {
        // another thread is initialising
        if (this.onInitialised[hundred]) {
            var temp = this.onInitialised[hundred];
            this.onInitialised[hundred] = () => {
                temp();
                callback();
            }
            return;
        }

        // the hundred is not initialised, initialise it
        if (!this.charData[hundred]) {
            this.charData[hundred] = [];

            var jsonPath = `${this.resourcesDir}/ucd.${toHex(hundred * 0x100)}.json`;
            if (existsSync(jsonPath)) {
                this.onInitialised[hundred] = () => {
                    callback();
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
                });
                return;
            }
        }

        callback();
    }

    getCharAsync(code: number, callback: (char: UnicodeCharacter, hundred: UnicodeCharacter[]) => void): void {
        if (code < 0 || code > 0x10FFFF) {
            throw 'char code out of range.';
        }
        var hundred = Math.floor(code / 0x100);

        this.initialiseHundred(hundred, () => {
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
                else if ((code >= 0xe000 && code <= 0xf8ff) || code >= 0xf0000) {
                    callback(new UnicodeCharacter({
                        age: code >= 0xf0000 ? '2.0' : '1.1',
                        code: code,
                        name: '&lt;private use&gt; ' + toHex(code),
                        type: 'char',
                        gc: 'Co'
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
        });
    }

    search(text: string, callback: (results: UnicodeSearchResult[]) => void) {
        // initialise all char data before searching
        if (!this.allHundredsInitialised) {
            var finished = 0;
            for (var i = 0; i <= 0x10ff; i++) {
                this.initialiseHundred(i, () => {
                    if (++finished === 0x1100) {
                        this.allHundredsInitialised = true;
                        this.search(text, callback);
                    }
                });
            }

            return;
        }

        if (!text) return;

        var results: UnicodeSearchResult[] = [];
        var trimmedText = text.trim().toLowerCase();
        var normalisedText = normaliseString(text);

        // form a set of keywords; add synonyms (e.g. '1|one') and remove duplicates
        var keywords: string[] = [];
        var escapeRegex = /[.*+?^${}()|[\]\\]/g;
        trimmedText.replace(/[^0-9a-z+\-/]/g, ' ').replace(escapeRegex, '\\$&').split(/\s+/).forEach(item => {
            var flag = false;
            searchSynonyms.forEach(synonym => {
                if (synonym.includes(item)) {
                    flag = true;
                    keywords.push(synonym.join('|').replace('-|', '')); // shouldn't regard '-' as a word
                }
            });
            if (!flag) keywords.push(item);
        });
        keywords = keywords.filter((item, pos) => {
            if (!item) return false;
            var flag = true;
            keywords.forEach((item1, pos1) => {
                if (pos1 < pos && item1 === item) flag = false;
                if (item1 !== item && new RegExp('\\b(' + item + ')\\b', 'gi').test(item1)) flag = false;
            });
            return flag;
        });
        var keywordRegex = keywords.map(item => new RegExp('\\b(' + item + ')\\b', 'gi'));

        const pushResult = (type: 'char' | 'sequence', codes: number[], matchedProperties: string[], relevance: number) => {
            var flag = false;
            results.forEach(result => {
                if (flag) return;
                if (result.codes.length === codes.length) {
                    for (var i = 0; i < codes.length; i++) {
                        if (result.codes[i] !== codes[i]) return;
                    }
                    flag = true;
                    if (!matchedProperties.includes('exact')) {
                        matchedProperties.forEach(item => {
                            result.matchedProperties.push(item);
                        });
                    }
                    if (result.relevance < relevance) {
                        result.relevance = relevance;
                    }
                }
            });

            if (!flag) {
                results.push({
                    type: type,
                    codes: codes,
                    matchedProperties: matchedProperties,
                    relevance: relevance
                });
            }
        }
        
        // char code
        var result = /^(u\+|u|\\u|0x)?([0-9a-f]+)$/.exec(trimmedText);
        if (result) {
            var exactCode = parseInt(result[2], 16);
            if (!isNaN(exactCode) && exactCode <= 0x10ffff && !(exactCode >= 0xd800 && exactCode <= 0xdfff)) {
                pushResult('char', [ exactCode ], [ 'code' ], 10);
            }
        }

        // decimal code
        var result = /^[0-9]+$/.exec(trimmedText);
        if (result) {
            var exactCode = parseInt(result[0]);
            if (!isNaN(exactCode) && exactCode <= 0x10ffff && !(exactCode >= 0xd800 && exactCode <= 0xdfff)) {
                pushResult('char', [ exactCode ], [ 'decimal-code' ], 9.5);
            }
        }

        // single character
        if (text.length === 1 || (text.codePointAt(0) >= 0x10000 && text.length === 2)) {
            pushResult('char', [ text.codePointAt(0) ], [ 'exact' ], 9);
        }
        if (normalisedText.length === 1 || (normalisedText.codePointAt(0) >= 0x10000 && normalisedText.length === 2)) {
            pushResult('char', [ normalisedText.codePointAt(0) ], [ 'decomp-exact' ], 8.1);
        }

        // char information
        var ltgtRegex = /^&lt;.+&gt;/;
        var latexRegex = new RegExp('^\\\\?' + text.split('').map(a => a.replace(escapeRegex, '\\$&')).join('\\\\?') + '$', 'i');
        var latexRegex1 = /^(\\[^\\\{]+)\{(.|\\[a-zA-Z]+)\}$/;
        var latexRegex2 = /^\\math([a-z]+)\{(.|\\[a-zA-Z]+)\}$/;
        var match = /^[\\&]?([a-zA-Z0-9]+);?$/.exec(text.trim());
        var htmlMatch = match ? match[1] : undefined;

        for (var hundred = 0; hundred <= 0x10ff; hundred++) {
            if (this.charData[hundred].length === 0) continue;

            for (var i = 0; i < 0x100; i++) {
                var char = this.charData[hundred][i];
                // decomposition
                if (char.decomp) {
                    var decomp = normaliseString(char.decomp);
                    if (decomp === normaliseString(text)) {
                        pushResult('char', [ char.code ], [ 'decomp' ], 8);
                    } else if (decomp.toLowerCase() === normalisedText.toLowerCase()) {
                        pushResult('char', [ char.code ], [ 'decomp' ], 7.5);
                    }
                }

                // html
                if (htmlMatch && char.html) {
                    char.html.forEach(item => {
                        if (htmlMatch === item) {
                            pushResult('char', [ char.code ], [ 'html:' + item ], 7);
                        } else if (htmlMatch.toLowerCase() === item.toLowerCase()) {
                            pushResult('char', [ char.code ], [ 'html:' + item ], 6.5);
                        }
                    });
                }

                // latex
                if (char.latex && char.type === 'char') {
                    var latex: { text: string, origin: string }[] = [];
                    char.latex.forEach(item => {
                        latex.push({ text: item, origin: item });
                        if (latexRegex1.test(item)) {
                            latex.push({ text: item.replace(latexRegex1, '$1$2'), origin: item });
                            latex.push({ text: item.replace(latexRegex1, '$1 $2'), origin: item });
                        }
                        if (latexRegex2.test(item)) {
                            latex.push({ text: item.replace(latexRegex2, '\\$1 $2'), origin: item });
                            latex.push({ text: item.replace(latexRegex2, '\\$1$2'), origin: item });
                        }
                    });
                    latex.forEach(item => {
                        if (text === item.text) {
                            pushResult('char', [ char.code ], [ 'latex:' + item.origin ], 7);
                        } else if (latexRegex.test(item.text)) {
                            pushResult('char', [ char.code ], [ 'latex:' + item.origin ], 6.5);
                        }
                    });
                }

                // name
                // TODO: add aliases
                if (keywords.length > 0 && char.name && !char.name.endsWith('-' + char.code.toString(16).toUpperCase())) {
                    var name = char.name.replace(ltgtRegex, '');
                    var matches: string[] = [];
                    var flag = true;
                    for (var j = 0; j < keywordRegex.length; j++) {
                        var m = name.match(keywordRegex[j]);
                        if (m) {
                            m.forEach(item => {
                                if (!matches.includes(item)) matches.push(item);
                            });
                        } else {
                            flag = false;
                            break;
                        }
                    }
                    if (flag) {
                        var wordCount = name.split(' ').length;
                        pushResult('char', [ char.code ], matches.map(
                            match => 'name:' + match
                        ), wordCount === keywordRegex.length ? 5.5 : 5);
                    }
                }
            }
        }

        // sequences
        this.sequenceData.forEach(sequence => {
            if (keywords.length > 0 && sequence.name) {
                var name = sequence.name;
                var matches: string[] = [];
                var flag = true;
                for (var j = 0; j < keywordRegex.length; j++) {
                    var m = name.match(keywordRegex[j]);
                    if (m) {
                        m.forEach(item => {
                            if (!matches.includes(item)) matches.push(item);
                        });
                    } else {
                        flag = false;
                        break;
                    }
                }
                if (flag) {
                    pushResult('sequence', sequence.codes.split(' ').map(
                        s => parseInt(s, 16)
                    ), matches.map(
                        match => 'name:' + match
                    ), 5);
                }
            }
        });

        // ...

        if (results.length === 0) {
            callback(results);
        }

        results.sort((a, b) => b.relevance - a.relevance);
        while (results.length > 100) {
            results.pop();
        }
        
        // get char information etc
        var finished = 0;
        results.forEach(result => {
            switch (result.type) {
                case 'char':
                    this.getCharAsync(result.codes[0], char => {
                        result.char = char;
                        if (++finished === results.length) callback(results);
                    });
                    break;
                case 'sequence':
                    if (++finished === results.length) callback(results);
                    break;
            }
        });
    }

    // load all data at the same time
    // which is ONLY for creating the data files and never run by the user
    completeInitAsync(callback?: () => void) {
        var stream = createReadStream(`${this.resourcesDir}/raw/ucd.all.flat.xml`);
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

            var yVariants = [];
            [
                item['$']['kTraditionalVariant'],
                item['$']['kSimplifiedVariant'],
                item['$']['kSemanticVariant'],
                item['$']['kZVariant']
            ].forEach(s => {
                if (s) {
                    s.match(/\bU\+[0-9A-F]+\b/g).forEach((item: string) => {
                        var code = parseInt(item.substring(2), 16);
                        if (!yVariants.includes(code)) yVariants.push(code);
                    });
                }
            });
            if (yVariants.length === 0) {
                yVariants = undefined;
            } else {
                yVariants.sort();
            }

            if (!this.charData[hundred])
                this.charData[hundred] = [];
            var kc: string[] = [];
            if (item['$']['kHanyuPinlu']) kc = item['$']['kHanyuPinlu'].replace(/\(\d+\)/g, '').split(' ');
            if (item['$']['kHanyuPinyin']) {
                item['$']['kHanyuPinyin'].replace(/.+:/, '').split(',').forEach((s: string) => {
                    if (!kc.includes(s)) kc.push(s);
                });
            }
            if (item['$']['kMandarin']) {
                item['$']['kMandarin'].split(' ').forEach((s: string) => {
                    if (!kc.includes(s)) kc.push(s);
                });
            }
            this.charData[hundred][code % 0x100] = new UnicodeCharacter({
                code: code,
                type: 'char',
                name: name,
                gc: item['$']['gc'],
                age: item['$']['age'],
                kc: kc.length === 0 ? undefined : kc.join(' '),
                kd: item['$']['kDefinition'],
                kjk: item['$']['kJapaneseKun']?.toLowerCase(),
                kjo: item['$']['kJapaneseOn']?.toLowerCase(),
                kk: item['$']['kKorean']?.toLowerCase(),
                kv: item['$']['kVietnamese'],
                ky: yVariants
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

            if (!(start % 0x100 == 0 &&
                (endHundred > startHundred || end % 0x100 == 0xff || end % 0x10000 == 0xfffd))) {
                if (!this.charData[startHundred])
                    this.charData[startHundred] = [];
                for (var code = start; code <= end && code < (startHundred + 1) * 0x100; code++) {
                    this.charData[startHundred][code % 0x100] = new UnicodeCharacter({
                        code: code,
                        gc: 'Cn',
                        type: 'reserved'
                    });
                }
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
            // unihan: add pinyin of any variant to a character
            for (var hundred = 0; hundred <= 0x10ff; hundred++) {
                var data = this.charData[hundred];
                if (!data || data.length === 0) continue;

                for (var i = 0; i < 0x100; i++) {
                    var char = data[i];
                    if (char.ky) {
                        var kc: string[] = char.kc?.split(' ') ?? [];
                        char.ky.forEach(code => {
                            var variant = this.charData[Math.floor(code / 0x100)][code % 0x100];
                            if (variant.kc) {
                                variant.kc.split(' ').forEach(item => {
                                    if (!kc.includes(item)) kc.push(item);
                                });
                            }
                            if (!variant.ky) variant.ky = [];
                            if (!variant.ky.includes(char.code)) {
                                variant.ky.push(char.code);
                                variant.ky.sort();
                            }
                        });
                        if (kc.length > 0) {
                            char.kc = kc.join(' ');
                        }
                    }
                }
            }

            // read html.json
            var htmlNames = JSON.parse(readFileSync(`${this.resourcesDir}/raw/html.json`).toString());
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
            var latexNames = JSON.parse(readFileSync(`${this.resourcesDir}/raw/latex.json`).toString());
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
        var stream = createReadStream(`${this.resourcesDir}/raw/NamesList.txt`);
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

                    var regex = /\b[0-9A-F]+\b/g, result: RegExpExecArray;
                    do {
                        result = regex.exec(input);
                        if (result) {
                            char.cf.push(result[0]);
                        }
                    } while (result);
                    char.cf.sort((a, b) => parseInt(a, 16) - parseInt(b, 16));
                }

                // parse decomposition, marked with '#'
                if (/^\t# /.test(input)) {
                    var char = charHundred[code % 0x100];
                    var decomp = '';

                    var regex = /\b[0-9A-F]+\b/g, result: RegExpExecArray;
                    do {
                        result = regex.exec(input);
                        if (result) {
                            decomp += String.fromCodePoint(parseInt(result[0], 16));
                        }
                    } while (result);
                    char.decomp = decomp;
                }
            }
        });

        reader.on('close', () => {
            // parse emoji-data.txt
            var emojiFile = readFileSync(`${this.resourcesDir}/raw/emoji-data.txt`).toString();
            this.emojiData = [];

            emojiFile.match(/(?<=\n|^)[0-9A-F\.]+\b(?= *; Emoji_Presentation)/g).forEach(value => {
                var result = /^([0-9A-F]+)(\.\.([0-9A-F]+))?$/.exec(value);
                var start = parseInt(result[1], 16);
                var end = result[3] ? parseInt(result[3], 16) : start;
                // exclude regional indicators
                if (start === 0x1f1e6) return;
                
                for (var code = start; code <= end; code++) {
                    this.emojiData.push(code);
                    var charHundred = this.charData[Math.floor(code / 0x100)];
                    if (charHundred) {
                        charHundred[code % 0x100].emoji = true;
                    }
                }
            });

            // parse emoji sequences
            this.sequenceData = [];
            ['emoji-sequences.txt', 'emoji-zwj-sequences.txt'].forEach(fileName => {
                var text = readFileSync(`${this.resourcesDir}/raw/${fileName}`).toString();
    
                text.match(/(?<=\n|^)[0-9A-F\.]+( [0-9A-F\.]+)+ *;[^;]+;[^#]+# *E[0-9\.]+/g).forEach(value => {
                    var result = /^([^;]+);([^;]+);([^#]+)#(.+)$/.exec(value);
                    this.sequenceData.push({
                        codes: result[1].trim().toUpperCase(),
                        type: result[2].trim().replace(/_/g, ' '),
                        name: result[3].trim().toUpperCase().replace('\\X{23}', '#'),
                        age: result[4].trim(),
                    });
                });
            })

            callback();
        });
    }
}

function createDataFiles(resourcesDir: string): void {
    if (existsSync(`${resourcesDir}/ucd.0000.json`))
        return;

    var unicodeData = new UnicodeData(resourcesDir, true);
    unicodeData.completeInitAsync(() => {
        writeFileSync(`${resourcesDir}/ucd.blocks.json`, JSON.stringify(unicodeData.blockData));
        writeFileSync(`${resourcesDir}/ucd.emoji.json`, JSON.stringify(unicodeData.emojiData));
        writeFileSync(`${resourcesDir}/ucd.sequences.json`, JSON.stringify(unicodeData.sequenceData));
        for (var hundred = 0; hundred < 0x10ff; hundred++) {
            if (unicodeData.charData[hundred] && unicodeData.charData[hundred].length > 0) {
                writeFileSync(`${resourcesDir}/ucd.${toHex(hundred * 0x100)}.json`, JSON.stringify(unicodeData.charData[hundred]));
            }
        }
    });
}
