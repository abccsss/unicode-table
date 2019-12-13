const { Titlebar, Color } = require('custom-electron-titlebar');
const { ipcRenderer, shell } = require('electron');
const $ = require('jquery');

// custom title bar
let titleBar = new Titlebar({
    backgroundColor: Color.fromHex('#30343c'),
    itemBackgroundColor: Color.fromHex('#094771'),
});
titleBar.updateTitle('Unicode Table');

$('.container-after-titlebar').css('overflow', 'hidden');

// constants
const loadRows = 8;
const editorCharWidth = 45;
const excludeFromIndex = [ 0xe, 0x15, 0x19, 0x1a, 0x1c ];
const maxLength = 256;
const undoLimit = 1000;
let emojiData;
let isMac;
let mouseEvent;

// timeout function which loads tooltip
let setTimeoutShow;
let setTimeoutHide;
const mouseHoverDelay = 500;

$('#tooltip-container').hover(() => {
    clearTimeout(setTimeoutShow);
    clearTimeout(setTimeoutHide);
}, () => {
    hideTooltip();
});

// initialise editor
let caretPosition = 0;
let selection = { start: 0, end: 0, length: 0 };
let dragStart = -1; // -2 if dragging but not with left button
let editorText = '';
let undoStack = [], redoStack = [];
let editorScrollingByDrag = false;

$('#editor').on('focusin', function () {
    $(this).attr('data-focus', true);
});

$('#editor').on('focusout', function () {
    if (dragStart === -1) { 
        $(this).attr('data-focus', null);
    }
});

// all text changes are done by calling changeText(), except undo or redo
$('#editor-input').on('input', function (event) {
    switch (event.originalEvent.inputType) {
        case 'historyUndo':
            onUndo();
            $(this).val('');
            break;
        case 'historyRedo':
            onRedo();
            $(this).val('');
            break;
        case 'insertFromPaste':
            navigator.clipboard.readText().then(value => {
                if (value) { // also excludes empty strings
                    changeText(value);
                }
            });
            break;
        default:
            if (!$(this).attr('data-composing')) {
                changeText();
            }
            break;
    }
});

$('#editor-input').on('copy cut', function () {
    var text = editorText.substring(stringIndex(editorText, selection.start), stringIndex(editorText, selection.end));
    $(this).val(' ').select(); // so that cutting triggers an input event
    setTimeout(() => {
        navigator.clipboard.writeText(text);
        $(this).val('');
    }, 0);
});

// work with IME
$('#editor-input').on('compositionstart', function () {
    $(this).attr('data-composing', true);
});

$('#editor-input').on('compositionend', function () {
    $(this).attr('data-composing', null);
    changeText();
});

// selection
$('#editor-content').on('mousedown', function (event) {
    mouseEvent = event;
    
    if (event.buttons === 1) { // left button
        var offset = event.pageX - $('#editor-chars').offset().left;
        var index = Math.round(offset / editorCharWidth);
        index = Math.max(index, 0);
        index = Math.min(index, actualIndex(editorText, editorText.length));

        dragStart = index;
        if (event.shiftKey) {
            if (caretPosition === selection.end) {
                dragStart = selection.start;
            } else {
                dragStart = selection.end;
            }
        } else {
            caretPosition = index;
            changeSelection(index);
        }
        $('body').css('cursor', 'text');
        onMouseMove(event, false);
    } else {
        dragStart = -2;
    }
});

$('html').on('mouseup', function () {
    mouseEvent = event;
    
    if (dragStart >= 0) {
        $('#editor-input').focus();
        editorScrollingByDrag = false;
    }
    dragStart = -1;
    $('body').css('cursor', '');
});

$('html').on('mousemove', function (event) {
    mouseEvent = event;
    
    onMouseMove(event, true);
});

$('#editor-input').on('keydown', function (event) {
    // TODO: Cmd+arrow on mac
    switch (event.key) {
        case 'ArrowLeft':
            if (event.shiftKey) {
                if (caretPosition === selection.start) {
                    if (selection.start > 0) {
                        changeSelection({ start: --caretPosition, end: selection.end });
                    }
                } else if (caretPosition === selection.end) {
                    changeSelection({ start: selection.start, end: --caretPosition });
                }
            } else {
                if (selection.length > 0) {
                    changeSelection(selection.start);
                } else if (selection.start > 0) {
                    caretPosition--;
                    changeSelection(caretPosition);
                }
            }
            break;
        case 'ArrowRight':
            if (event.shiftKey) {
                if (caretPosition === selection.end) {
                    if (selection.end < actualIndex(editorText, editorText.length)) {
                        changeSelection({ start: selection.start, end: ++caretPosition });
                    }
                } else if (caretPosition === selection.start) {
                    changeSelection({ start: ++caretPosition, end: selection.end });
                }
            } else {
                if (selection.length > 0) {
                    changeSelection(selection.end);
                } else if (selection.end < actualIndex(editorText, editorText.length)) {
                    caretPosition++;
                    changeSelection(caretPosition);
                }
            }
            break;
        case 'Backspace':
            onBackspace();
            break;
        case 'Delete':
            onDelete();
            break;
        case 'a':
            if (event.ctrlKey === !isMac && !event.shiftKey && !event.altKey && event.metaKey === isMac) {
                onSelectAll();
            }
            break;
        case 'Home':
            if (event.shiftKey) {
                if (caretPosition === selection.start) {
                    caretPosition = 0;
                    changeSelection({ start: 0, end: selection.end });
                } else {
                    caretPosition = 0;
                    changeSelection({ start: 0, end: selection.start });
                }
            } else {
                changeSelection(0);
            }
            break;
        case 'End':
            var actualLength = actualIndex(editorText, editorText.length);
            if (event.shiftKey) {
                if (caretPosition === selection.start) {
                    caretPosition = actualLength;
                    changeSelection({ start: selection.end, end: actualLength });
                } else {
                    caretPosition = actualLength;
                    changeSelection({ start: selection.start, end: actualLength });
                }
            } else {
                changeSelection(actualLength);
            }
            break;
    }
});

// index
$('#main-container').scroll(function () {
    var viewHeight = $(this).height();
    var $block = $('.code-block');
    $block = $block.filter(index => 
        $($block[index]).position().top <= viewHeight / 2
    ).last();
    if ($block.length === 0) $block = $('.code-block[data-first-cp=0]');
    var code = parseInt($block.attr('data-first-cp'));

    if ($block.attr('data-expanded')) {
        var $sub = $block.find('.code-block-sub');
        $sub = $sub.filter(index => 
            $($sub[index]).position().top <= viewHeight / 2
        ).last();
        if ($sub.length === 1) {
            code = Math.max(code, parseInt($sub.attr('data-first-cp')));
        }

        var $row = $block.find('.code-block-row');
        $row = $row.filter(index => 
            $($row[index]).position().top <= viewHeight / 2
        ).last();
        if ($row.length === 1) {
            code = Math.max(code, parseInt($row.attr('data-code')));
        }
    }

    var $item = $(`.index-item[data-code=${Math.floor(code / 0x1000)}]`);
    if (!$item.hasClass('index-item-active')) {
        $('.index-item').removeClass('index-item-active');
        $item.addClass('index-item-active');
        var totalHeight = $('#index-items').height();
        $('#index').animate({
            scrollTop: ($('#index').scrollTop() + $item.position().top) / (totalHeight - $item.height()) * (totalHeight - viewHeight)
        }, {
            queue: false
        });
    }
});

// popup
$('#popup-container').click(function (event) {
    if (event.target.id === 'popup-container') { // clicking outside popup
        hidePopup();
    }
});

$('.popup-button').click(() => hidePopup());

$(document).on('click', 'a[href^="http"]', function (event) {
    event.preventDefault();
    shell.openExternal($(this).attr('href'));
});

// tabs
$('.tab').click(function () {
    var $tab = $(this);
    if ($tab.attr('data-selected')) return;

    $('.tab[data-selected]').data('scroll', $('#main-container').scrollTop());

    $('.tab').attr('data-selected', null);
    $tab.attr('data-selected', true);
    var header = $tab.attr('data-header');
    
    $('[data-tab]').css('display', 'none');
    $(`[data-tab=${header}]`).css('display', 'flex');
    $('#main-container').scrollTop($tab.data('scroll'));
});

const showPopup = (header, html) => {
    $('#popup-header').text(header);
    $('#popup-content').html(html);
    $('#popup-container').css('display', 'flex').animate({
        opacity: 1
    }, 100);
}

const hidePopup = () => {
    if ($('#popup-container').is(':animated')) {
        return;
    }
    $('#popup-container').animate({
        opacity: 0
    }, {
        duration: 100,
        queue: false,
        complete: () => $('#popup-container').css('display', 'none')
    });
}

const onCharHover = ($element, options) => {
    setTimeoutShow = setTimeout(() => {
        showTooltip($element, options);
    }, mouseHoverDelay);
};

const onCharHoverOut = () => {
    clearTimeout(setTimeoutShow);
    clearTimeout(setTimeoutHide);
    setTimeoutHide = setTimeout(() => {
        hideTooltip();
    }, 300);
};

const getEditorChar = code => {
    var div = $(`<div class="code-point" data-code="${code}">
        <div class="code-point-char">${getHtmlChar(code)}</div>
        <div class="code-point-number"><div>${toHex(code)}</div></div>
    </div>`);
    div.hover(function () {
        onCharHover($(this), {
            isEditor: true
        });
    }, onCharHoverOut);
    return div;
}

const onMouseMove = (event) => {
    // if triggered manually, event will be undefined
    if (!event) {
        event = mouseEvent;
    }
    if (event.buttons === 1 && dragStart >= 0) { 
        var $editor = $('#editor');
        var editorPos = $editor.offset().left,
            editorWidth = $editor.width(),
            editorOffset = editorPos - $('#editor-chars').offset().left;

        var offset = event.pageX - $('#editor-chars').offset().left;
        offset = Math.max(offset, editorOffset + (editorScrollingByDrag ? 30 : 0));
        offset = Math.min(offset, editorOffset + editorWidth - (editorScrollingByDrag ? 30 : 0));

        var index = Math.round(offset / editorCharWidth);
        index = Math.max(index, 0);
        index = Math.min(index, actualIndex(editorText, editorText.length));

        caretPosition = index;
        if (index < dragStart) {
            changeSelection({start: index, end: dragStart});
        } else {
            changeSelection({start: dragStart, end: index});
        }
    }
}

const onBackspace = () => {
    if (selection.length === 0 && selection.start > 0) {
        changeSelection({ start: --caretPosition, end: selection.end });
    }
    $('#editor-input').val('');
    changeText('');
}

const onDelete = () => {
    if (selection.length === 0 && selection.end < actualIndex(editorText, editorText.length)) {
        changeSelection({ start: selection.start, end: ++caretPosition });
    }
    $('#editor-input').val('');
    changeText('');
}

const onSelectAll = () => {
    caretPosition = 0;
    changeSelection({start: 0, end: actualIndex(editorText, editorText.length)});
}

const onUndo = () => {
    if (undoStack.length > 0) {
        var item = undoStack.pop();
        redoStack.push(item);
        editorText = item.text;
        updateEditorChars();
        changeSelection(item.selection);
    }
}

const onRedo = () => {
    if (redoStack.length > 0) {
        var item = redoStack.pop();
        undoStack.push(item);
        editorText = item.text.substring(0, stringIndex(item.text, item.selection.start)) + item.replacingText + 
            item.text.substring(stringIndex(item.text, item.selection.end));
        updateEditorChars();
        changeSelection(item.selection.start + item.replacingText.length);
    }
}

const updateEditorChars = () => {
    var $chars = $('#editor-chars');
    $chars.html('');
    for (var i = 0; i < editorText.length; i++) {
        var code = editorText.codePointAt(i);
        if (code >= 0x10000) i++; // is surrogate pair
        var cp = getEditorChar(code);
        $chars.append(cp);
    }

    if (editorText.length === 0) {
        $('#text-preview').css('display', 'none');
    } else {
        $('#text-preview').removeAttr('style');
    }
    $('#text-preview').text(editorText);
}

// for undo stack to work properly, 'newText' should be undefined IF AND ONLY IF
// the change is made by user in the input box, and undo stack is already pushed
const changeText = newText => {
    if (newText === undefined) {
        newText = $('#editor-input').val();
        if (newText === '\ue142') { // see below
            return;
        }
        $('#editor-input').focus().val('');
    } else {
        // insert magic text into #editor-input to push to its undo stack, and then clear it
        // prevent its undo stack being used up (unable to fire undo event when user presses ctrl+z)
        $('#editor-input').focus().val('');
        document.execCommand('insertText', false, '\ue142');
        setTimeout(() => {
            $('#editor-input').val('');
        }, 0);
    }

    if (editorText.length + newText.length > maxLength) {
        var truncatedLength = maxLength - editorText.length;
        if (newText.codePointAt(truncatedLength - 1) >= 0x10000) truncatedLength--;
        newText = newText.substring(0, truncatedLength);
    }

    var oldText = editorText;
    editorText = editorText.substring(0, stringIndex(editorText, selection.start)) + newText + 
        editorText.substring(stringIndex(editorText, selection.end));

    updateEditorChars();

    // push undo stack
    if (newText != '' || selection.length != 0) {
        undoStack.push({
            text: oldText,
            selection: selection,
            replacingText: newText
        });
        if (undoStack.length > undoLimit) {
            undoStack.shift();
        }
        redoStack = [];
    }

    changeSelection(actualIndex(editorText, stringIndex(editorText, selection.start) + newText.length));
}

// get index in string, counting surrogate pair as one
const actualIndex = (text, index) => {
    var actual = 0;
    for (var i = 0; i <= text.length; i++, actual++) {
        var code = text.codePointAt(i);
        if (code >= 0x10000) i++; 
        if (i >= index) break;
    }
    return actual;
}

// get index in string, counting surrogate pair as two
const stringIndex = (text, actualIndex) => {
    var index = 0;
    for (var i = 0; index <= text.length; i++, index++) {
        var code = text.codePointAt(index);
        if (i >= actualIndex) break;
        if (code >= 0x10000) index++; 
    }
    return index;
}

const changeSelection = newSelection => {
    if (typeof newSelection == 'number') {
        newSelection = { start: newSelection, end: newSelection, length: 0 };
    }

    newSelection.length = newSelection.end - newSelection.start;
    if (caretPosition != newSelection.start && caretPosition != newSelection.end)
        caretPosition = newSelection.start;

    if (newSelection != selection) {
        selection = newSelection;

        var $caret = $('.caret');
        $caret.css('left', caretPosition * editorCharWidth).attr('data-active', null)
            .width(); // trigger reflow, so the animation is replayed
        $caret.attr('data-active', true);
        $('.editor-selection').css('left', selection.start * editorCharWidth)
            .css('width', selection.length * editorCharWidth);

        // scroll caret into view
        var $editor = $('#editor');
        var editorWidth = $editor.width();
        var caretPos = $caret.offset().left - $editor.offset().left;

        if (!editorScrollingByDrag && caretPosition !== 0 && caretPosition !== actualIndex(editorText, editorText.length)) {
            if (caretPos < 30) {
                $editor.scrollLeft($editor.scrollLeft() + caretPos - 30);
                editorScrollingByDrag = true;
                setTimeout(() => {
                    if (editorScrollingByDrag) {
                        $editor.scrollLeft($editor.scrollLeft() - editorCharWidth);
                        editorScrollingByDrag = false;
                        onMouseMove();
                    }
                }, 40);
            } else if (caretPos > editorWidth - 30) {
                $editor.scrollLeft($editor.scrollLeft() + caretPos - editorWidth + 30);
                editorScrollingByDrag = true;
                setTimeout(() => {
                    if (editorScrollingByDrag) {
                        $editor.scrollLeft($editor.scrollLeft() + editorCharWidth);
                        editorScrollingByDrag = false;
                        onMouseMove();
                    }
                }, 40);
            }
        }
    }
}

const showTooltip = ($element, options) => {
    var code = $element.data('code');

    // when typing in editor, position is (0, 0) immediately after text change
    // in this case, wait for the next round of hover event
    if ($element.position().left === 0) {
        return;
    }

    // fill tooltip with content
    var $char = $element.children('.code-point-char');
    ipcRenderer.send('asynchronous-message', {
        'type': 'get-char',
        'code': code,
        'sender-position': (options && options.isEditor) ? {
            left: $char.position().left,
            top: $char.position().top - 5
        } : $char.position()
    });
}

const hideTooltip = () => {
    $('#tooltip-container').hide(0);
}

const toHex = code => {
    var hex = Math.floor(code).toString(16).toUpperCase();
    while (hex.length < 4) hex = '0' + hex;
    return hex;
}

const getHtmlChar = code => {
    var isEmoji = emojiData.includes(code);
    var fontClass = toHex(Math.floor(code / 0x400) * 0x400).toLowerCase();

    var isSpecial = code <= 0x20 || (code >= 0x7f && code <= 0xa0) || code == 0xad ||
        (code >= 0x2000 && code <= 0x200f) || code == 0x2011 || (code >= 0x2028 && code <= 0x202f) ||
        (code >= 0x205f && code <= 0x206f) || (code >= 0xfe00 && code <= 0xfe0f) || code == 0xfeff ||
        (code >= 0x1d173 && code <= 0x1d17a);
    var isTag = code >= 0xe0000 && code < 0xe2000;
    var htmlChar = '&#' + (isSpecial ? code + (code >= 0x1d000 ? -0xf000 : code >= 0xfe00 ? -0x1e00 : code >= 0x2000 ? 0xc000 : 0xe000) : isTag ? code - 0xe0000 + 0xe000 : code) + ';';

    return isEmoji ? `<div class="glyph emoji">${htmlChar}</div>` : `<div class="glyph u${fontClass}">${htmlChar}</div>`;
}

// initialise unicode data
ipcRenderer.send('asynchronous-message', {
    type: 'init'
});

// load a row of code points
const loadRow = first => {
    var row = $(
        `<div class="code-block-row" data-code="${first}"></div>`
    );

    for (var code = first; code < first + 16; code++) {
        var hex = toHex(code);

        var cp = $(
            `<div class="code-point" data-code="${code}">
                <div class="code-point-char"></div>
                <div class="code-point-number"><div>${hex}</div></div>
            </div>`
        );
        row.append(cp);

        ipcRenderer.send('asynchronous-message', {
            type: 'get-row',
            code: code
        });
    }

    row.children('.code-point').hover(function () {
        onCharHover($(this));
    }, onCharHoverOut);

    row.children('.code-point').on('mousedown', function (event) {
        if (event.buttons === 1) { // left button
            onClickCodePoint($(this), 'input');
        }
    });

    return row;
}

const onClickHeader = ($element, noExpandFirst) => {
    if ($element.length === 0) return;

    var $block = $element.parents('.code-block');
    var $rows = $block.find('.code-block-rows-container');

    if ($block.attr('data-expanded')) {
        $block.attr('data-expanded', null);
        $rows.css('max-height', 0);
    }
    else {
        // collapse expanded block
        var positionTop = $block.position().top;
        onClickHeader($('.code-block[data-expanded]').find('.code-block-header'));
        $('#main-container').scrollTop($('#main-container').scrollTop() - positionTop + $block.position().top);

        $block.attr('data-expanded', 'true');
        $rows.css('max-height', 'none');

        var $rowsInner = $rows.find('.code-block-rows');
        var rows = $rowsInner.find('.code-block-row');

        if (rows.length === 0) {
            loadCodeBlock($block.data('first-cp'), undefined, noExpandFirst);
        }
    }
}

const onClickSubHeader = $element => {
    var $rows = $element.next('.code-block-sub-rows');
    var $sub = $rows.parents('.code-block-sub');
    var first = parseInt($sub.attr('data-first-cp')), last = parseInt($sub.attr('data-last-cp'));
    if ($element.attr('data-expanded')) {
        $element.attr('data-expanded', null);
        $rows.css('max-height', 0);
    }
    else {
        $element.attr('data-expanded', 'true');
        $rows.css('max-height', 'none');
        if ($rows.children().length === 0) {
            for (var i = first; i < last; i += 0x10) {
                $rows.append(loadRow(i));
            }
        }
    }
}

const onClickCodePoint = ($element, behaviour) => {
    var code = parseInt($element.attr('data-code'));
    if (code !== undefined) {
        switch (behaviour) {
            case 'input':
                changeText(String.fromCodePoint(code));
                $('#editor-input').focus();
                setTimeout(() => {
                    $('#editor-input').focus();
                }, 0);
                break;
            case 'go-to-char':
                goToChar(code);
                break;
        }
    }
}

const getSubblock = (first, last) => {
    var header = $(
        `<div class="code-block-sub-expander" data-text="${toHex(first)}–${toHex(last)}">
            <div class="code-block-sub-expander-icon"></div>
        </div>`
    );
    var rows = $(`<div class="code-block-sub-rows">`);

    header.click(function () {
        onClickSubHeader($(this));
    });

    var div = $(`<div class="code-block-sub" data-first-cp="${first}" data-last-cp="${last}">`);
    div.append(header).append(rows);

    return div;
}

// load a code block
const loadCodeBlock = (first, rows, noExpandFirst) => {
    if (!rows) rows = loadRows;

    var $block = $(`.code-block[data-first-cp=${first}]`);
    $block.attr('data-expanded', 'true');

    var $rows = $block.find('.code-block-rows');

    var last = parseInt($block.attr('data-last-cp'));
    var until = last - first <= rows * 0x10 ? last + 1 : first + rows * 0x10;

    if (until != last + 1) {
        // long block, divide into sections
        for (var i = first; i < last; i += 0x10 * loadRows) {
            $rows.append(getSubblock(i, Math.min(i + 0x10 * loadRows - 1, last)));
        }
        // expand the first section
        if (!noExpandFirst) {
            $rows.find('.code-block-sub-expander').first().trigger('click');
        }
    }
    else {
        // short block, show all glyphs
        for (var i = first; i < until; i += 0x10) {
            var row = loadRow(i);
            $rows.append(row);
        }
    }
};

const goToChar = (code) => {
    code = parseInt(code);

    var $block = $('.code-block');
    $block = $block.filter(index => {
        var $item = $($block[index]);
        return parseInt($item.attr('data-last-cp')) >= code;
    }).first();
    if ($block.length === 0) return;
    code = Math.max(parseInt($block.attr('data-first-cp')), code);
    var positionTop;

    if (!$block.attr('data-expanded')) {
        onClickHeader($block.find('.code-block-header'), true);
    }
    var $row = $block.find(`.code-block-row[data-code=${code}]`);
    if ($row.length === 0) {
        var $sub = $block.find('.code-block-sub');
        $sub = $sub.filter(index => {
            var $item = $($sub[index]);
            return parseInt($item.attr('data-first-cp')) <= code && parseInt($item.attr('data-last-cp')) >= code;
        });
        positionTop = $sub.position().top;

        $sub.find('.code-block-sub-expander').trigger('click');
        $row = $block.find(`.code-block-row[data-code=${code}]`);
    }
    if ($row.length > 0) positionTop = $row.position().top;

    var $main = $('#main-container');
    $main.scrollTop($main.scrollTop() + positionTop - $main.height() / 2 + 50);

    hideTooltip();
}

const getIndexItem = thousand => {
    var hex = thousand.toString(16).toUpperCase();

    var item = $(`<div class="index-item" data-code="${thousand}">${hex}<span class="index-zeroes">000</span>`);
    item.click(function () {
        goToChar(parseInt(thousand * 0x1000));

        var totalHeight = $('#index-items').height();
        var viewHeight = $('#main-container').height();
        $('#index').scrollTop(($('#index').scrollTop() + item.position().top) / (totalHeight - item.height()) * (totalHeight - viewHeight));
    });

    return item;
}

// respond to replies
ipcRenderer.on('asynchronous-reply', (_event, arg) => {
    switch (arg.type) {
        // initialise unicode blocks
        case 'init':
            emojiData = arg.emoji;
            isMac = arg['is-mac'];

            arg.blocks.forEach(block => {
                if (/\b(Private Use|Surrogates)\b/.test(block.name)) {
                    return;
                }

                var elem = $(
                    `<div class="code-block" data-first-cp="${block.firstCode}" data-last-cp="${block.lastCode}" data-name="${block.name}">
                        <div class="code-block-header">
                            <div class="code-block-header-expander"></div>
                            <div class="code-block-header-text">
                                <div class="code-block-range">
                                    ${toHex(block.firstCode)}&ndash;${toHex(block.lastCode)}
                                </div>
                                <div class="code-block-name">
                                    ${block.name}
                                </div>
                            </div>
                        </div>
                        <div class="code-block-rows-container">
                            <div class="code-block-rows"></div>
                        </div>
                    </div>`
                );

                $('#table-container').append(elem);
            });

            $('.code-block-header').click(function () {
                onClickHeader($(this));
            });

            loadCodeBlock(0);
            var $rows = $('.code-block[data-first-cp=0] .code-block-rows-container');
            $rows.css('max-height', 'none');

            // initialise side bar
            var $index = $('#index-items');
            for (var i = 0; i < 0x30; i++) {
                if (!excludeFromIndex.includes(i)) {
                    $index.append(getIndexItem(i));
                }
            }
            $index.append(getIndexItem(0xe0));
            $('.index-item[data-code=0]').addClass('index-item-active');
            break;

        // receive char information for tooltip
        case 'get-char':
            var char = arg['char'];
            var code = char['code'];
            var position = arg['sender-position'];

            if (code === undefined) {
                break;
            }

            var codeString = code.toString(16).toUpperCase();
            while (codeString.length < 4) codeString = '0' + codeString;
            var displayName = char['type'] == 'char' ?
                char['name'].replace('&lt;control&gt;', '<span class="dim">&lt;control&gt;</span>') :
                '<span class="dim">&lt;unassigned&gt;</span>';
            if (displayName === undefined) displayName = '';

            var $tooltip = $('#tooltip-container');
            var tooltipHtml =
                `<div id="tooltip">`;
            if (char['type'] == 'char') {
                tooltipHtml +=
                    `<div class="code-point-char">${getHtmlChar(code)}</div>`;
            }
            tooltipHtml +=
                    `<div class="tooltip-char-code">U+${codeString}</div>
                    <div class="tooltip-char-name">${displayName}</div>
                    <div class="tooltip-char-property-header">Decimal Code</div>
                    <div class="tooltip-char-property">${code}</div>`;
            if (char['type'] == 'char') {
                tooltipHtml +=
                    `<div class="tooltip-char-property-header">General Category</div>
                    <div class="tooltip-char-property">${char['general-category']}</div>`;
            }
            if (char['html'] && char['html'].length > 0) {
                tooltipHtml += `<div class="tooltip-char-property-header">HTML Entity</div>
                    <div class="tooltip-char-property">`;
                char['html'].forEach(htmlName => {
                    tooltipHtml += `<span class="code">&amp;${htmlName};</span>`
                });
                tooltipHtml += `</div>`;
            }
            // if (char['latex']) {
            //     tooltipHtml += `<div class="tooltip-char-property-header">LaTeX</div>
            //         <div class="tooltip-char-property">`;
            //     char['latex'].forEach(latexName => {
            //         tooltipHtml += `<span class="code">${htmlEncode(latexName)}</span>`
            //     });
            //     tooltipHtml += `</div>`;
            // }
            if (char['cross-references']) {
                tooltipHtml +=
                    `<div class="tooltip-char-property-header">Cross References</div>
                    <div class="tooltip-code-list">`;
                char['cross-references'].forEach(item => {
                    var cfCode = parseInt(item, 16);
                    tooltipHtml += 
                    `<div class="code-point" data-code="${cfCode}">
                        <div class="code-point-char"></div>
                        <div class="code-point-number"><div>${item}</div></div>
                        <div class="code-point-title"></div>
                    </div>`
                });
                tooltipHtml += `</div>`;
            }
            if (char['age']) tooltipHtml +=
                    `<div class="tooltip-char-property-header">Introduced in</div>
                    <div class="tooltip-char-property">${char['age']}</div>`;
            tooltipHtml +=
                `</div>`;

            $tooltip.html(tooltipHtml);

            // set mouse hover text for cross-refs
            if (char['cross-references']) {
                char['cross-references'].forEach(item => {
                    ipcRenderer.send('asynchronous-message', {
                        'type': 'get-char-name',
                        'code': parseInt(item, 16)
                    })
                });
            }
        
            // compute the position of the tooltip
            var $container = $('#main-container');
            var left = Math.min(position.left, $container.width() - $tooltip.width() - 2);
            var top = position.top + 50;
            if (top + $tooltip.height() > $container.height()) {
                top = Math.max(0, position.top - $tooltip.height());
            }
            $tooltip.css('left', left).css('top', top);
            $tooltip.show(200);

            break;

        // set mouse hover text and click handler for cross-refs in tooltip
        case 'get-char-name':
            var char = arg['char'];
            $(`.tooltip-code-list .code-point[data-code=${char['code']}]`)
                .attr('data-title', char['name'])
                .mousedown(function (event) {
                    if (event.buttons === 1) {
                        onClickCodePoint($(this), 'input');
                    } else if (event.buttons === 2) {
                        onClickCodePoint($(this), 'go-to-char');
                    }
                });
            $(`.tooltip-code-list .code-point[data-code=${char['code']}] .code-point-title`)
                .html(char['name'] + '<br/>(left click to enter; right click to show in table)');
            $(`.tooltip-code-list .code-point[data-code=${char['code']}] .code-point-char`)
                .html(getHtmlChar(char['code']));
            break;

        // fill a row of code points
        case 'get-row':
            var code = arg['code'];
            var chars = arg['chars'];

            var $row = $(`.code-block-row[data-code=${code}]`);
            for (var i = 0; i < 0x10; i++) {
                if (chars[i]['type'] == 'char') {
                    $row.children(`.code-point[data-code=${code + i}]`)
                        .children(`.code-point-char`)
                        .html(getHtmlChar(code + i));
                } else {
                    $row.children(`.code-point[data-code=${code + i}]`)
                        .attr('data-disabled', 'true');
                }
            }
            break;
    }
});

ipcRenderer.on('command', (_event, arg) => {
    switch (arg.command) {
        case 'copy':
        case 'cut':
        case 'delete':
        case 'paste':
        case 'redo':
        case 'selectAll':
        case 'undo':
            document.execCommand(arg.command);
            break;
        case 'about':
            showPopup('Unicode Table', 
                `Version: 0.1.0<br/>` +
                `Repository: <a href="https://github.com/abccsss/unicode-table">` +
                `<span class="code">https://github.com/abccsss/unicode-table</span></a><br/><br/>` +
                `Unicode: 12.1 (May 2019)<br/>` +
                `Electron: ${arg.versions['electron']}<br/>` +
                `Chrome: ${arg.versions['chrome']}<br/>` +
                `Node.js: ${arg.versions['node']}`
            );
            break;
    }
});
function newFunction() {
    console.log(this);
}

