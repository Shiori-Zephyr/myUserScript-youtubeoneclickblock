// ==UserScript==
// @name         YouTube One-Click Block
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Adds block buttons to YouTube comments, homepage videos, sidebar recommendations, search results, and channel pages
// @author       Shiori
// @match        https://www.youtube.com/*
// @match        https://youtube.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    const BLOCK_BUTTON_CLASS = 'yt-quick-block-btn';
    const PROCESSED_ATTR = 'data-quick-block-added';
    const HIDDEN_ATTR = 'data-quick-block-hidden';
    const STORAGE_KEY = 'ytBlockedChannels';

    // Load blocked channels into a Set for O(1) lookup
    let blockedChannels = [];
    let blockedSet = new Set();
    try {
        blockedChannels = JSON.parse(GM_getValue(STORAGE_KEY, '[]'));
        blockedSet = new Set(blockedChannels.map(c => c.toLowerCase().trim()));
    } catch (e) {
        blockedChannels = [];
        blockedSet = new Set();
    }

    // Listen for changes from other tabs
    GM_addValueChangeListener(STORAGE_KEY, (name, oldValue, newValue, remote) => {
        if (remote) {
            try {
                blockedChannels = JSON.parse(newValue);
                rebuildBlockedSet();
                hideAllBlocked();
                updateAllBlockButtons();
                updatePanel();
                console.log('YouTube Block: Synced from another tab, now blocking', blockedChannels.length, 'channels');
            } catch (e) {
                console.error('YouTube Block: Failed to sync from other tab', e);
            }
        }
    });

    // CSS
    const style = document.createElement('style');
    style.textContent = `
        .${BLOCK_BUTTON_CLASS} {
            background: transparent;
            border: 1px solid #666;
            color: #aaa;
            cursor: pointer;
            font-size: 10px;
            padding: 2px 6px;
            border-radius: 3px;
            margin-left: 6px;
            transition: all 0.15s;
            vertical-align: middle;
            font-family: Roboto, Arial, sans-serif;
        }
        .${BLOCK_BUTTON_CLASS}:hover {
            background: #cc0000;
            color: white;
            border-color: #cc0000;
        }
        .${BLOCK_BUTTON_CLASS}.done {
            background: #333;
            color: #666;
            border-color: #333;
            pointer-events: none;
        }
        .${BLOCK_BUTTON_CLASS}.channel-page-btn {
            font-size: 14px;
            padding: 10px 20px;
            margin-left: 0;
            border-radius: 20px;
            font-weight: 500;
        }
        .yt-blocked-item {
            display: none !important;
        }
        #yt-block-panel {
            position: fixed;
            top: 60px;
            right: 20px;
            background: #212121;
            border: 1px solid #444;
            border-radius: 8px;
            padding: 15px;
            z-index: 9999;
            max-width: 300px;
            max-height: 400px;
            overflow-y: auto;
            display: none;
            color: #fff;
            font-family: Roboto, Arial, sans-serif;
        }
        #yt-block-panel.show {
            display: block;
        }
        #yt-block-panel h3 {
            margin: 0 0 10px 0;
            font-size: 14px;
        }
        #yt-block-panel .blocked-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 5px 0;
            border-bottom: 1px solid #333;
            font-size: 12px;
        }
        #yt-block-panel .unblock-btn {
            background: #666;
            border: none;
            color: #fff;
            padding: 2px 8px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 10px;
        }
        #yt-block-panel .unblock-btn:hover {
            background: #888;
        }
        #yt-block-toggle {
            position: fixed;
            top: 60px;
            right: 20px;
            background: #cc0000;
            color: white;
            border: none;
            padding: 8px 12px;
            border-radius: 4px;
            cursor: pointer;
            z-index: 9998;
            font-size: 12px;
            font-family: Roboto, Arial, sans-serif;
        }
        #yt-block-panel .panel-buttons {
            display: flex;
            gap: 5px;
            margin-bottom: 10px;
        }
        #yt-block-panel .panel-btn {
            flex: 1;
            background: #444;
            border: none;
            color: #fff;
            padding: 5px 8px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 11px;
        }
        #yt-block-panel .panel-btn:hover {
            background: #555;
        }
        #yt-block-panel .panel-btn.export {
            background: #2a6;
        }
        #yt-block-panel .panel-btn.export:hover {
            background: #3b7;
        }
        #yt-block-panel .panel-btn.import {
            background: #26a;
        }
        #yt-block-panel .panel-btn.import:hover {
            background: #37b;
        }
        #yt-import-file {
            display: none;
        }
    `;
    document.head.appendChild(style);

    function saveBlockedChannels() {
        GM_setValue(STORAGE_KEY, JSON.stringify(blockedChannels));
    }

    function rebuildBlockedSet() {
        blockedSet = new Set(blockedChannels.map(c => c.toLowerCase().trim()));
    }

    function exportBlocklist() {
        const data = JSON.stringify(blockedChannels, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `youtube-blocklist-${new Date().toISOString().slice(0,10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function importBlocklist(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const imported = JSON.parse(e.target.result);
                if (!Array.isArray(imported)) {
                    alert('Invalid format: expected an array');
                    return;
                }
                const before = blockedChannels.length;
                imported.forEach(channel => {
                    if (typeof channel === 'string' && !blockedSet.has(channel.toLowerCase().trim())) {
                        blockedChannels.push(channel);
                        blockedSet.add(channel.toLowerCase().trim());
                    }
                });
                saveBlockedChannels();
                hideAllBlocked();
                updatePanel();
                const added = blockedChannels.length - before;
                alert(`Imported ${added} new channels (${imported.length - added} duplicates skipped)`);
            } catch (err) {
                alert('Failed to parse JSON: ' + err.message);
            }
        };
        reader.readAsText(file);
    }

    function getHandleFromHref(href) {
        if (!href) return null;
        const match = href.match(/\/@([^\/\?]+)/);
        return match ? decodeURIComponent(match[1]) : null;
    }

    function getHandleFromUrl() {
        const match = location.pathname.match(/^\/@([^\/\?]+)/);
        return match ? decodeURIComponent(match[1]) : null;
    }

    // O(1) lookup using Set
    function isBlocked(identifier) {
        if (!identifier) return false;
        return blockedSet.has(identifier.toLowerCase().trim());
    }

    function blockChannel(identifier, displayName, button) {
        if (!identifier) return;
        const normalized = identifier.toLowerCase().trim();
        if (!blockedSet.has(normalized)) {
            blockedChannels.push(identifier);
            blockedSet.add(normalized);
            saveBlockedChannels();
        }
        if (button) {
            button.textContent = '✓';
            button.classList.add('done');
        }
        hideAllBlocked();
        updatePanel();
        console.log(`Blocked: ${displayName || identifier}`);
    }

    function unblockChannel(identifier) {
        const normalized = identifier.toLowerCase().trim();
        blockedChannels = blockedChannels.filter(c => c.toLowerCase().trim() !== normalized);
        blockedSet.delete(normalized);
        saveBlockedChannels();
        // Remove hidden class from all items
        document.querySelectorAll('.yt-blocked-item').forEach(el => {
            el.classList.remove('yt-blocked-item');
            el.removeAttribute(HIDDEN_ATTR);
        });
        // Update channel page button if on that channel
        updateChannelPageButton();
        updatePanel();
    }

    // Update all block buttons to reflect current state
    function updateAllBlockButtons() {
        document.querySelectorAll(`.${BLOCK_BUTTON_CLASS}`).forEach(btn => {
            const identifier = btn.dataset.identifier;
            const displayName = btn.dataset.displayName;
            if (isBlocked(identifier) || isBlocked(displayName)) {
                btn.textContent = '✓';
                btn.classList.add('done');
            } else {
                btn.textContent = 'Block';
                btn.classList.remove('done');
            }
        });
    }

    // Check and hide a single element - returns true if hidden
    function checkAndHide(element, handle, displayName) {
        if (element.hasAttribute(HIDDEN_ATTR)) return element.classList.contains('yt-blocked-item');
        element.setAttribute(HIDDEN_ATTR, 'true');

        if ((handle && isBlocked(handle)) || (displayName && isBlocked(displayName))) {
            element.classList.add('yt-blocked-item');
            return true;
        }
        return false;
    }

    // Process only new elements that haven't been checked
    function hideNewContent(elements) {
        if (blockedChannels.length === 0) return;

        elements.forEach(item => {
            if (item.hasAttribute(HIDDEN_ATTR)) return;

            let handle = null;
            let displayName = null;
            let container = item;

            // Determine type and extract info
            if (item.matches('ytd-comment-view-model, ytd-comment-renderer')) {
                const authorLink = item.querySelector('#author-text');
                if (authorLink) {
                    handle = getHandleFromHref(authorLink.href);
                    displayName = authorLink.textContent?.trim();
                    container = item.closest('ytd-comment-thread-renderer') || item;
                }
            } else if (item.matches('yt-lockup-view-model')) {
                const avatarLabel = item.querySelector('[aria-label*="前往頻道"], [aria-label*="Go to channel"], [aria-label*="チャンネル"]');
                if (avatarLabel) {
                    const label = avatarLabel.getAttribute('aria-label');
                    const match = label.match(/[:：]\s*(.+)$/);
                    displayName = match ? match[1].trim() : null;
                }
                if (!displayName) {
                    const metadataText = item.querySelector('yt-content-metadata-view-model .yt-content-metadata-view-model__metadata-text');
                    displayName = metadataText?.textContent?.trim();
                }
                const channelLink = item.querySelector('a[href^="/@"]');
                handle = channelLink ? getHandleFromHref(channelLink.href) : null;
                container = item.closest('ytd-rich-item-renderer') || item;
            } else if (item.matches('ytd-rich-item-renderer')) {
                if (item.querySelector('yt-lockup-view-model')) return;
                const channelLink = item.querySelector('a[href^="/@"]');
                if (channelLink) {
                    handle = getHandleFromHref(channelLink.href);
                    displayName = channelLink.textContent?.trim();
                }
            } else if (item.matches('ytd-compact-video-renderer')) {
                const channelLink = item.querySelector('a[href^="/@"]');
                if (channelLink) {
                    handle = getHandleFromHref(channelLink.href);
                    displayName = channelLink.textContent?.trim();
                }
            } else if (item.matches('ytd-video-renderer')) {
                const channelNameEl = item.querySelector('ytd-channel-name a');
                if (channelNameEl) {
                    handle = getHandleFromHref(channelNameEl.href);
                    displayName = channelNameEl.textContent?.trim();
                }
            }

            checkAndHide(container, handle, displayName);
        });
    }

    // Full scan - only for initial load or after unblock
    function hideAllBlocked() {
        if (blockedChannels.length === 0) return;

        // Reset hidden attributes to re-check everything
        document.querySelectorAll(`[${HIDDEN_ATTR}]`).forEach(el => {
            el.removeAttribute(HIDDEN_ATTR);
            el.classList.remove('yt-blocked-item');
        });

        const selectors = [
            'ytd-comment-view-model', 'ytd-comment-renderer',
            'yt-lockup-view-model', 'ytd-rich-item-renderer',
            'ytd-compact-video-renderer', 'ytd-video-renderer'
        ];

        hideNewContent(document.querySelectorAll(selectors.join(',')));
    }

    function createBlockButton(identifier, displayName, extraClass) {
        const button = document.createElement('button');
        button.className = BLOCK_BUTTON_CLASS;
        if (extraClass) button.classList.add(extraClass);
        button.textContent = 'Block';
        button.title = `Block ${displayName || identifier}`;
        button.dataset.identifier = identifier || '';
        button.dataset.displayName = displayName || '';
        if (isBlocked(identifier) || isBlocked(displayName)) {
            button.textContent = '✓';
            button.classList.add('done');
        }
        button.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            blockChannel(identifier || displayName, displayName, button);
        });
        return button;
    }

    function processComments() {
        document.querySelectorAll('ytd-comment-view-model, ytd-comment-renderer').forEach(comment => {
            if (comment.hasAttribute(PROCESSED_ATTR)) return;
            comment.setAttribute(PROCESSED_ATTR, 'true');
            const authorLink = comment.querySelector('#author-text');
            if (!authorLink) return;
            const handle = getHandleFromHref(authorLink.href);
            const displayName = authorLink.textContent?.trim();
            if (!handle && !displayName) return;
            const button = createBlockButton(handle, displayName);
            const headerAuthor = comment.querySelector('#header-author');
            if (headerAuthor) {
                headerAuthor.appendChild(button);
            }
            // Check hide for this specific comment
            const container = comment.closest('ytd-comment-thread-renderer') || comment;
            checkAndHide(container, handle, displayName);
        });
    }

    function processLockupVideos() {
        document.querySelectorAll('yt-lockup-view-model').forEach(item => {
            if (item.hasAttribute(PROCESSED_ATTR)) return;
            item.setAttribute(PROCESSED_ATTR, 'true');
            const avatarLabel = item.querySelector('[aria-label*="前往頻道"], [aria-label*="Go to channel"], [aria-label*="チャンネル"]');
            let channelName = null;
            if (avatarLabel) {
                const label = avatarLabel.getAttribute('aria-label');
                const match = label.match(/[:：]\s*(.+)$/);
                channelName = match ? match[1].trim() : null;
            }
            if (!channelName) {
                const metadataText = item.querySelector('yt-content-metadata-view-model .yt-content-metadata-view-model__metadata-text');
                channelName = metadataText?.textContent?.trim();
            }
            const channelLink = item.querySelector('a[href^="/@"]');
            const handle = channelLink ? getHandleFromHref(channelLink.href) : null;
            if (!channelName && !handle) return;
            const button = createBlockButton(handle, channelName);
            const metadata = item.querySelector('yt-lockup-metadata-view-model');
            if (metadata) {
                const metadataRow = metadata.querySelector('.yt-content-metadata-view-model__metadata-row');
                if (metadataRow) {
                    metadataRow.appendChild(button);
                } else {
                    metadata.appendChild(button);
                }
            }
            // Check hide
            const container = item.closest('ytd-rich-item-renderer') || item;
            checkAndHide(container, handle, channelName);
        });
    }

    function processSearchResults() {
        document.querySelectorAll('ytd-video-renderer').forEach(item => {
            if (item.hasAttribute(PROCESSED_ATTR)) return;
            item.setAttribute(PROCESSED_ATTR, 'true');
            const channelNameEl = item.querySelector('ytd-channel-name a');
            if (!channelNameEl) return;
            const handle = getHandleFromHref(channelNameEl.href);
            const displayName = channelNameEl.textContent?.trim();
            if (!handle && !displayName) return;
            const button = createBlockButton(handle, displayName);
            const channelContainer = item.querySelector('ytd-channel-name #container');
            if (channelContainer) {
                channelContainer.appendChild(button);
            } else {
                channelNameEl.parentElement?.appendChild(button);
            }
            checkAndHide(item, handle, displayName);
        });
    }

    function processSidebar() {
        document.querySelectorAll('ytd-compact-video-renderer').forEach(item => {
            if (item.hasAttribute(PROCESSED_ATTR)) return;
            item.setAttribute(PROCESSED_ATTR, 'true');
            const channelLink = item.querySelector('a[href^="/@"]');
            if (!channelLink) return;
            const handle = getHandleFromHref(channelLink.href);
            const displayName = channelLink.textContent?.trim();
            if (!handle && !displayName) return;
            const button = createBlockButton(handle, displayName);
            channelLink.parentElement?.appendChild(button);
            checkAndHide(item, handle, displayName);
        });
    }

    // New: Process channel page
    function processChannelPage() {
        // Check if we're on a channel page
        if (!location.pathname.startsWith('/@')) return;

        // Check if button already exists
        if (document.querySelector('#yt-channel-block-btn')) return;

        // Get channel info from URL
        const handle = getHandleFromUrl();
        if (!handle) return;

        // Try multiple possible header structures
        const header = document.querySelector('ytd-c4-tabbed-header-renderer');

        // Get display name
        let displayName = null;
        if (header) {
            const channelNameEl = header.querySelector('#channel-name yt-formatted-string, #channel-name, yt-dynamic-text-view-model');
            displayName = channelNameEl?.textContent?.trim();
        }

        // New layout: yt-flexible-actions-view-model
        const flexActions = document.querySelector('yt-flexible-actions-view-model');
        if (flexActions) {
            const wrapper = document.createElement('div');
            wrapper.className = 'ytFlexibleActionsViewModelAction';

            const button = createBlockButton(handle, displayName || handle, 'channel-page-btn');
            button.id = 'yt-channel-block-btn';

            wrapper.appendChild(button);
            flexActions.appendChild(wrapper);
            return;
        }

        // Old layout fallback
        const buttonContainers = [
            '#buttons',
            '#subscribe-button',
            'ytd-subscribe-button-renderer',
            '#inner-header-container #buttons',
            '#channel-header #buttons'
        ];

        let targetContainer = null;
        for (const selector of buttonContainers) {
            targetContainer = document.querySelector(selector);
            if (targetContainer) break;
        }

        if (!targetContainer) return;

        const button = createBlockButton(handle, displayName || handle, 'channel-page-btn');
        button.id = 'yt-channel-block-btn';
        targetContainer.appendChild(button);
    }

    function updateChannelPageButton() {
        const btn = document.querySelector('#yt-channel-block-btn');
        if (!btn) return;

        const handle = getHandleFromUrl();
        if (isBlocked(handle)) {
            btn.textContent = '✓';
            btn.classList.add('done');
        } else {
            btn.textContent = 'Block';
            btn.classList.remove('done');
        }
    }

    function createPanel() {
        if (document.querySelector('#yt-block-toggle')) return;

        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'yt-block-toggle';
        toggleBtn.textContent = `Blocked (${blockedChannels.length})`;
        document.body.appendChild(toggleBtn);

        const panel = document.createElement('div');
        panel.id = 'yt-block-panel';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;';

        const title = document.createElement('h3');
        title.textContent = 'Blocked Channels';
        title.style.margin = '0';

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        closeBtn.style.cssText = 'background:none;border:none;color:#888;font-size:16px;cursor:pointer;padding:0 4px;';
        closeBtn.addEventListener('click', () => panel.classList.remove('show'));
        closeBtn.addEventListener('mouseenter', () => closeBtn.style.color = '#fff');
        closeBtn.addEventListener('mouseleave', () => closeBtn.style.color = '#888');

        header.appendChild(title);
        header.appendChild(closeBtn);
        panel.appendChild(header);

        const btnContainer = document.createElement('div');
        btnContainer.className = 'panel-buttons';

        const exportBtn = document.createElement('button');
        exportBtn.className = 'panel-btn export';
        exportBtn.textContent = 'Export';
        exportBtn.addEventListener('click', exportBlocklist);

        const importBtn = document.createElement('button');
        importBtn.className = 'panel-btn import';
        importBtn.textContent = 'Import';

        const importFile = document.createElement('input');
        importFile.type = 'file';
        importFile.id = 'yt-import-file';
        importFile.accept = '.json';
        importFile.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                importBlocklist(e.target.files[0]);
                e.target.value = '';
            }
        });

        importBtn.addEventListener('click', () => importFile.click());

        btnContainer.appendChild(exportBtn);
        btnContainer.appendChild(importBtn);
        panel.appendChild(btnContainer);
        panel.appendChild(importFile);

        const list = document.createElement('div');
        list.id = 'yt-block-list';
        panel.appendChild(list);

        document.body.appendChild(panel);

        toggleBtn.addEventListener('click', () => {
            panel.classList.toggle('show');
        });

        updatePanel();
    }

    function updatePanel() {
        const list = document.querySelector('#yt-block-list');
        const toggle = document.querySelector('#yt-block-toggle');

        if (toggle) {
            toggle.textContent = `Blocked (${blockedChannels.length})`;
        }

        if (list) {
            while (list.firstChild) {
                list.removeChild(list.firstChild);
            }

            if (blockedChannels.length === 0) {
                const empty = document.createElement('div');
                empty.style.cssText = 'color:#888;font-size:12px;';
                empty.textContent = 'No blocked channels';
                list.appendChild(empty);
            } else {
                blockedChannels.forEach(channel => {
                    const item = document.createElement('div');
                    item.className = 'blocked-item';

                    const span = document.createElement('span');
                    span.textContent = channel;

                    const btn = document.createElement('button');
                    btn.className = 'unblock-btn';
                    btn.textContent = 'Unblock';
                    btn.addEventListener('click', () => unblockChannel(channel));

                    item.appendChild(span);
                    item.appendChild(btn);
                    list.appendChild(item);
                });
            }
        }
    }

    function processAll() {
        processComments();
        processLockupVideos();
        processSearchResults();
        processSidebar();
        processChannelPage();
    }

    // Targeted observer - only watch specific containers
    function setupObservers() {
        const config = { childList: true, subtree: true };
        let debounceTimer = null;

        const debouncedProcess = () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(processAll, 200);
        };

        // Main observer for dynamic content
        const mainObserver = new MutationObserver((mutations) => {
            // Quick check: only process if relevant elements were added
            let hasRelevant = false;
            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === 1) {
                            const tag = node.tagName?.toLowerCase();
                            if (tag === 'ytd-comment-view-model' ||
                                tag === 'ytd-comment-renderer' ||
                                tag === 'yt-lockup-view-model' ||
                                tag === 'ytd-rich-item-renderer' ||
                                tag === 'ytd-compact-video-renderer' ||
                                tag === 'ytd-video-renderer' ||
                                tag === 'ytd-c4-tabbed-header-renderer' ||
                                node.querySelector?.('ytd-comment-view-model, ytd-comment-renderer, yt-lockup-view-model, ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-video-renderer, ytd-c4-tabbed-header-renderer')) {
                                hasRelevant = true;
                                break;
                            }
                        }
                    }
                }
                if (hasRelevant) break;
            }

            if (hasRelevant) {
                debouncedProcess();
            }
        });

        // Watch the main content area
        const watchTargets = [
            '#content',
            '#primary',
            '#secondary',
            'ytd-comments',
            'ytd-watch-flexy',
            'ytd-browse'
        ];

        // Start observing once targets exist
        const tryObserve = () => {
            let observed = false;
            for (const selector of watchTargets) {
                const el = document.querySelector(selector);
                if (el) {
                    mainObserver.observe(el, config);
                    observed = true;
                }
            }

            // Fallback to body if no specific targets found
            if (!observed) {
                mainObserver.observe(document.body, config);
            }
        };

        // Initial attempt
        tryObserve();

        // Re-check on navigation (YouTube SPA)
        let lastUrl = location.href;
        const urlObserver = new MutationObserver(() => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                // Remove old channel button on navigation
                const oldBtn = document.querySelector('#yt-channel-block-btn');
                if (oldBtn) oldBtn.remove();
                setTimeout(() => {
                    tryObserve();
                    processAll();
                }, 500);
            }
        });
        urlObserver.observe(document.body, { childList: true, subtree: true });
    }

    // Initialize
    setTimeout(() => {
        createPanel();
        processAll();
        setupObservers();
    }, 1000);

    console.log('YouTube One-Click Block v1.1 loaded');
})();
