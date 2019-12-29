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
let sequenceData;
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
    $(this).removeClass('focus-helper');
});

$('#editor').on('focusout', function () {
    if (dragStart === -1 && !$(this).hasClass('focus-helper')) { 
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

let editorScrollTarget;
$('#editor').on('mousewheel', function (event) {
    if (event.originalEvent.deltaX === 0) {
        if (editorScrollTarget === undefined) {
            editorScrollTarget = $(this).scrollLeft();
        }
        editorScrollTarget += event.originalEvent.deltaY;
        $(this).animate({
            scrollLeft: editorScrollTarget
        }, {
            duration: 150,
            queue: false,
            complete: () => editorScrollTarget = undefined
        });
    }
})

// index
$('#main-container').scroll(function () {
    hideTooltip();

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

// search
let searchTimeout;
let searchText;
let defaultText;

$('#search-input').on('compositionstart', function () {
    $(this).attr('data-composing', true);
});

$('#search-input').on('compositionend', function () {
    $(this).attr('data-composing', null).trigger('input');
});

$('#search-input').on('input', function () {
    if ($(this).attr('data-composing')) return;
    var text = $(this).val();
    if (searchText !== text) {
        searchText = text;
        if (text !== '') {
            if (searchTimeout) 
                clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                searchTimeout = undefined;
                onSearch(text);
            }, 300);
        } else {
            if (searchTimeout) 
                clearTimeout(searchTimeout);
        }
    }
});

$('#search-input').keydown(function (event) {
    if (event.key === 'Enter') {
        setTimeout(() => {
            if (defaultText) changeText(defaultText);
        }, 0);
    }
})

// palettes
let palettes;

$('#palette-back-button, .tab[data-header=Palettes]').click(function () {
    $('#palette-content').css('display', 'none');
    $('#palette-list').attr('style', null);
    $('#main-container').scrollTop(0);
});

const loadPalette = id => {
    var palette = palettes[id];
    if (palette) {
        $('#palette-header').text(palette.name);
        var $sections = $('#palette-sections');
        $sections.html('');

        palette.sections.forEach(section => {
            var elem = $(`<div class="palette-section-header">`).text(section.name);
            $sections.append(elem);

            elem = $('<div class="palette-section-rows">')
            for (var i = 0; i < section.chars.length; i += 0x10) {
                elem.append(loadPaletteRow(section.chars.slice(i)));
            }
            $sections.append(elem);
        });
    }
}

const loadPaletteRow = codes => {
    var row = $(`<div class="palette-row">`);
    for (var i = 0; i < 16 && i < codes.length; i++) {
        var code = codes[i];

        var isSingle = /^\b[0-9A-F]+\b$/i.test(code);

        var div;
        if (isSingle) {
            code = parseInt(code, 16);
            div = $(`<div class="code-point" data-code="${code}">
                <div class="code-point-char">${getHtmlChar(code)}</div>
                <div class="code-point-number"><div>${toHex(code)}</div></div>
            </div>`);
            div.hover(function () {
                onCharHover($(this));
            }, onCharHoverOut);
            div.mousedown(function (event) {
                if (event.buttons === 1) {
                    onClickCodePoint($(this), 'input');
                } else if (event.buttons === 2) {
                    onClickCodePoint($(this), 'go-to-char');
                }
            });
        } else if (getSequence(code)) {
            var sequence = getSequence(code);
            var first = /^\b[0-9A-F]+\b/i.exec(code)[0];
            div = $(`<div class="code-point" data-codes="${code}">
                <div class="code-point-char">${getHtmlChar(code)}</div>
                <div class="code-point-number"><div>${first}...</div></div>
            </div>`).data('sequence', sequence);
            div.mousedown(function (event) {
                if (event.buttons === 1) {
                    onClickCodePoint($(this), 'input');
                }
            });
            div.hover(function () {
                onCharHover($(this));
            }, onCharHoverOut);
        } else if (/^\b[0-9A-F]+\b/i.test(code)) {
            var first = /^\b[0-9A-F]+\b/i.exec(code)[0];
            div = $(`<div class="code-point" data-codes="${code}" data-title>
                <div class="code-point-char">${getHtmlChar(code)}</div>
                <div class="code-point-number"><div>${first}...</div></div>
                <div class="code-point-title">${code}<br/>(left click to enter)</div>
            </div>`);
            div.mousedown(function (event) {
                if (event.buttons === 1) {
                    onClickCodePoint($(this), 'input');
                }
            });
            div.hover(function () {
                onShowTitle($(this));
            });
        } else if (code === 'xxxx') {
            div = $(`<div class="code-point">`);
        }
        row.append(div);
    }
    return row;
}

const onSearch = text => {
    ipcRenderer.send('asynchronous-message', {
        type: 'search',
        query: text
    });
}

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

const onShowTitle = $element => {
    var $title = $element.find('.code-point-title');
    if ($title.length === 1) { 
        var left = -($element.offset().left + $title.width() - $('#main-container').width() + 5);
        if (left < 0) $title.css('left', left);
    }
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
    div.mousedown(function (event) {
        if (event.buttons === 2) { // right button
            onClickCodePoint($(this), 'go-to-char');
        }
    })
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
    caretPosition = actualIndex(editorText, editorText.length);
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

const insertAtIndex = (i, $parent, child) => {
    if (i === 0) {
        $parent.prepend(child);        
    } else {
        $parent.children(`:nth-child(${(i)})`).after(child);
    }
}

const updateEditorChars = (selection, newText) => {
    var $chars = $('#editor-chars');

    if (!selection) {
        $chars.html('');
        for (var i = 0; i < editorText.length; i++) {
            var code = editorText.codePointAt(i);
            if (code >= 0x10000) i++; // is surrogate pair
            $chars.append(getEditorChar(code));
        }
    } else {
        $chars.children().slice(selection.start, selection.end).remove();
        for (var i = 0, j = 0; i < newText.length; i++, j++) {
            var code = newText.codePointAt(i);
            if (code >= 0x10000) i++; 
            insertAtIndex(selection.start + j, $chars, getEditorChar(code));
        }
    }

    if (editorText.length === 0) {
        $('#text-preview').css('display', 'none');
    } else {
        $('#text-preview').removeAttr('style');
    }
    $('#text-preview').text(editorText);
}

// form: 'NFC' | 'NFD' | 'NFKC' | 'NFKD'
const onNormalise = form => {
    if (selection.start === selection.end) {
        onSelectAll();
    }
    var selectionStart = selection.start;
    var selectedText = editorText.substring(stringIndex(editorText, selection.start), stringIndex(editorText, selection.end));
    var normalised = selectedText.normalize(form);
    changeText(normalised);
    caretPosition = selectionStart + actualIndex(normalised, normalised.length);
    changeSelection({
        start: selectionStart,
        end: selectionStart + actualIndex(normalised, normalised.length) 
    });
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

    updateEditorChars(selection, newText);

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

const utf8length = text => {
    var length = 0;
    for (var i = 0; i < text.length; i++) {
        var code = text.codePointAt(i);
        if (code >= 0x10000) i++;
        length += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    }
    return length;
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
        } else if (caretPosition === 0) {
            $editor.scrollLeft(0);
        } else if (caretPosition === actualIndex(editorText, editorText.length)) {
            $editor.scrollLeft($editor.scrollLeft() + caretPos - editorWidth);
        }

        // status bar
        var length = actualIndex(editorText, editorText.length);
        if (selection.length === 0) {
            $('#status-bar-char-count').text(`Characters: ${length}`);
            $('#status-bar-uft8-length').text(`UTF-8 length: ${utf8length(editorText)}`);
            $('#status-bar-uft16-length').text(`UTF-16 length: ${editorText.length}`);
            $('#status-bar-caret-position').text(`Position: ${caretPosition}`);
        } else {
            var selectedText = editorText.substring(stringIndex(editorText, selection.start), stringIndex(editorText, selection.end));
            $('#status-bar-char-count').text(`Characters: ${length} (${selection.length})`);
            $('#status-bar-uft8-length').text(`UTF-8 length: ${utf8length(editorText)} (${utf8length(selectedText)})`);
            $('#status-bar-uft16-length').text(`UTF-16 length: ${editorText.length} (${selectedText.length})`);
            $('#status-bar-caret-position').text(`Position: ${selection.start}–${selection.end}`);
        }
    }
}

const reallyShowTooltip = position => {
    var $tooltip = $('#tooltip-container');
    var $container = $('#main-container');
    var charHeight = $('.tab[data-header=Search]').attr('data-selected') ? 60 : 50;
    var left = Math.min(position.left, $container.width() - $tooltip.width() - 2);
    var top = position.top + charHeight;
    if (top + $tooltip.height() > $('#root').height()) {
        top = Math.max(0, position.top - $tooltip.height());
    }
    $tooltip.css('left', left).css('top', top);
    $tooltip.show(200);
}

const showTooltip = ($element, options) => {
    var code = $element.data('code'), sequence = $element.data('sequence');

    // when typing in editor, position is (0, 0) immediately after text change
    // in this case, wait for the next round of hover event
    if ($element.position().left === 0) {
        return;
    }

    // fill tooltip with content
    var position = $element.children('.code-point-char').position();
    if (sequence) {
        var $tooltip = $('#tooltip-container');
        var codes = sequence.codes.split(' ').map(s => parseInt(s, 16));
        var variants = getEmojiVariants(sequence.codes);

        var tooltipHtml = 
            `<div id="tooltip">
                <div class="code-point-char">${getHtmlChar(sequence.codes)}</div>
                <div class="tooltip-char-code">${sequence.codes.split(' ').map(s => 'U+' + s).join(' ')}</div>
                <div class="tooltip-char-name">${htmlEncode(sequence.name)}</div>`
        if (sequence.type)
            tooltipHtml +=
                `<div class="tooltip-char-property-header">Type</div>
                <div class="tooltip-char-property">${sequence.type}</div>`;
        tooltipHtml +=
                `<div class="tooltip-char-property-header">Code Points</div>
                <div class="code-list">`;
        codes.forEach(code => {
            tooltipHtml += 
                `<div class="code-point" data-code="${code}">
                    <div class="code-point-char"></div>
                    <div class="code-point-number"><div>${toHex(code)}</div></div>
                    <div class="code-point-title"></div>
                </div>`
        });
        if (variants) {
            tooltipHtml += 
                `</div>
                <div class="tooltip-char-property-header">Variants</div>
                <div class="code-list">`;
            variants.forEach(variant => {
                tooltipHtml += 
                `<div class="code-point" data-codes="${variant.codes}" data-title>
                    <div class="code-point-char">${getHtmlChar(variant.codes)}</div>
                    <div class="code-point-number"><div>${variant.codes.replace(/ .+/, '...')}</div></div>
                    <div class="code-point-title">${variant.codes}<br/>${variant.name}<br/>(click to enter)</div>
                </div>`
            });
        }
        tooltipHtml += `</div>`;
        if (sequence.age && sequence.age !== 'E0.0') {
            tooltipHtml += 
                `<div class="tooltip-char-property-header">Introduced in</div>
                <div class="tooltip-char-property">${sequence.age}</div>`;
        }
        tooltipHtml += `</div>`;
        $tooltip.html(tooltipHtml);
        $tooltip.find('.code-point').mousedown(function (event) {
            if (event.buttons === 1) {
                onClickCodePoint($(this), 'input');
            } else if (event.buttons === 2) {
                if ($(this).attr('data-code')) onClickCodePoint($(this), 'go-to-char');
            }
        });
        $tooltip.find('.code-point[data-title]').hover(function () {
            onShowTitle($(this));
        });
        reallyShowTooltip(position);
        
        // set mouse hover text for code points
        codes.forEach(code => {
            ipcRenderer.send('asynchronous-message', {
                'type': 'get-char-name',
                'code': code
            })
        });
    } else {
        ipcRenderer.send('asynchronous-message', {
            'type': 'get-char',
            'code': code,
            'sender-position': (options && options.isEditor) ? {
                left: position.left,
                top: position.top - 5
            } : position
        });
    }
}

const hideTooltip = () => {
    $('#tooltip-container').hide(0);
}

const toHex = code => {
    var hex = Math.floor(code).toString(16).toUpperCase();
    while (hex.length < 4) hex = '0' + hex;
    return hex;
}

const getHtmlChar = (code) => {
    var codes = [];
    if (typeof code === 'string') {
        code.match(/\b[0-9A-F]+\b/gi).forEach(match => {
            codes.push(parseInt(match, 16));
        });
    } else if (typeof code === 'number') {
        codes.push(code);
    } else throw 'getHtmlChar: invalid argument.';

    var sequence = codes.length === 1 ? undefined : getSequence(code);
    var isEmoji = (codes.length === 1 && emojiData.includes(codes[0])) ||
        (codes.length === 2 && codes[1] === 0xfe0f) ||
        (sequence && /\bEmoji\b/.test(sequence.type));
    var isFlagEmoji = sequence && sequence.name.startsWith('FLAG: ');
    var html = '';
    var fontClass = isFlagEmoji ? 'flag-emoji' : isEmoji ? 'emoji' : 'u' + toHex(Math.floor(codes[0] / 0x400) * 0x400).toLowerCase();

    if (codes.length === 1) {
        var code = codes[0];
        // return nothing for private use, unassigned chars with no font coverage, and nonchars
        if ((code >= 0xd800 && code <= 0xf8ff) || (code >= 0x30000 && code <= 0xdffff) || code >= 0xe01f0 || (code % 0x10000 >= 0xfffe)) return ''; 
        var usePrivateArea = !isEmoji;
        html += '&#' + (usePrivateArea ? code % 0x400 + 0xe000 : code) + ';';
    } else {
        codes.forEach(code => {
            html += '&#' + code + ';';
        });
    }

    return `<div class="glyph ${fontClass}">${html}</div>`;
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
        // increase performance by removing collapsed content
        $('.code-block-rows').html('');
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
        $rows.find('.char-glowing').stop().removeClass('char-glowing').attr('style', null);
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
    if ($element.attr('data-code')) {
        var code = parseInt($element.attr('data-code'));
        switch (behaviour) {
            case 'input':
                changeText(String.fromCodePoint(code));
                $('#editor').addClass('focus-helper');
                setTimeout(() => {
                    $('#editor-input').focus();
                }, 0);
                break;
            case 'go-to-char':
                goToChar(code);
                break;
        }
    } else if ($element.attr('data-codes') && behaviour === 'input') {
        var text = '';
        $element.attr('data-codes').match(/\b[0-9A-F]+\b/gi).forEach(match => {
            text += String.fromCodePoint(parseInt(match, 16));
        });
        changeText(text);
        $('#editor').addClass('focus-helper');
        setTimeout(() => {
            $('#editor-input').focus();
        }, 0);
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

const goToChar = (code, goToNextAssigned) => {
    code = parseInt(code);

    var $block = $('.code-block');
    $block = $block.filter(index => {
        var $item = $($block[index]);
        return parseInt($item.attr('data-last-cp')) >= code;
    }).first();
    if ($block.length === 0) return;
    if ($block.attr('data-first-cp') > code) {
        if (goToNextAssigned)
            code = parseInt($block.attr('data-first-cp'));
        else
            return;
    }
    $('.tab[data-header=Table]').trigger('click');
    
    var positionTop;

    if (!$block.attr('data-expanded')) {
        onClickHeader($block.find('.code-block-header'), true);
    }
    var $row = $block.find(`.code-block-row[data-code=${code - code % 0x10}]`);
    if ($row.length === 0) {
        var $sub = $block.find('.code-block-sub');
        $sub = $sub.filter(index => {
            var $item = $($sub[index]);
            return parseInt($item.attr('data-first-cp')) <= code && parseInt($item.attr('data-last-cp')) >= code;
        });
        positionTop = $sub.position().top;

        $sub.find('.code-block-sub-expander').trigger('click');
        $row = $block.find(`.code-block-row[data-code=${code - code % 0x10}]`);
    } else {
        var $subHeader = $row.parents('.code-block-sub').find('.code-block-sub-expander');
        if (!$subHeader.attr('data-expanded')) {
            onClickSubHeader($subHeader);
        }
    }

    if ($row.length > 0) {
        positionTop = $row.position().top;

        // make code point glow
        var $char = $row.find(`.code-point[data-code=${code}] .code-point-char`);
        $char.stop().addClass('char-glowing')
            .css('box-shadow', '0 0 1px 2px rgba(232,176,64,.8)').css('min-width', '3px').animate({
            'min-width': '0'
        }, {
            duration: 2000,
            queue: false,
            step: now => {
                if (now <= .8) {
                    $char.css('box-shadow', `0 0 1px 2px rgba(232,176,64,${now})`)
                }
            },
            complete: () => {
                $char.removeClass('char-glowing').attr('style', null);
            }
        });
    }

    var $main = $('#main-container');
    $main.scrollTop($main.scrollTop() + positionTop - $main.height() / 2 + 50);

    hideTooltip();
}

const getIndexItem = thousand => {
    var hex = thousand.toString(16).toUpperCase();

    var item = $(`<div class="index-item" data-code="${thousand}">${hex}<span class="index-zeroes">000</span>`);
    item.click(function () {
        goToChar(parseInt(thousand * 0x1000), true);

        var totalHeight = $('#index-items').height();
        var viewHeight = $('#main-container').height();
        $('#index').scrollTop(($('#index').scrollTop() + item.position().top) / (totalHeight - item.height()) * (totalHeight - viewHeight));
    });

    return item;
}

const htmlEncode = text => $('<div>').text(text.replace(' ', '\u00a0')).html();

const getSequence = codes => {
    codes = codes.toUpperCase();
    for (var i = 0; i < sequenceData.length; i++) {
        if (sequenceData[i].codes === codes) return sequenceData[i];
    }
    return undefined;
}

const getEmojiVariants = codes => {
    var regex = / (20E3|FE0F|1F3F[B-F])\b/g;
    codes = codes.toUpperCase();
    var base = codes.replace(regex, '');
    var result = [];
    sequenceData.forEach(sequence => {
        if (sequence.codes !== codes && sequence.codes.replace(regex, '') === base)
            result.push(sequence);
    });
    if (result.length === 0) return null;
    return result;
}

String.prototype.replaceAll = function(search, replacement) {
    return this.split(search).join(replacement);
};

// respond to replies
ipcRenderer.on('asynchronous-reply', (_event, arg) => {
    switch (arg.type) {
        // initialise unicode blocks and palettes
        case 'init':
            emojiData = arg.emoji;
            sequenceData = arg.sequences;
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

            // palettes
            palettes = [];
            var $list = $('#palette-list');
            var id = 0;

            arg.palettes.forEach(group => {
                $list.append($(`<div class="palette-group-header">`).text(group.name));
                var $group = $(`<div class="palette-group-content">`);
                group.sections.forEach(palette => {
                    palettes.push(palette);
                    var elem = $(`
                        <div class="palette-info" data-id="${id++}">
                            <div class="palette-info-name">${palette.name}</div>
                            <div class="palette-info-description">${palette.description}</div>
                            <div class="palette-info-samples">
                                <div class="code-point-char">${getHtmlChar(palette.sections[0].chars[0])}</div>
                                <div class="code-point-char">${getHtmlChar(palette.sections[0].chars[1])}</div>
                                <div class="code-point-char">${getHtmlChar(palette.sections[0].chars[2])}</div>
                                <div class="code-point-char">${getHtmlChar(palette.sections[0].chars[3])}</div>
                                <div class="palette-info-samples-ellipsis"></div>
                            </div>
                        </div>
                    `);
                    elem.click(function () {
                        $('#palette-list').css('display', 'none');
                        $('#palette-content').css('display', 'block');
                        $('#main-container').scrollTop(0);
                        loadPalette($(this).attr('data-id'));
                    });
                    $group.append(elem);
                });
                $list.append($group);
            });

            // init search
            ipcRenderer.send('asynchronous-message', {
                type: 'init-search'
            });
            break;

        // receive char information for tooltip
        case 'get-char':
            var char = arg['char'];
            var code = char['code'];
            var position = arg['sender-position'];

            if (code === undefined) {
                break;
            }

            var codeString = toHex(code);

            var displayName = char['type'] == 'char' ?
                char['name'].replace(/&lt;([^&]+)&gt;/g, '<span class="dim">&lt;$1&gt;</span>') :
                char['type'] == 'surrogate' ? '<span class="dim">&lt;surrogate&gt;</span>' :
                char['type'] == 'noncharacter' ? '<span class="dim">&lt;not a character&gt;</span>' :
                '<span class="dim">&lt;unassigned&gt;</span>';
            if (displayName === undefined) displayName = '';

            var variants = getEmojiVariants(codeString);

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
            if (char['latex']) {
                tooltipHtml += `<div class="tooltip-char-property-header">LaTeX</div>
                    <div class="tooltip-char-property">`;
                char['latex'].forEach(latexName => {
                    tooltipHtml += `<span class="code">${htmlEncode(latexName)}</span>`
                });
                tooltipHtml += `</div>`;
            }
            if (char['cross-references']) {
                tooltipHtml +=
                    `<div class="tooltip-char-property-header">Cross References</div>
                    <div class="code-list">`;
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
            if (variants) {
                tooltipHtml +=
                    `<div class="tooltip-char-property-header">Variants</div>
                    <div class="code-list">`;
                variants.forEach(variant => {
                    tooltipHtml += 
                    `<div class="code-point" data-codes="${variant.codes}" data-title>
                        <div class="code-point-char">${getHtmlChar(variant.codes)}</div>
                        <div class="code-point-number"><div>${variant.codes.replace(/ .+/, '...')}</div></div>
                        <div class="code-point-title">${variant.codes}<br/>${variant.name}<br/>(click to enter)</div>
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
            $tooltip.find('.code-point').mousedown(function (event) {
                if (event.buttons === 1) {
                    onClickCodePoint($(this), 'input');
                } else if (event.buttons === 2) {
                    if ($(this).attr('data-code')) onClickCodePoint($(this), 'go-to-char');
                }
            });
            $tooltip.find('.code-point[data-title]').hover(function () {
                onShowTitle($(this));
            });

            // set mouse hover text for cross-refs
            if (char['cross-references']) {
                char['cross-references'].forEach(item => {
                    ipcRenderer.send('asynchronous-message', {
                        'type': 'get-char-name',
                        'code': parseInt(item, 16)
                    })
                });
            }
        
            reallyShowTooltip(position);

            break;

        // set mouse hover text and click handler for cross-refs in tooltip
        case 'get-char-name':
            var char = arg['char'];
            $(`.code-list .code-point[data-code=${char['code']}]`)
                .attr('data-title', char['name'])
                .hover(function () {
                    onShowTitle($(this));
                });
            $(`.code-list .code-point[data-code=${char['code']}] .code-point-title`)
                .html(char['name'] + '<br/>(left click to enter; right click to show in table)');
            $(`.code-list .code-point[data-code=${char['code']}] .code-point-char`)
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

        // search
        case 'search':
            // select the search tab
            $('.tab[data-header=Search]').trigger('click');
            $('#results').html('');
            $('#main-container').scrollTop(0);

            var results = arg['results'];
            defaultText = null;
            if (results.length === 0) {
                $('#no-results').text('No results found.').css('display', 'block');
            } else {
                $('#no-results').css('display', 'none');
                var isFirst = true;

                results.forEach(result => {
                    switch (result.type) {
                        case 'char':
                            var char = result.char;

                            var codeString = result.codes[0].toString(16).toUpperCase();
                            while (codeString.length < 4) codeString = '0' + codeString;
                            if (result.matchedProperties.includes('code')) {
                                codeString = `<span class="emphasis">${codeString}</span>`;
                            }

                            // show highlights in char name using <span class="emphasis">
                            var name = char['name'] ? char['name'] : '';
                            result.matchedProperties.forEach(item => {
                                if (item.startsWith('name:')) {
                                    var keyword = item.substring(5).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                                    name = name.replace(new RegExp('\\b' + keyword + '\\b', 'gi'), '<<$&>>');
                                }
                            });
                            name = name.replaceAll('>> <<', ' ').replaceAll('>>-<<', '-').replaceAll('>><<', '')
                                .replaceAll('<<', '<span class="emphasis">').replaceAll('>>', '</span>');
                            var displayName = char['type'] == 'char' ?
                                name.replace(/&lt;([^&]+)&gt;/g, '<span class="dim">&lt;$1&gt;</span>') :
                                char['type'] == 'surrogate' ? '<span class="dim">&lt;surrogate&gt;</span>' :
                                char['type'] == 'noncharacter' ? '<span class="dim">&lt;not a character&gt;</span>' :
                                '<span class="dim">&lt;unassigned&gt;</span>';
                            var isPrivateUse = char.type === 'char' && name.includes('&lt;private use&gt;');

                            var html = `<div class="search-result">`;
                            if (isPrivateUse) {
                                html += `<div class="code-point" data-code="${char.code}">
                                    <div class="code-point-char"></div>
                                </div>`;
                            } else if (char.type === 'char') {
                                html += `<div class="code-point" data-code="${char.code}" data-title>
                                    <div class="code-point-char">${getHtmlChar(result.codes[0])}</div>
                                    <div class="code-point-title">(left click to enter; right click to show in table)</div>
                                </div>`;
                            } else {
                                html += `<div class="code-point" data-code="${char.code}" data-title data-disabled>
                                    <div class="code-point-char disabled"></div>
                                    <div class="code-point-title">(left click to enter)</div>
                                </div>`;
                            }
                            html += `<div class="result-contents">
                                <div class="result-char-code">U+${codeString}</div>
                                <div class="result-char-name">${displayName}</div>
                                <table>`;
                            
                            // decimal code
                            var hasDecimalCode = result.matchedProperties.includes('decimal-code');
                            html += `<tr><td class="result-property-header">Decimal Code&nbsp;</td>
                                <td class="result-property"><span${hasDecimalCode ? ' class="emphasis"' : ''}>${result.codes[0]}</span></td></tr>`;

                            // decomposition
                            if (result.matchedProperties.includes('decomp')) {
                                html += `<tr><td class="result-property-header">Decomposition&nbsp;</td>
                                    <td class="result-property"><span class="emphasis">${htmlEncode(char.decomp)}</span></td></tr>`;
                            }

                            // html
                            if (char.html) {
                                html += `<tr><td class="result-property-header">HTML Entity&nbsp;</td><td class="result-property">`;
                                char.html.forEach(item => {
                                    var isMatch = result.matchedProperties.includes('html:' + item);
                                    html += `<span class="code${isMatch ? ' emphasis' : ''}">&amp;${item};</span>`;
                                });
                                html += `</td></tr>`;
                            }

                            // latex
                            if (char.latex) {
                                html += `<tr><td class="result-property-header">LaTeX&nbsp;</td><td class="result-property">`;
                                char.latex.forEach(item => {
                                    var isMatch = result.matchedProperties.includes('latex:' + item);
                                    html += `<span class="code${isMatch ? ' emphasis' : ''}">${item}</span>`;
                                });
                                html += `</td></tr>`;
                            }

                            html += `</table></div>`;
                            var elem = $(html);

                            if (isFirst) {
                                isFirst = false;
                                defaultText = String.fromCodePoint(char.code);
                            }
                            if (char.type === 'char' && !isPrivateUse) {
                                elem.find('.code-point').mousedown(function (event) {
                                    if (event.buttons === 1) { // left button
                                        onClickCodePoint($(this), 'input');
                                    } else if (event.buttons === 2) { // right button
                                        onClickCodePoint($(this), 'go-to-char');
                                    }
                                });
                            } else {
                                elem.find('.code-point').mousedown(function (event) {
                                    if (event.buttons === 1) { // left button
                                        onClickCodePoint($(this), 'input');
                                    }
                                });
                                elem.find('.code-point[data-title]').hover(function () {
                                    onShowTitle($(this));
                                });
                                if (isPrivateUse) {
                                    elem.find('.code-point').hover(function () {
                                        onCharHover($(this));
                                    }, onCharHoverOut);
                                }
                            }

                            $('#results').append(elem);
                            break;
                        case 'sequence':
                            var codes = result.codes.map(i => toHex(i).toUpperCase());
                            var sequence = getSequence(codes.join(' '));
                            if (!sequence) break;

                            var codesString = codes.map(s => 'U+' + s).join(' ');

                            // show highlights in sequence name using <span class="emphasis">
                            var name = sequence.name;
                            result.matchedProperties.forEach(item => {
                                if (item.startsWith('name:')) {
                                    var keyword = item.substring(5).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                                    name = name.replace(new RegExp('\\b' + keyword + '\\b', 'gi'), '<<$&>>');
                                }
                            });
                            name = name.replaceAll('>> <<', ' ').replaceAll('>>-<<', '-').replaceAll('>><<', '')
                                .replaceAll('<<', '<span class="emphasis">').replaceAll('>>', '</span>');

                            var html = `<div class="search-result">
                                <div class="code-point" data-codes="${sequence.codes}" data-title>
                                    <div class="code-point-char">${getHtmlChar(sequence.codes)}</div>
                                    <div class="code-point-title">(click to enter)</div>
                                </div>
                                <div class="result-contents">
                                <div class="result-char-code">${codesString}</div>
                                <div class="result-char-name">${name}</div>
                                <table>`;
                            if (sequence.type)
                                html +=
                                    `<tr><td class="result-property-header">Type&nbsp;</td>
                                    <td class="result-property">${sequence.type}</td></tr>`;
                            html +=
                                    `<tr><td class="result-property-header vertical-center">Code Points</td>
                                    <td class="result-property">
                                        <div class="code-list">`;
                            result.codes.forEach(code => {
                                html += 
                                            `<div class="code-point" data-code="${code}" data-title>
                                                <div class="code-point-char">${getHtmlChar(code)}</div>
                                                <div class="code-point-number"><div>${toHex(code)}</div></div>
                                                <div class="code-point-title"></div>
                                            </div>`
                            });
                            html += `</div></td></tr>`;
                            html += `</table></div>`;
                            var elem = $(html);

                            if (isFirst) {
                                isFirst = false;
                                defaultText = result.codes.map(i => String.fromCodePoint(i)).join('');
                            }
                            elem.find('.code-point').mousedown(function (event) {
                                if (event.buttons === 1) { // left button
                                    onClickCodePoint($(this), 'input');
                                } else if (event.buttons === 2) { // left button
                                    onClickCodePoint($(this), 'go-to-char');
                                }
                            });
                            elem.find('.code-point[data-title]').hover(function () {
                                onShowTitle($(this));
                            });

                            $('#results').append(elem);

                            // set mouse hover text for code points
                            result.codes.forEach(code => {
                                ipcRenderer.send('asynchronous-message', {
                                    'type': 'get-char-name',
                                    'code': code
                                });
                            });
                            break;
                    }
                });
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
        case 'normalise-nfc':
            onNormalise('NFC');
            break;
        case 'normalise-nfd':
            onNormalise('NFD');
            break;
        case 'normalise-nfkc':
            onNormalise('NFKC');
            break;
        case 'normalise-nfkd':
            onNormalise('NFKD');
            break;
        case 'about':
            showPopup('Unicode Table', 
                `Version: ${arg.versions['app']}<br/>` +
                `Repository: <a href="https://github.com/abccsss/unicode-table">` +
                `<span class="code">https://github.com/abccsss/unicode-table</span></a><br/><br/>` +
                `Unicode: ${arg.versions['unicode-full']}<br/>` +
                `Electron: ${arg.versions['electron']}<br/>` +
                `Chrome: ${arg.versions['chrome']}<br/>` +
                `Node.js: ${arg.versions['node']}`
            );
            break;
    }
});

