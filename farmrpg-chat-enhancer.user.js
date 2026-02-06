// ==UserScript==
// @name         FarmRPG Chat Enhancer v1.5.0
// @namespace    http://tampermonkey.net/
// @version      1.5.0
// @description  Smart chat enhancements: mention notifications, message highlighting, session separator, attention pins, and keyword alerts for FarmRPG chat. Designed to improve chat experience with customizable features and persistent settings.
// @author       Cadis Etrama Di Raizel
// @match        https://farmrpg.com/
// @match        https://*.farmrpg.com/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=farmrpg.com
// @grant        GM_notification
// @grant        none
// ==/UserScript==

/**
 * FARMRPG CHAT ENHANCER
 * =====================
 *
 * FarmRPG chat:
 * - Chat container: #chatzoneDesktop (desktop) or #chatzoneMobile (mobile)
 * - Message elements have class: .chat-txt
 * - Messages have a specific structure:
 *   - child[0]: timestamp
 *   - child[2]: username
 *   - child[5] or children[5]: message text content
 * - Profile links format: profile.php?user_name=<username>
 * - Usernames can have spaces replaced with "+"
 *
 * Features implemented:
 * 1. Mention notifications (desktop notifications when your username appears)
 * 2. Message highlighting (border around your own messages)
 * 3. Session separator (visual marker for new messages after reload)
 * 4. Attention markers (pin messages for later - clears on reload)
 * 5. Keyword watcher (highlight messages containing specific items)
 **/

"use strict";

// ============================================================================
// CONFIGURATION & STATE
// ============================================================================

const CONFIG = {
  STORAGE_KEY: "farmrpg_chat_username",
  SEEN_MESSAGES_KEY: "farmrpg_seen_messages",
  MAX_SEEN_MESSAGES: 100,
  HIGHLIGHT_BORDER: "3px solid #fb7a24",
  SEPARATOR_COLOR: "#fb7a24",
  CHAT_SELECTORS: ["#chatzoneDesktop", "#chatzoneMobile"],
  MARKER_COLOR: "#ffd700",
  MARKER_BORDER: "3px solid #ffd700",
  MARKER_BG: "rgba(255, 215, 0, 0.1)",
  MARKER_ICON: "📌",
  KEYWORDS_STORAGE_KEY: "farmrpg_chat_keywords",
  KEYWORD_HIGHLIGHT_COLOR: "#a855f7",
  KEYWORD_HIGHLIGHT_BG: "rgba(168, 85, 247, 0.15)",
};

// Global state
const state = {
  username: null,
  observer: null,
  seenMessages: new Set(),
  lastKnownMessage: null,
  markedMessages: new Set(),
  keywords: new Set(),
  keywordMatches: new Set(),
  features: {
    mentions: false,
    highlighting: false,
    separator: false,
    markers: false,
    keywords: false,
  },
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Sanitize username - remove @ prefix and : suffix, handle spaces
 */
function sanitizeUsername(username) {
  if (!username) return "";

  let clean = username.trim();
  if (clean.startsWith("@")) clean = clean.slice(1);
  if (clean.endsWith(":")) clean = clean.slice(0, -1);

  return clean;
}

/**
 * Normalize username for comparison (handle + to space conversion)
 */
function normalizeUsername(username) {
  return sanitizeUsername(username).toLowerCase().replace(/\+/g, " ");
}

/**
 * Get stored username
 */
function getStoredUsername() {
  try {
    const stored = localStorage.getItem(CONFIG.STORAGE_KEY);
    console.log("[Chat] Retrieved stored username:", stored);
    return stored ? JSON.parse(stored) : null;
  } catch (e) {
    console.error("[Chat] Failed to get username:", e);
    return null;
  }
}

/**
 * Save username
 */
function saveUsername(username) {
  try {
    localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(username));
    console.log("[Chat] Saved username:", username);
  } catch (e) {
    console.error("[Chat] Failed to save username:", e);
  }
}

/**
 * Clear username
 */
function clearUsername() {
  try {
    localStorage.removeItem(CONFIG.STORAGE_KEY);
    localStorage.removeItem(CONFIG.SEEN_MESSAGES_KEY);
    console.log("[Chat] Cleared username and seen messages");
  } catch (e) {
    console.error("[Chat] Failed to clear username:", e);
  }
}

/**
 * Find chat container with retries
 */
async function findChatContainer(maxAttempts = 20, delay = 200) {
  for (let i = 0; i < maxAttempts; i++) {
    for (const selector of CONFIG.CHAT_SELECTORS) {
      const container = document.querySelector(selector);
      if (container) {
        console.log("[Chat] Found container:", selector);
        return container;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new Error("[Chat] Could not find chat container");
}

/**
 * Request notification permission (Browser notifications fallback)
 */
async function requestNotificationPermission() {
  if (typeof GM_notification === "undefined") {
    // Fallback to browser notifications
    if (Notification.permission === "default") {
      await Notification.requestPermission();
    }
    return Notification.permission === "granted";
  }
  return true;
}

/**
 * Show notification
 */
function showNotification(title, message) {
  if (typeof GM_notification !== "undefined") {
    GM_notification({
      title: title,
      text: message,
      timeout: 5000,
    });
  } else if (Notification.permission === "granted") {
    new Notification(title, { body: message });
  }
}

/**
 * Create a fingerprint for a message to detect duplicates
 */
function getMessageFingerprint(messageElement) {
  // Use timestamp + text content as fingerprint
  const timestamp = messageElement.children[0]?.textContent || "";
  const text =
    messageElement.children[5]?.textContent ||
    messageElement.children[5]?.innerText ||
    "";
  return `${timestamp}:${text}`.trim();
}

/**
 * Load keywords from storage
 */
function loadKeywords() {
  try {
    const stored = localStorage.getItem(CONFIG.KEYWORDS_STORAGE_KEY);
    if (stored) {
      const keywords = JSON.parse(stored);
      state.keywords = new Set(keywords.map((k) => k.toLowerCase()));
      console.log("[Chat] Loaded keywords:", Array.from(state.keywords));
    }
  } catch (e) {
    console.error("[Chat] Failed to load keywords:", e);
  }
}

/**
 * Save keywords to storage
 */
function saveKeywords() {
  try {
    const keywords = Array.from(state.keywords);
    localStorage.setItem(CONFIG.KEYWORDS_STORAGE_KEY, JSON.stringify(keywords));
    console.log("[Chat] Saved keywords:", keywords);
  } catch (e) {
    console.error("[Chat] Failed to save keywords:", e);
  }
}

/**
 * Extract item names from ((item)) format
 */
function extractItems(textContainer) {
  const items = [];
  const childNodes = textContainer.children;
  if (childNodes.length === 0) return items;

  for (const element of childNodes) {
    if (element.matches("a")) {
      if (element.children.length && element.children[0].matches("img")) {
        items.push(element.children[0].alt);
      }
    }
  }
  return items;
}

/**
 * Check if text contains any keywords or items
 */
function matchesKeywords(textContainer) {
  if (state.keywords.size === 0) return null;

  const items = extractItems(textContainer);

  // Check item names
  for (const item of items) {
    for (const keyword of state.keywords) {
      if (item.toLowerCase().includes(keyword)) {
        return keyword;
      }
    }
  }

  return null;
}

// ============================================================================
// FEATURE: MENTION WATCHER
// ============================================================================

function checkForMentions(messages) {
  if (!state.features.mentions || !state.username) return;

  const username = state.username.toLowerCase();

  for (const msg of messages) {
    // Get message text from child[5]
    const textContainer = msg.children[5];
    if (!textContainer) continue;

    const text = textContainer.innerText || textContainer.textContent;
    if (!text) continue;

    // Check if username is mentioned (case-insensitive)
    if (!text.toLowerCase().includes(username)) continue;

    // Check if we've already seen this message
    const fingerprint = getMessageFingerprint(msg);
    if (state.seenMessages.has(fingerprint)) continue;

    // Add to seen messages
    state.seenMessages.add(fingerprint);

    // Trim seen messages if too large
    if (state.seenMessages.size > CONFIG.MAX_SEEN_MESSAGES) {
      const array = Array.from(state.seenMessages);
      state.seenMessages = new Set(array.slice(-CONFIG.MAX_SEEN_MESSAGES));
    }

    // Get author for notification
    const author = msg.children[2]?.textContent || "Someone";

    // Show notification
    showNotification(
      "You were mentioned!",
      `${author}: ${text.substring(0, 100)}`,
    );
    console.log("[Chat] Mention detected:", author, text);
  }
}

// ============================================================================
// FEATURE: MESSAGE HIGHLIGHTER
// ============================================================================

function highlightOwnMessages(messages) {
  if (!state.features.highlighting || !state.username) return;

  const normalizedUsername = normalizeUsername(state.username);

  for (const msg of messages) {
    // Find profile link in message
    const profileLink = msg.querySelector('a[href^="profile.php?user_name="]');
    if (!profileLink) continue;

    // Extract username from link
    const href = profileLink.getAttribute("href");
    const match = href.match(/user_name=(.+)$/);
    if (!match) continue;

    const messageUsername = normalizeUsername(match[1]);

    // If it's our message, highlight it
    if (messageUsername === normalizedUsername) {
      msg.style.border = CONFIG.HIGHLIGHT_BORDER;
      msg.style.borderRadius = "6px";
      msg.style.padding = "2px";
    }
  }
}

// ============================================================================
// FEATURE: SESSION SEPARATOR
// ============================================================================

function checkForSessionChange(messages, mutations) {
  if (!state.features.separator) return;

  // Check if chat was cleared (removed nodes)
  let chatWasCleared = false;
  for (const mutation of mutations) {
    if (mutation.removedNodes.length > 0) {
      chatWasCleared = true;
      break;
    }
  }

  if (!chatWasCleared) {
    // Just update last known message
    if (messages.length > 0) {
      state.lastKnownMessage = getMessageFingerprint(messages[0]);
    }
    return;
  }

  // Chat was cleared, check if last known message reappeared
  if (!state.lastKnownMessage) {
    if (messages.length > 0) {
      state.lastKnownMessage = getMessageFingerprint(messages[0]);
    }
    return;
  }

  // Find the last known message in the new messages
  for (const msg of messages) {
    const fingerprint = getMessageFingerprint(msg);
    if (fingerprint === state.lastKnownMessage) {
      insertSeparator(msg);
      break;
    }
  }

  // Update last known message
  if (messages.length > 0) {
    state.lastKnownMessage = getMessageFingerprint(messages[0]);
  }
}

function insertSeparator(beforeMessage) {
  // Check if separator already exists
  const prevElement = beforeMessage.previousElementSibling;
  if (prevElement && prevElement.classList.contains("chat-separator")) {
    return;
  }

  const separator = document.createElement("div");
  separator.className = "chat-separator";
  separator.textContent = "─── New Messages ───";
  separator.style.cssText = `
    text-align: center;
    margin: 12px 0;
    font-size: 12px;
    color: ${CONFIG.SEPARATOR_COLOR};
    font-weight: bold;
    opacity: 0.8;
    padding: 4px 0;
  `;

  beforeMessage.parentElement.insertBefore(separator, beforeMessage);
  console.log("[Chat] Session separator inserted");
}

// ============================================================================
//! FEATURE: ATTENTION MARKERS
// ============================================================================

/**
 * Create a marker button for a message
 */
function createMarkerButton(messageElement) {
  const button = document.createElement("button");
  button.className = "chat-marker-btn";
  button.textContent = CONFIG.MARKER_ICON;
  button.title = "Mark for later";

  button.style.cssText = `
    position: absolute;
    right: 4px;
    top: 4px;
    background: rgba(255, 255, 255, 0.9);
    border: 1px solid #ddd;
    border-radius: 3px;
    padding: 2px 6px;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    opacity: 0.6;
    transition: opacity 0.2s, transform 0.2s;
    z-index: 10;
  `;

  // Hover effects
  button.addEventListener("mouseenter", () => {
    button.style.opacity = "1";
    button.style.transform = "scale(1.1)";
  });

  button.addEventListener("mouseleave", () => {
    const isMarked = state.markedMessages.has(
      getMessageFingerprint(messageElement),
    );
    button.style.opacity = isMarked ? "1" : "0.6";
    button.style.transform = "scale(1)";
  });

  // Click handler
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMessageMarker(messageElement, button);
  });

  return button;
}

/**
 * Toggle marker on a message
 */
function toggleMessageMarker(messageElement, button) {
  const fingerprint = getMessageFingerprint(messageElement);

  if (state.markedMessages.has(fingerprint)) {
    // Unmark
    state.markedMessages.delete(fingerprint);
    removeMarkerStyle(messageElement);
    button.style.opacity = "0.6";
    console.log("[Chat] Message unmarked:", fingerprint);
  } else {
    // Mark
    state.markedMessages.add(fingerprint);
    applyMarkerStyle(messageElement);
    button.style.opacity = "1";
    console.log("[Chat] Message marked:", fingerprint);
  }
}

/**
 * Apply marker styling to a message
 */
function applyMarkerStyle(messageElement) {
  messageElement.classList.add("chat-marked");
  messageElement.style.backgroundColor = CONFIG.MARKER_BG;
  messageElement.style.border = CONFIG.MARKER_BORDER;
  messageElement.style.borderRadius = "6px";
  messageElement.style.padding = "4px";
  messageElement.style.position = "relative";
}

/**
 * Remove marker styling from a message
 */
function removeMarkerStyle(messageElement) {
  messageElement.classList.remove("chat-marked");
  messageElement.style.backgroundColor = "";

  // Check if message has other highlighting (own message)
  const profileLink = messageElement.querySelector(
    'a[href^="profile.php?user_name="]',
  );
  if (profileLink && state.features.highlighting && state.username) {
    const href = profileLink.getAttribute("href");
    const match = href.match(/user_name=(.+)$/);
    if (
      match &&
      normalizeUsername(match[1]) === normalizeUsername(state.username)
    ) {
      // Keep own message highlighting
      messageElement.style.border = CONFIG.HIGHLIGHT_BORDER;
      messageElement.style.borderRadius = "6px";
      messageElement.style.padding = "2px";
      return;
    }
  }

  // Remove all styling if not own message
  messageElement.style.border = "";
  messageElement.style.borderRadius = "";
  messageElement.style.padding = "";
}

/**
 * Add marker buttons to new messages
 */
function addMarkerButtons(messages) {
  if (!state.features.markers) return;

  for (const msg of messages) {
    // Skip if already has a marker button
    if (msg.querySelector(".chat-marker-btn")) continue;

    // Make message positioned for absolute button
    msg.style.position = "relative";

    // Create and add marker button
    const button = createMarkerButton(msg);
    msg.appendChild(button);

    // If message was previously marked, restore its style
    const fingerprint = getMessageFingerprint(msg);
    if (state.markedMessages.has(fingerprint)) {
      applyMarkerStyle(msg);
      button.style.opacity = "1";
    }
  }
}

/**
 * Remove all marker buttons
 */
function removeAllMarkerButtons() {
  const buttons = document.querySelectorAll(".chat-marker-btn");
  buttons.forEach((btn) => btn.remove());

  // Remove marker styling
  const markedMessages = document.querySelectorAll(".chat-marked");
  markedMessages.forEach((msg) => removeMarkerStyle(msg));
}

// ============================================================================
// FEATURE: KEYWORD WATCHER
// ============================================================================

function checkForKeywords(messages) {
  if (!state.features.keywords || state.keywords.size === 0) return;

  for (const msg of messages) {
    // Get message text
    const textContainer = msg.children[5];
    if (!textContainer) continue;

    // Check for keyword match
    const matchedKeyword = matchesKeywords(textContainer);
    if (!matchedKeyword) continue;

    // Check if already notified
    const fingerprint = getMessageFingerprint(msg);
    if (state.keywordMatches.has(fingerprint)) continue;

    // Record match
    state.keywordMatches.add(fingerprint);

    // Trim if too large
    if (state.keywordMatches.size > CONFIG.MAX_SEEN_MESSAGES) {
      const array = Array.from(state.keywordMatches);
      state.keywordMatches = new Set(array.slice(-CONFIG.MAX_SEEN_MESSAGES));
    }

    // Get author
    const author = msg.children[2]?.textContent || "Someone";

    console.log("message", msg);
    console.log("Matched keyword:", matchedKeyword);
    // Apply visual highlight
    applyKeywordHighlight(msg, matchedKeyword);

    // Show notification
    showNotification(`Keyword Alert: "${matchedKeyword}"`, `${author}`);

    console.log("[Chat] Keyword match:", matchedKeyword);
  }
}

/**
 * Apply keyword highlight styling
 */
function applyKeywordHighlight(messageElement, keyword) {
  // Don't override pin styling if present
  if (messageElement.classList.contains("chat-marked")) return;

  messageElement.classList.add("chat-keyword-match");
  messageElement.style.borderLeft = `4px solid ${CONFIG.KEYWORD_HIGHLIGHT_COLOR}`;
  messageElement.style.backgroundColor = CONFIG.KEYWORD_HIGHLIGHT_BG;
  messageElement.style.paddingLeft = "8px";

  // Add small badge
  const badge = document.createElement("span");
  badge.className = "keyword-badge";
  badge.textContent = `🔔 ${keyword}`;
  badge.style.cssText = `
    display: inline-block;
    background: ${CONFIG.KEYWORD_HIGHLIGHT_COLOR};
    color: white;
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 3px;
    margin-left: 8px;
    font-weight: bold;
  `;

  // Insert badge after username
  const usernameElement = messageElement.children[2];
  if (usernameElement) {
    usernameElement.appendChild(badge);
  }
}

/**
 * Remove keyword highlights (Needs Modification)
 */
function removeKeywordHighlights() {
  const matches = document.querySelectorAll(".chat-keyword-match");
  matches.forEach((msg) => {
    msg.classList.remove("chat-keyword-match");
    msg.style.borderLeft = "";
    msg.style.backgroundColor = "";
    msg.style.paddingLeft = "";

    const badge = msg.querySelector(".keyword-badge");
    if (badge) badge.remove();
  });
}

// ============================================================================
// CHAT OBSERVER
// ============================================================================

function handleChatMutations(mutations) {
  // Filter for new chat messages
  const newMessages = [];

  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (
        node.nodeType === Node.ELEMENT_NODE &&
        node.classList &&
        node.classList.contains("chat-txt")
      ) {
        newMessages.push(node);
      }
    }
  }

  if (newMessages.length === 0) return;

  // Process features
  try {
    checkForMentions(newMessages);
    highlightOwnMessages(newMessages);
    checkForSessionChange(newMessages, mutations);
    addMarkerButtons(newMessages);
    checkForKeywords(newMessages);
  } catch (e) {
    console.error("[Chat] Error processing messages:", e);
  }
}

async function startObserver() {
  if (state.observer) return;

  try {
    const container = await findChatContainer();

    state.observer = new MutationObserver(handleChatMutations);
    state.observer.observe(container, {
      childList: true,
      subtree: true,
    });

    console.log("[Chat] Observer started");
  } catch (e) {
    console.error("[Chat] Failed to start observer:", e);
  }
}

function stopObserver() {
  if (state.observer) {
    state.observer.disconnect();
    state.observer = null;
    console.log("[Chat] Observer stopped");
  }
}

// ============================================================================
// FEATURE CONTROLS
// ============================================================================

function startMentionWatcher() {
  if (state.features.mentions) return;

  // Get username if not set
  if (!state.username) {
    const stored = getStoredUsername();
    if (stored) {
      state.username = stored;
    } else {
      const input = prompt("Enter your username for mention notifications:");
      if (!input) return;

      state.username = sanitizeUsername(input);
      saveUsername(state.username);
    }
  }

  state.features.mentions = true;
  requestNotificationPermission();
  startObserver();

  console.log("[Chat] Mention watcher started for:", state.username);
}

function stopMentionWatcher() {
  state.features.mentions = false;
  state.seenMessages.clear();
  console.log("[Chat] Mention watcher stopped");
}

function startHighlighter() {
  if (state.features.highlighting) return;

  // Get username if not set
  if (!state.username) {
    const stored = getStoredUsername();
    if (stored) {
      state.username = stored;
    } else {
      const input = prompt("Enter your username for message highlighting:");
      if (!input) return;

      state.username = sanitizeUsername(input);
      saveUsername(state.username);
    }
  }

  state.features.highlighting = true;
  startObserver();

  // Highlight existing messages
  const messages = document.querySelectorAll(".chat-txt");
  highlightOwnMessages(Array.from(messages));

  console.log("[Chat] Highlighter started for:", state.username);
}

function stopHighlighter() {
  state.features.highlighting = false;

  // Remove highlights (but preserve markers)
  const messages = document.querySelectorAll('.chat-txt[style*="border"]');
  messages.forEach((msg) => {
    // Don't remove if it's a marked message
    if (!msg.classList.contains("chat-marked")) {
      msg.style.border = "";
      msg.style.borderRadius = "";
      msg.style.padding = "";
    }
  });

  console.log("[Chat] Highlighter stopped");
}

function startSeparator() {
  if (state.features.separator) return;

  state.features.separator = true;
  startObserver();

  console.log("[Chat] Session separator started");
}

function stopSeparator() {
  state.features.separator = false;

  // Remove separators
  const separators = document.querySelectorAll(".chat-separator");
  separators.forEach((sep) => sep.remove());

  console.log("[Chat] Session separator stopped");
}

function startMarkers() {
  if (state.features.markers) return;

  state.features.markers = true;
  startObserver();

  // Add marker buttons to existing messages
  const messages = document.querySelectorAll(".chat-txt");
  addMarkerButtons(Array.from(messages));

  console.log("[Chat] Attention markers started");
}

function stopMarkers() {
  state.features.markers = false;

  // Remove all marker buttons and styling
  removeAllMarkerButtons();

  // Clear marked messages set
  state.markedMessages.clear();

  console.log("[Chat] Attention markers stopped");
}

function clearAllMarkers() {
  // Clear all marked messages
  state.markedMessages.clear();

  // Remove marker styling from all messages
  const markedMessages = document.querySelectorAll(".chat-marked");
  markedMessages.forEach((msg) => {
    removeMarkerStyle(msg);
    const button = msg.querySelector(".chat-marker-btn");
    if (button) {
      button.style.opacity = "0.6";
    }
  });

  console.log("[Chat] All markers cleared");
}

function startKeywordWatcher() {
  if (state.features.keywords) return;

  // Load saved keywords
  loadKeywords();

  // If no keywords, prompt to add
  if (state.keywords.size === 0) {
    const input = prompt(
      "Enter keywords to watch (comma-separated):\nExample: dragon egg, trade, rare item",
    );
    if (!input) return;

    // Parse and save keywords
    const keywords = input
      .split(",")
      .map((k) => k.trim().toLowerCase().replace(/[()]/g, ""))
      .filter((k) => k);
    state.keywords = new Set(keywords);
    saveKeywords();
  }

  state.features.keywords = true;
  startObserver();

  console.log(
    "[Chat] Keyword watcher started. Watching:",
    Array.from(state.keywords),
  );
}

function stopKeywordWatcher() {
  state.features.keywords = false;
  state.keywordMatches.clear();
  removeKeywordHighlights();
  console.log("[Chat] Keyword watcher stopped");
}

function manageKeywords() {
  const currentKeywords = Array.from(state.keywords).join(", ");
  const input = prompt(
    `Current keywords: ${currentKeywords || "None"}\n\nEnter new keywords (comma-separated):`,
    currentKeywords,
  );

  if (input === null) return;

  if (input.trim() === "") {
    // Clear all keywords
    state.keywords.clear();
    saveKeywords();
    console.log("[Chat] All keywords cleared");
  } else {
    // Update keywords
    const keywords = input
      .split(",")
      .map((k) => k.trim().toLowerCase().replace(/[()]/g, ""))
      .filter((k) => k);
    state.keywords = new Set(keywords);
    saveKeywords();
    console.log("[Chat] Keywords updated:", Array.from(state.keywords));
  }
}

function resetAll() {
  stopMentionWatcher();
  stopHighlighter();
  stopSeparator();
  stopMarkers();
  stopKeywordWatcher();
  clearUsername();
  state.username = null;

  console.log("[Chat] All features reset");
}

// ============================================================================
// UI CONTROLS
// ============================================================================

function createControlButton(text, onClick, inactiveColor = "#8e8e93") {
  const button = document.createElement("button");
  button.textContent = text;
  button.style.cssText = `
    padding: 8px 12px;
    margin: 4px 0;
    width: 100%;
    font-size: 13px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    color: white;
    background-color: ${inactiveColor};
    transition: background-color 0.2s;
  `;

  button.addEventListener("click", onClick);

  return button;
}

function updateButtonState(button, active, activeText, inactiveText) {
  button.textContent = active ? activeText : inactiveText;
  button.style.backgroundColor = active ? "#dc2626" : "#007aff";
}

function initializeUI() {
  // Find the sidebar list
  const sidebar = document.querySelector(".page-content > div > ul");
  if (!sidebar) {
    console.log("[Chat] Sidebar not found, retrying...");
    setTimeout(initializeUI, 500);
    return;
  }

  console.log("[Chat] Initializing UI controls");

  // Mention Watcher Button
  const mentionBtn = createControlButton("Start Mention Watcher", () => {
    if (state.features.mentions) {
      stopMentionWatcher();
      updateButtonState(
        mentionBtn,
        false,
        "Stop Mention Watcher",
        "Start Mention Watcher",
      );
    } else {
      startMentionWatcher();
      updateButtonState(
        mentionBtn,
        true,
        "Stop Mention Watcher",
        "Start Mention Watcher",
      );
    }
  });

  const mentionLi = document.createElement("li");
  mentionLi.appendChild(mentionBtn);
  sidebar.appendChild(mentionLi);

  // Highlighter Button
  const highlightBtn = createControlButton("Highlight My Messages", () => {
    if (state.features.highlighting) {
      stopHighlighter();
      updateButtonState(
        highlightBtn,
        false,
        "Stop Highlighting",
        "Highlight My Messages",
      );
    } else {
      startHighlighter();
      updateButtonState(
        highlightBtn,
        true,
        "Stop Highlighting",
        "Highlight My Messages",
      );
    }
  });

  const highlightLi = document.createElement("li");
  highlightLi.appendChild(highlightBtn);
  sidebar.appendChild(highlightLi);

  // Attention Markers Button
  const markersBtn = createControlButton("Enable Message Pins", () => {
    if (state.features.markers) {
      stopMarkers();
      updateButtonState(
        markersBtn,
        false,
        "Disable Message Pins",
        "Enable Message Pins",
      );
      clearMarkersLi.style.display = "none";
    } else {
      startMarkers();
      updateButtonState(
        markersBtn,
        true,
        "Disable Message Pins",
        "Enable Message Pins",
      );
      clearMarkersLi.style.display = "block";
    }
  });

  const markersLi = document.createElement("li");
  markersLi.appendChild(markersBtn);
  sidebar.appendChild(markersLi);

  // Clear Markers Button (only visible when markers are active)
  const clearMarkersBtn = createControlButton(
    "Clear All Pins",
    () => {
      if (state.markedMessages.size > 0) {
        clearAllMarkers();
      }
    },
    "#f59e0b",
    "#f59e0b",
  );

  const clearMarkersLi = document.createElement("li");
  clearMarkersLi.appendChild(clearMarkersBtn);
  clearMarkersLi.style.display = "none";
  sidebar.appendChild(clearMarkersLi);

  // Session Separator Button
  const separatorBtn = createControlButton("Enable Session Separator", () => {
    if (state.features.separator) {
      stopSeparator();
      updateButtonState(
        separatorBtn,
        false,
        "Disable Session Separator",
        "Enable Session Separator",
      );
    } else {
      startSeparator();
      updateButtonState(
        separatorBtn,
        true,
        "Disable Session Separator",
        "Enable Session Separator",
      );
    }
  });

  const separatorLi = document.createElement("li");
  separatorLi.appendChild(separatorBtn);
  sidebar.appendChild(separatorLi);

  // Auto-start session separator
  startSeparator();
  updateButtonState(
    separatorBtn,
    true,
    "Disable Session Separator",
    "Enable Session Separator",
  );

  // Keyword Watcher Button
  const keywordBtn = createControlButton("Enable Item Keyword Alerts", () => {
    if (state.features.keywords) {
      stopKeywordWatcher();
      updateButtonState(
        keywordBtn,
        false,
        "Disable Item Keyword Alerts",
        "Enable Item Keyword Alerts",
      );
      keywordManageBtn.style.display = "none";
    } else {
      startKeywordWatcher();
      updateButtonState(
        keywordBtn,
        true,
        "Disable Item Keyword Alerts",
        "Enable Item Keyword Alerts",
      );
      keywordManageBtn.style.display = "block";
    }
  });

  const keywordLi = document.createElement("li");
  keywordLi.appendChild(keywordBtn);
  sidebar.appendChild(keywordLi);

  // Manage Keywords Button
  const keywordManageBtn = createControlButton(
    "Manage Keywords",
    () => {
      manageKeywords();
    },
    "#a855f7",
    "#a855f7",
  );
  // Hidden by default
  keywordManageBtn.style.display = "none";

  const keywordManageLi = document.createElement("li");
  keywordManageLi.appendChild(keywordManageBtn);
  sidebar.appendChild(keywordManageLi);

  // Reset Button
  const resetBtn = createControlButton(
    "Reset All",
    () => {
      if (confirm("Reset username and stop all features?")) {
        resetAll();
        updateButtonState(
          mentionBtn,
          false,
          "Stop Mention Watcher",
          "Start Mention Watcher",
        );
        updateButtonState(
          highlightBtn,
          false,
          "Stop Highlighting",
          "Highlight My Messages",
        );
        updateButtonState(
          markersBtn,
          false,
          "Disable Message Pins",
          "Enable Message Pins",
        );
        updateButtonState(
          separatorBtn,
          false,
          "Disable Session Separator",
          "Enable Session Separator",
        );
        updateButtonState(
          keywordBtn,
          false,
          "Disable Item Keyword Alerts",
          "Enable Item Keyword Alerts",
        );
        clearMarkersLi.style.display = "none";
        keywordManageBtn.style.display = "none";
      }
    },
    "#7c2d12",
    "#7c2d12",
  );

  const resetLi = document.createElement("li");
  resetLi.appendChild(resetBtn);
  sidebar.appendChild(resetLi);
}

// ============================================================================
// INITIALIZATION
// ============================================================================

(function init() {
  // Wait for DOM
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeUI);
  } else {
    initializeUI();
  }

  console.log("[Chat] FarmRPG Chat Enhancer v1.1.0 loaded");
})();
