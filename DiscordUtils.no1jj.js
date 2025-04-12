// @ts-nocheck
/**
 * @name DiscordUtils
 * @author no.1_jj
 * @version 1.3.0
 * @description 디스코드 경험을 향상시키는 다양한 기능 모음 by no.1_jj
 * @license MIT
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { StartAt } from "@utils/types";
import { DataStore } from "@api/index";
import {
    showToast,
    Toasts,
    Clipboard,
    RestAPI,
    FluxDispatcher,
} from "@webpack/common";
import { SelectedChannelStore } from "@webpack/common";
import {
    addMessagePreSendListener,
    addMessagePreEditListener,
} from "@api/MessageEvents";
import "@utils/discord";

class ConfigurationManager {
    constructor() {
        this.storageKey = "discord_utils_config";
        this.defaultConfig = {
            messageFormat: {
                autoBold: false,
                zwsMode: false,
                prefixEnabled: false,
                prefix: "",
                suffixEnabled: false,
                suffix: "",
                randomTypoEnabled: false,
                typoMessages: "",
                typoRate: 10
            },
            reactions: {
                enabled: false,
                emoji: "💜"
            },
            polls: {
                enabled: false,
                optionCount: 1,
                defaultTitle: "투표"
            },
            settings: {
                silentEdit: false
            },
            uiState: {
                windowPositions: {}
            }
        };
        this.config = this.defaultConfig;
    }

    async loadConfig() {
        const savedData = await DataStore.get(this.storageKey);
        if (savedData) {
            try {
                this.config = {...this.defaultConfig, ...JSON.parse(savedData)};
            } catch (e) {
                this.config = this.defaultConfig;
            }
        }
        return this.config;
    }

    async saveConfig() {
        await DataStore.set(this.storageKey, JSON.stringify(this.config));
    }

    getValue(path) {
        const keys = path.split('.');
        let result = this.config;
        
        for (const key of keys) {
            if (result[key] === undefined) return null;
            result = result[key];
        }
        
        return result;
    }

    setValue(path, value) {
        const keys = path.split('.');
        let current = this.config;
        
        for (let i = 0; i < keys.length - 1; i++) {
            const key = keys[i];
            if (current[key] === undefined) current[key] = {};
            current = current[key];
        }
        
        current[keys[keys.length - 1]] = value;
        this.saveConfig();
    }
}

class CallManager {
    constructor() {
        this.currentCallIp = null;
        this.initCallIpMonitoring();
    }

    initCallIpMonitoring() {
        const originalConsoleInfo = console.info;
        console.info = function(...args) {
            const rtcServerInfo = args.find(
                arg => typeof arg === "string" && arg.includes("Connecting to RTC server wss://")
            );
            
            if (rtcServerInfo) {
                try {
                    const match = rtcServerInfo.match(/wss:\/\/([^/]+)/);
                    if (match && match[1]) {
                        this.currentCallIp = match[1];
                    }
                } catch (error) {
                }
            }
            
            originalConsoleInfo.apply(console, args);
        }.bind(this);
    }

    async copyCurrentCallIp() {
        if (!this.currentCallIp) {
            showToast("통방에 들어가있지 않거나 오류가 발생한것 같아요.", Toasts.Type.FAILURE);
            return false;
        }
        
        Clipboard.copy(this.currentCallIp);
        showToast("현재 접속중인 통방 IP를 클립보드에 복사했어요.", Toasts.Type.SUCCESS);
        return true;
    }

    async changeRegion() {
        const voiceChannelId = await SelectedChannelStore.getVoiceChannelId();
        
        if (!voiceChannelId) {
            showToast("음성 채널에 연결되어 있지 않습니다", Toasts.Type.FAILURE);
            return false;
        }
        
        const regions = [
            "india", "japan", "south-korea", "south-africa", 
            "singapore", "sydney", "us-east", "us-west"
        ];
        
        const randomRegion = regions[Math.floor(Math.random() * regions.length)];
        
        try {
            await RestAPI.patch({
                url: `/channels/${voiceChannelId}/call`,
                body: { region: randomRegion }
            });
            
            showToast(`통방에 있는 모든사람을 재접속시키고, 통방의 지역을 바꿨어요.`, Toasts.Type.SUCCESS);
            return true;
        } catch (e) {
            showToast("지역 변경 실패", Toasts.Type.FAILURE);
            return false;
        }
    }
}

class MessageProcessor {
    constructor(configManager) {
        this.config = configManager;
        this.setupListeners();
    }

    setupListeners() {
        addMessagePreSendListener(async (channelId, message) => {
            await this.processOutgoingMessage(channelId, message);
        });
        addMessagePreEditListener(async (channelId, messageId, message) => {
            await this.processEditedMessage(channelId, messageId, message);
        });
    }

    async processOutgoingMessage(channelId, message) {
        if (!message.content || message.content.trim().length === 0) return;

        try {
            if (this.config.getValue('messageFormat.zwsMode')) {
                message.content = message.content.split('').join('\u200B');
            }

            const autoBoldEnabled = this.config.getValue('messageFormat.autoBold');
            const prefixEnabled = this.config.getValue('messageFormat.prefixEnabled');
            const prefix = this.config.getValue('messageFormat.prefix');
            
            if (autoBoldEnabled && prefixEnabled && prefix) {
                message.content = `# ${prefix} ${message.content}`;
            } else {
                if (autoBoldEnabled) {
                    message.content = `# ${message.content}`;
                }
                
                if (prefixEnabled && prefix) {
                    message.content = `${prefix} ${message.content}`;
                }
            }

            if (this.config.getValue('polls.enabled')) {
                await this.convertMessageToPoll(channelId, message);
            }

            if (this.config.getValue('reactions.enabled')) {
                await this.setupAutoReaction(channelId, message);
            }

            if (this.config.getValue('messageFormat.suffixEnabled')) {
                const suffix = this.config.getValue('messageFormat.suffix');
                if (suffix) {
                    message.content = `${message.content} ${suffix}`;
                }
            }

            if (this.config.getValue('messageFormat.randomTypoEnabled')) {
                await this.applyRandomTypo(message);
            }
        } catch (e) {
        }
    }

    async processEditedMessage(channelId, messageId, message) {
        try {
            if (this.config.getValue('settings.silentEdit') && message.content) {
                await RestAPI.post({
                    url: `/channels/${channelId}/messages`,
                    body: {
                        mobile_network_type: "unknown",
                        content: message.content,
                        nonce: messageId,
                        tts: false,
                        flags: 0
                    }
                });
                
                message.content = "";
            }
        } catch (e) {
        }
    }

    async convertMessageToPoll(channelId, message) {
        try {
            const optionCount = this.config.getValue('polls.optionCount');
            const defaultTitle = this.config.getValue('polls.defaultTitle') || "투표";
            const parts = message.content.split(';');
            
            let question = parts[0] && parts[0].trim() ? parts[0] : defaultTitle;
            
            let options = parts.slice(1);
            if (options.length === 0) {
                const emoji = this.config.getValue('reactions.emoji') || "☠️";
                options = [`${emoji} ${question}`];
            }
            
            if (options.length < optionCount) {
                const firstOption = options[0];
                while (options.length < optionCount) {
                    options.push(firstOption);
                }
            }
            
            options = options.slice(0, Math.min(optionCount, 10));
            
            const pollData = {
                question: { text: question },
                answers: options.map(opt => ({
                    poll_media: { text: opt || " " }
                })),
                duration: 24 
            };
            
            message.type = 20; 
            message.poll = pollData;
            message.content = "";
            
            setTimeout(async () => {
                if (message.id) {
                    try {
                        await RestAPI.post({
                            url: `/channels/${channelId}/polls/${message.id}/expire`
                        });
                    } catch(e) {
                    }
                }
            }, 2000);
        } catch(e) {
        }
    }

    async setupAutoReaction(channelId, message) {
        setTimeout(() => {
            if (!message.id) return;
            
            try {
                const emoji = this.config.getValue('reactions.emoji') || "☠️";
                
                const headers = {
                    'Content-Type': 'application/json'
                };
                
                const reactionUrl = `/channels/${channelId}/messages/${message.id}/reactions/${encodeURIComponent(emoji)}/@me`;
                
                RestAPI.post({
                    url: reactionUrl,
                    body: {},
                    retries: 3
                }).catch(error => {
                    try {
                        FluxDispatcher.dispatch({
                            type: "MESSAGE_REACTION_ADD",
                            channelId: channelId,
                            messageId: message.id,
                            emoji: emoji
                        });
                    } catch (e) {
                    }
                }
            } catch (e) {
            }
        }, 2000); 
    }

    applyRandomTypo(message) {
        const typoMessages = this.config.getValue('messageFormat.typoMessages');
        if (!typoMessages) return;
        
        const typoRate = this.config.getValue('messageFormat.typoRate');
        const messages = typoMessages.split(';').filter(m => m.trim());
        
        if (messages.length === 0) return;
        
        const randomMessage = messages[Math.floor(Math.random() * messages.length)];
        
        const shouldApplyTypo = Math.random() * 100 < typoRate;
        
        if (shouldApplyTypo) {
            message.content = randomMessage
                .split('')
                .map(char => {
                    return Math.random() < 0.3
                        ? String.fromCharCode(char.charCodeAt(0) + (Math.random() < 0.5 ? 1 : -1))
                        : char;
                })
                .join('');
        } else {
            message.content = randomMessage;
        }
    }
}

class InterfaceManager {
    constructor(configManager, callManager) {
        this.config = configManager;
        this.callManager = callManager;
        this.windows = [];
        this.visible = true;
        this.styleElement = null;
    }

    initialize() {
        this.injectStyles();
        this.setupKeyboardShortcut();
        this.createMainWindow();
    }

    injectStyles() {
        const styleElement = document.createElement("style");
        styleElement.id = "discord-utils-styles";
        styleElement.textContent = `
        .de-window {
            position: absolute;
            background-color: #2b2d31;
            border-radius: 8px;
            min-width: 300px;
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
            color: #e0e1e5;
            overflow: hidden;
            transition: opacity 0.3s ease, transform 0.3s ease;
            z-index: 9999;
        }
        
        .de-window-hidden {
            opacity: 0;
            pointer-events: none;
            transform: scale(0.95);
        }
        
        .de-window-minimized {
            height: 46px !important;
            overflow: hidden;
        }
        
        .de-titlebar {
            padding: 12px 16px;
            background-color: #1e1f22;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid #3f4147;
            cursor: move;
        }
        
        .de-title {
            font-weight: 600;
            font-size: 16px;
            color: #ffffff;
        }
        
        .de-title-buttons {
            display: flex;
            gap: 8px;
        }
        
        .de-close, .de-minimize {
            width: 18px;
            height: 18px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            border-radius: 50%;
            background-color: #3f4147;
            transition: background-color 0.2s ease;
            font-size: 14px;
        }
        
        .de-close:hover, .de-minimize:hover {
            background-color: #5d6067;
        }
        
        .de-tabs {
            display: flex;
            background-color: #232428;
            border-bottom: 1px solid #3f4147;
            overflow-x: auto;
        }
        
        .de-tabs::-webkit-scrollbar {
            display: none;
        }
        
        .de-tab {
            padding: 12px 18px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: background-color 0.2s ease;
            white-space: nowrap;
        }
        
        .de-tab:hover {
            background-color: #393b41;
        }
        
        .de-tab-active {
            background-color: #393b41;
            color: #5865f2;
            border-bottom: 2px solid #5865f2;
        }
        
        .de-content {
            padding: 16px;
            max-height: 400px;
            overflow-y: auto;
            scrollbar-width: none; /* Firefox */
            -ms-overflow-style: none; /* IE and Edge */
        }
        
        .de-content::-webkit-scrollbar {
            display: none; /* Chrome, Safari and Opera */
        }
        
        .de-tab-content {
            display: none;
            scrollbar-width: none;
            -ms-overflow-style: none;
        }
        
        .de-tab-content::-webkit-scrollbar {
            display: none;
        }
        
        .de-tab-content-active {
            display: block;
        }
        
        .de-item {
            margin-bottom: 18px;
        }
        
        .de-item-title {
            font-weight: 600;
            font-size: 14px;
            margin-bottom: 6px;
        }
        
        .de-item-desc {
            font-size: 12px;
            color: #a3a6aa;
            margin-bottom: 8px;
        }
        
        .de-toggle {
            display: flex;
            align-items: center;
        }
        
        .de-toggle-switch {
            position: relative;
            width: 40px;
            height: 24px;
            background-color: #4e5058;
            border-radius: 12px;
            margin-right: 12px;
            cursor: pointer;
            transition: background-color 0.2s ease;
        }
        
        .de-toggle-switch::after {
            content: '';
            position: absolute;
            width: 18px;
            height: 18px;
            background-color: #ffffff;
            border-radius: 50%;
            top: 3px;
            left: 3px;
            transition: transform 0.2s ease;
        }
        
        .de-toggle-active .de-toggle-switch {
            background-color: #5865f2;
        }
        
        .de-toggle-active .de-toggle-switch::after {
            transform: translateX(16px);
        }
        
        .de-toggle-label {
            font-size: 14px;
        }
        
        .de-button {
            background-color: #4e5058;
            color: #ffffff;
            border: none;
            border-radius: 4px;
            padding: 8px 16px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: background-color 0.2s ease;
            margin-top: 8px;
        }
        
        .de-button:hover {
            background-color: #6d6f78;
        }
        
        .de-button.primary {
            background-color: #5865f2;
        }
        
        .de-button.primary:hover {
            background-color: #4752c4;
        }
        
        .de-input {
            width: 100%;
            padding: 8px 12px;
            background-color: #1e1f22;
            border: 1px solid #3f4147;
            border-radius: 4px;
            color: #ffffff;
            font-size: 14px;
            margin-top: 8px;
            box-sizing: border-box;
        }
        
        .de-input:focus {
            outline: none;
            border-color: #5865f2;
        }
        
        .de-slider {
            width: 100%;
            margin-top: 8px;
        }
        
        .de-slider-container {
            display: flex;
            align-items: center;
        }
        
        .de-slider-track {
            flex-grow: 1;
            height: 8px;
            background-color: #4e5058;
            border-radius: 4px;
            margin: 0 10px;
            position: relative;
        }
        
        .de-slider-progress {
            position: absolute;
            height: 100%;
            background-color: #5865f2;
            border-radius: 4px;
            left: 0;
        }
        
        .de-slider-thumb {
            width: 16px;
            height: 16px;
            background-color: #ffffff;
            border-radius: 50%;
            position: absolute;
            top: 50%;
            transform: translate(-50%, -50%);
            cursor: pointer;
        }
        
        .de-slider-value {
            min-width: 30px;
            text-align: center;
            font-size: 14px;
        }
        `;
        
        document.head.appendChild(styleElement);
        this.styleElement = styleElement;
    }

    setupKeyboardShortcut() {
        document.addEventListener("keydown", (event) => {
            if (event.key === "Insert") {
                this.toggleVisibility();
            }
        });
    }

    toggleVisibility() {
        this.visible = !this.visible;
        
        this.windows.forEach((windowElement) => {
            if (this.visible) {
                windowElement.classList.remove("de-window-hidden");
            } else {
                windowElement.classList.add("de-window-hidden");
            }
        });
    }

    createMainWindow() {
        const window = document.createElement("div");
        window.className = "de-window";
        window.style.width = "350px";
        window.style.left = "100px";
        window.style.top = "100px";
        
        const titleBar = document.createElement("div");
        titleBar.className = "de-titlebar";
        
        const title = document.createElement("div");
        title.className = "de-title";
        title.textContent = "Discord Utils | no.1_jj";
        
        const titleButtons = document.createElement("div");
        titleButtons.className = "de-title-buttons";
        
        const minimizeButton = document.createElement("div");
        minimizeButton.className = "de-minimize";
        minimizeButton.innerHTML = "−";
        minimizeButton.addEventListener("click", () => this.toggleMinimize(window));
        
        const closeButton = document.createElement("div");
        closeButton.className = "de-close";
        closeButton.innerHTML = "×";
        closeButton.addEventListener("click", () => this.toggleVisibility());
        
        titleButtons.appendChild(minimizeButton);
        titleButtons.appendChild(closeButton);
        
        titleBar.appendChild(title);
        titleBar.appendChild(titleButtons);
        
        const tabsContainer = document.createElement("div");
        tabsContainer.className = "de-tabs";
        
        const tabIds = ["messages", "voice", "bypass", "tools"];
        const tabLabels = ["메시지", "보이스", "바이패스", "도구"];
        
        const tabs = {};
        const tabContents = {};
        
        tabIds.forEach((id, index) => {
            const tab = document.createElement("div");
            tab.className = "de-tab";
            tab.textContent = tabLabels[index];
            tab.dataset.tabId = id;
            tabs[id] = tab;
            
            const content = document.createElement("div");
            content.className = "de-tab-content";
            content.dataset.tabId = id;
            tabContents[id] = content;
            
            tab.addEventListener("click", () => {
                Object.values(tabs).forEach(t => t.classList.remove("de-tab-active"));
                Object.values(tabContents).forEach(c => c.classList.remove("de-tab-content-active"));
                
                tab.classList.add("de-tab-active");
                content.classList.add("de-tab-content-active");
            });
            
            tabsContainer.appendChild(tab);
        });
        
        const contentContainer = document.createElement("div");
        contentContainer.className = "de-content";
        
        Object.values(tabContents).forEach(content => {
            contentContainer.appendChild(content);
        });
        
        window.appendChild(titleBar);
        window.appendChild(tabsContainer);
        window.appendChild(contentContainer);
        
        this.setupDragging(window, titleBar);
        this.populateTabContents(tabContents, tabs);
        
        document.body.appendChild(window);
        this.windows.push(window);
        
        tabs["messages"].click();
    }

    setupDragging(windowElement, dragHandle) {
        let isDragging = false;
        let dragOffset = { x: 0, y: 0 };
        
        dragHandle.addEventListener("mousedown", (event) => {
            isDragging = true;
            dragOffset = {
                x: event.clientX - windowElement.offsetLeft,
                y: event.clientY - windowElement.offsetTop
            };
        });
        
        document.addEventListener("mousemove", (event) => {
            if (!isDragging) return;
            
            const newX = event.clientX - dragOffset.x;
            const newY = event.clientY - dragOffset.y;
            
            windowElement.style.left = newX + "px";
            windowElement.style.top = newY + "px";
        });
        
        document.addEventListener("mouseup", () => {
            isDragging = false;
        });
    }

    populateTabContents(tabContents, tabs) {
        this.populateMessagesTab(tabContents["messages"]);
        this.populateVoiceTab(tabContents["voice"]);
        this.populateBypassTab(tabContents["bypass"]);
        this.populateToolsTab(tabContents["tools"]);
    }

    populateMessagesTab(tabContent) {
        this.createToggle(
            tabContent,
            "굵게 표시",
            "메시지를 자동으로 굵게 표시합니다",
            "messageFormat.autoBold"
        );
        
        this.createToggle(
            tabContent,
            "접두사 사용",
            "메시지 앞에 특정 텍스트를 추가합니다",
            "messageFormat.prefixEnabled"
        );
        
        this.createInput(
            tabContent,
            "접두사 텍스트",
            "메시지 앞에 추가할 텍스트",
            "messageFormat.prefix"
        );
        
        this.createToggle(
            tabContent,
            "접미사 사용",
            "메시지 뒤에 특정 텍스트를 추가합니다",
            "messageFormat.suffixEnabled"
        );
        
        this.createInput(
            tabContent,
            "접미사 텍스트",
            "메시지 뒤에 추가할 텍스트",
            "messageFormat.suffix"
        );
        
        this.createToggle(
            tabContent,
            "장애타",
            "설정한 장애타 메시지 중 하나를 무작위로 보냅니다",
            "messageFormat.randomTypoEnabled"
        );
        
        this.createInput(
            tabContent,
            "장애타 글",
            ";로 구분할 수 있어요. 예: 모자란새기야;하등한새기야;안물어봤어",
            "messageFormat.typoMessages"
        );
        
        this.createSlider(
            tabContent,
            "오타 확률",
            "장애타 오타 확률이에요.",
            "messageFormat.typoRate",
            0, 100, 10
        );
        
        this.createToggle(
            tabContent,
            "PollTyper",
            "(투표권한 필요) 말하는 모든걸 투표로 바꿔줘요.",
            "polls.enabled"
        );
        
        this.createInput(
            tabContent,
            "투표 기본 제목",
            "투표 제목이 없을 때 사용할 기본 제목",
            "polls.defaultTitle",
            "투표"
        );
        
        this.createSlider(
            tabContent,
            "항목 수",
            "투표에 넣을 항목 수에요.",
            "polls.optionCount",
            1, 10, 1
        );
        
        this.createToggle(
            tabContent,
            "자동 반응",
            "말할때마다 리액트를 달아줘요. 리액트 권한이 있어야 쓸 수 있어요.",
            "reactions.enabled"
        );
        
        this.createInput(
            tabContent,
            "이모지",
            "말할때마다 자동으로 붙일 이모지를 설정해요.",
            "reactions.emoji",
            "☠️"
        );
    }

    populateVoiceTab(tabContent) {
        const ipButton = document.createElement("div");
        ipButton.className = "de-item";
        
        const ipButtonTitle = document.createElement("div");
        ipButtonTitle.className = "de-item-title";
        ipButtonTitle.textContent = "통방 IP 복사하기";
        
        const ipButtonDesc = document.createElement("div");
        ipButtonDesc.className = "de-item-desc";
        ipButtonDesc.textContent = "마지막으로 접속했던 통방의 IP를 복사해요.";
        
        const ipButtonElement = document.createElement("button");
        ipButtonElement.className = "de-button primary";
        ipButtonElement.textContent = "복사하기";
        ipButtonElement.addEventListener("click", () => {
            this.callManager.copyCurrentCallIp();
        });
        
        ipButton.appendChild(ipButtonTitle);
        ipButton.appendChild(ipButtonDesc);
        ipButton.appendChild(ipButtonElement);
        tabContent.appendChild(ipButton);
        
        const regionButton = document.createElement("div");
        regionButton.className = "de-item";
        
        const regionButtonTitle = document.createElement("div");
        regionButtonTitle.className = "de-item-title";
        regionButtonTitle.textContent = "< 그룹채팅 전용 > 모든사람 재접속 & 지역 바꾸기";
        
        const regionButtonDesc = document.createElement("div");
        regionButtonDesc.className = "de-item-desc";
        regionButtonDesc.textContent = "통방에 있는 모든사람을 재접속시키고, 통방의 지역을 바꿔요.";
        
        const regionButtonElement = document.createElement("button");
        regionButtonElement.className = "de-button primary";
        regionButtonElement.textContent = "재접속";
        regionButtonElement.addEventListener("click", () => {
            this.callManager.changeRegion();
        });
        
        regionButton.appendChild(regionButtonTitle);
        regionButton.appendChild(regionButtonDesc);
        regionButton.appendChild(regionButtonElement);
        tabContent.appendChild(regionButton);
    }

    populateBypassTab(tabContent) {
        this.createToggle(
            tabContent,
            "ZWSSucker",
            "자동으로 ZWS 유니코드를 모든 글자에 붙여요. 욕 감지를 피할때 유용해요.",
            "messageFormat.zwsMode"
        );
    }

    populateToolsTab(tabContent) {
        this.createToggle(
            tabContent,
            "QuietEdit",
            "메시지에 (수정된) 을 띄우지 않고도 수정해요.",
            "settings.silentEdit"
        );
    }

    createToggle(parent, title, description, configPath) {
        const item = document.createElement("div");
        item.className = "de-item";
        
        const itemTitle = document.createElement("div");
        itemTitle.className = "de-item-title";
        itemTitle.textContent = title;
        
        const itemDesc = document.createElement("div");
        itemDesc.className = "de-item-desc";
        itemDesc.textContent = description;
        
        const toggle = document.createElement("div");
        toggle.className = "de-toggle";
        if (this.config.getValue(configPath)) {
            toggle.classList.add("de-toggle-active");
        }
        
        const toggleSwitch = document.createElement("div");
        toggleSwitch.className = "de-toggle-switch";
        
        const toggleLabel = document.createElement("div");
        toggleLabel.className = "de-toggle-label";
        toggleLabel.textContent = this.config.getValue(configPath) ? "켜짐" : "꺼짐";
        
        toggle.appendChild(toggleSwitch);
        toggle.appendChild(toggleLabel);
        
        toggle.addEventListener("click", () => {
            const newValue = !this.config.getValue(configPath);
            this.config.setValue(configPath, newValue);
            
            if (newValue) {
                toggle.classList.add("de-toggle-active");
                toggleLabel.textContent = "켜짐";
            } else {
                toggle.classList.remove("de-toggle-active");
                toggleLabel.textContent = "꺼짐";
            }
        });
        
        item.appendChild(itemTitle);
        item.appendChild(itemDesc);
        item.appendChild(toggle);
        parent.appendChild(item);
        
        return toggle;
    }

    createInput(parent, title, description, configPath, placeholder = "") {
        const item = document.createElement("div");
        item.className = "de-item";
        
        const itemTitle = document.createElement("div");
        itemTitle.className = "de-item-title";
        itemTitle.textContent = title;
        
        const itemDesc = document.createElement("div");
        itemDesc.className = "de-item-desc";
        itemDesc.textContent = description;
        
        const input = document.createElement("input");
        input.type = "text";
        input.className = "de-input";
        input.value = this.config.getValue(configPath) || "";
        input.placeholder = placeholder;
        
        input.addEventListener("input", () => {
            this.config.setValue(configPath, input.value);
        });
        
        item.appendChild(itemTitle);
        item.appendChild(itemDesc);
        item.appendChild(input);
        parent.appendChild(item);
        
        return input;
    }

    createSlider(parent, title, description, configPath, min, max, defaultValue) {
        const item = document.createElement("div");
        item.className = "de-item";
        
        const itemTitle = document.createElement("div");
        itemTitle.className = "de-item-title";
        itemTitle.textContent = title;
        
        const itemDesc = document.createElement("div");
        itemDesc.className = "de-item-desc";
        itemDesc.textContent = description;
        
        const sliderContainer = document.createElement("div");
        sliderContainer.className = "de-slider";
        
        const sliderTrackContainer = document.createElement("div");
        sliderTrackContainer.className = "de-slider-container";
        
        const minValue = document.createElement("div");
        minValue.className = "de-slider-value";
        minValue.textContent = min;
        
        const sliderTrack = document.createElement("div");
        sliderTrack.className = "de-slider-track";
        
        const sliderProgress = document.createElement("div");
        sliderProgress.className = "de-slider-progress";
        
        const sliderThumb = document.createElement("div");
        sliderThumb.className = "de-slider-thumb";
        
        const maxValue = document.createElement("div");
        maxValue.className = "de-slider-value";
        maxValue.textContent = max;
        
        const valueDisplay = document.createElement("div");
        valueDisplay.className = "de-slider-current-value";
        valueDisplay.textContent = this.config.getValue(configPath) || defaultValue;
        
        sliderTrack.appendChild(sliderProgress);
        sliderTrack.appendChild(sliderThumb);
        
        sliderTrackContainer.appendChild(minValue);
        sliderTrackContainer.appendChild(sliderTrack);
        sliderTrackContainer.appendChild(maxValue);
        
        sliderContainer.appendChild(sliderTrackContainer);
        sliderContainer.appendChild(valueDisplay);
        
        item.appendChild(itemTitle);
        item.appendChild(itemDesc);
        item.appendChild(sliderContainer);
        
        parent.appendChild(item);
        
        const currentValue = this.config.getValue(configPath) || defaultValue;
        const percentage = ((currentValue - min) / (max - min)) * 100;
        sliderProgress.style.width = percentage + "%";
        sliderThumb.style.left = percentage + "%";
        valueDisplay.textContent = currentValue;
        
        let isDragging = false;
        
        const updateSlider = (clientX) => {
            const rect = sliderTrack.getBoundingClientRect();
            let percentage = (clientX - rect.left) / rect.width;
            percentage = Math.max(0, Math.min(1, percentage));
            
            const range = max - min;
            let value = min + range * percentage;
            value = Math.round(value);
            value = Math.max(min, Math.min(max, value));
            
            sliderProgress.style.width = percentage * 100 + "%";
            sliderThumb.style.left = percentage * 100 + "%";
            valueDisplay.textContent = value;
            
            this.config.setValue(configPath, value);
        };
        
        sliderTrack.addEventListener("mousedown", (e) => {
            isDragging = true;
            updateSlider(e.clientX);
        });
        
        document.addEventListener("mousemove", (e) => {
            if (!isDragging) return;
            updateSlider(e.clientX);
        });
        
        document.addEventListener("mouseup", () => {
            isDragging = false;
        });
        
        return sliderContainer;
    }

    toggleMinimize(windowElement) {
        if (windowElement.classList.contains('de-window-minimized')) {
            windowElement.classList.remove('de-window-minimized');
        } else {
            windowElement.classList.add('de-window-minimized');
        }
    }
}

export default definePlugin({
    name: "DiscordUtils",
    description: "디스코드 경험을 향상시키는 다양한 기능 모음",
    authors: [
        {
            name: "no.1_jj",
            id: 899657816833409044n
        }
    ],
    dependencies: ["MessageEventsAPI"],
    settings: definePluginSettings({}),
    startAt: StartAt.Init,
    
    async start() {
        await WaitForDataStore();
        
        this.configManager = new ConfigurationManager();
        await this.configManager.loadConfig();
        
        this.callManager = new CallManager();
        this.messageProcessor = new MessageProcessor(this.configManager);
        this.interfaceManager = new InterfaceManager(this.configManager, this.callManager);
        
        this.interfaceManager.initialize();
        
        FluxDispatcher.subscribe("MESSAGE_CREATE", (message) => {});
    },
    
    stop() {
        if (this.interfaceManager && this.interfaceManager.styleElement) {
            this.interfaceManager.styleElement.remove();
        }
        
        document.querySelectorAll(".de-window").forEach(el => el.remove());
        location.reload();
    }
});

async function WaitForDataStore() {
    while (typeof DataStore === "undefined") {
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}
