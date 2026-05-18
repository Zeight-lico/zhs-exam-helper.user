// ==UserScript==
// @name         智慧树考试自动答题助手 v1
// @namespace    https://github.com/Zeight-lico/zhs-exam-helper.user
// @version      1.0.0
// @description  全自动读题+多AI答题，支持DeepSeek/通义千问/智谱/Kimi/硅基流动/自定义API
// @author       Zeight
// @match        *://*.zhihuishu.com/*stuExamWeb*
// @match        *://*.zhihuishu.com/*exam*
// @match        *://*.zhihuishu.com/*doexamination*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @connect      api.deepseek.com
// @connect      dashscope.aliyuncs.com
// @connect      open.bigmodel.cn
// @connect      api.moonshot.cn
// @connect      api.siliconflow.cn
// @connect      api.openai.com
// @connect      ark.cn-beijing.volces.com
// @run-at       document-start
// ==/UserScript==

(function () {
    "use strict";

    // ==================== AI 供应商配置 ====================
    var PROVIDERS = [
        {
            id: "deepseek",
            name: "DeepSeek",
            url: "https://api.deepseek.com/chat/completions",
            model: "deepseek-chat",
            keyHint: "sk-xxxxxxxxxxxxxxxx",
            docUrl: "https://platform.deepseek.com",
        },
        {
            id: "qwen",
            name: "通义千问 (阿里)",
            url: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
            model: "qwen-plus",
            keyHint: "sk-xxxxxxxxxxxxxxxx",
            docUrl: "https://bailian.console.aliyun.com",
        },
        {
            id: "glm",
            name: "智谱 GLM",
            url: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
            model: "glm-4-flash",
            keyHint: "xxxxxxxx.xxxxxxxx",
            docUrl: "https://open.bigmodel.cn",
        },
        {
            id: "kimi",
            name: "Kimi (月之暗面)",
            url: "https://api.moonshot.cn/v1/chat/completions",
            model: "moonshot-v1-8k",
            keyHint: "sk-xxxxxxxxxxxxxxxx",
            docUrl: "https://platform.moonshot.cn",
        },
        {
            id: "siliconflow",
            name: "硅基流动 (免费额度多)",
            url: "https://api.siliconflow.cn/v1/chat/completions",
            model: "Qwen/Qwen2.5-7B-Instruct",
            keyHint: "sk-xxxxxxxxxxxxxxxx",
            docUrl: "https://siliconflow.cn",
        },
        {
            id: "openai",
            name: "OpenAI",
            url: "https://api.openai.com/v1/chat/completions",
            model: "gpt-3.5-turbo",
            keyHint: "sk-xxxxxxxxxxxxxxxx",
            docUrl: "https://platform.openai.com",
        },
        {
            id: "doubao",
            name: "豆包 (字节)",
            url: "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
            model: "doubao-lite-128k",
            keyHint: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
            docUrl: "https://console.volcengine.com/ark",
        },
        {
            id: "custom",
            name: "自定义 API",
            url: "",
            model: "",
            keyHint: "输入你的 API Key",
            docUrl: "",
        },
    ];

    var currentProviderId = GM_getValue("zhs_provider_id", "deepseek");
    var currentProvider = PROVIDERS.find(function (p) { return p.id === currentProviderId; }) || PROVIDERS[0];

    function getProviderApiKey() {
        var key = GM_getValue("zhs_apikey_" + currentProviderId, "");
        // 兼容旧版只存了 deepseek 的 key
        if (!key && currentProviderId === "deepseek") {
            key = GM_getValue("deepseek_api_key", "");
        }
        return key;
    }

    var apiKeyInputEl = null;

    function getEffectiveApiKey() {
        if (apiKeyInputEl && apiKeyInputEl.value.trim()) {
            return apiKeyInputEl.value.trim();
        }
        return getProviderApiKey();
    }

    function getEffectiveApiUrl() {
        if (currentProviderId === "custom") {
            var url = GM_getValue("zhs_custom_url", "");
            return url || (apiKeyInputEl && apiKeyInputEl.dataset.customUrl) || "";
        }
        return currentProvider.url;
    }

    function getEffectiveModel() {
        if (currentProviderId === "custom") {
            return GM_getValue("zhs_custom_model", "gpt-3.5-turbo");
        }
        return currentProvider.model;
    }

    var CONFIG = {
        minDelay: 3000,
        maxDelay: 7000,
        maxRetries: 3,
    };

    // ==================== 反检测 Hook ====================
    function hookAntiDetection() {
        var win = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;

        var oldSetInterval = win.setInterval;
        var oldSetTimeout = win.setTimeout;

        win.setInterval = function () {
            var fnStr = String(arguments[0]);
            if (fnStr.indexOf("checkoutNotTrustScript") !== -1 ||
                fnStr.indexOf("ondevtoolclose") !== -1) {
                return -1;
            }
            return oldSetInterval.apply(this, arguments);
        };

        win.setTimeout = function () {
            var fnStr = String(arguments[0]);
            if (fnStr.indexOf("checkoutNotTrustScript") !== -1 ||
                fnStr.indexOf("ondevtoolclose") !== -1) {
                return -1;
            }
            return oldSetTimeout.apply(this, arguments);
        };

        var oldAddEvt = win.addEventListener;
        win.addEventListener = function (type) {
            if (type === "blur" || type === "focusout") return;
            return oldAddEvt.apply(this, arguments);
        };

        var oldDocAddEvt = win.document.addEventListener;
        win.document.addEventListener = function (type) {
            if (type === "mouseleave") return;
            return oldDocAddEvt.apply(this, arguments);
        };

        setTimeout(function () { win.onblur = null; }, 3000);
    }

    hookAntiDetection();

    // ==================== Vue Hook（兼容新版 & 旧版） ====================
    var win = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;

    function hookWebpackVue25() {
        if (win.__zhs_vue_webpack__) return;
        win.__zhs_vue_webpack__ = true;

        var originCall = Function.prototype.call;
        Function.prototype.call = function () {
            var result = originCall.apply(this, arguments);
            try {
                var v = arguments[1] && arguments[1].exports && arguments[1].exports.a;
                if (v && v.version === "2.5.0" && v.install) {
                    var origInstall = v.install;
                    v.install = function (Vue) {
                        var args = Array.prototype.slice.call(arguments, 1);
                        Vue.mixin({
                            mounted: function () { this.$el.__Ivue__ = this; }
                        });
                        return origInstall.apply(this, [Vue].concat(args));
                    };
                }
            } catch (e) {}
            return result;
        };
    }

    function hookVueMixin252() {
        if (win.__zhs_vue_mixin__) return;
        win.__zhs_vue_mixin__ = true;
        if (!win.VueHookList) win.VueHookList = [];

        var originCall = Function.prototype.call;
        Function.prototype.call = function () {
            var result = originCall.apply(this, arguments);
            try {
                var v = arguments[2] && arguments[2].default;
                if (v && v.version === "2.5.2" && v.mixin) {
                    v.mixin({
                        mounted: function () {
                            this.$el.VueHook = this;
                            if (win.VueHookList.indexOf(this) === -1) {
                                win.VueHookList.push(this);
                            }
                        }
                    });
                }
            } catch (e) {}
            return result;
        };
    }

    hookWebpackVue25();
    hookVueMixin252();

    // ==================== UI 面板样式 ====================
    GM_addStyle([
        "#zhs-deepseek-panel{",
        "position:fixed;top:10px;right:10px;z-index:99999;width:360px;",
        "background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);",
        "border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.4);color:#e0e0e0;",
        "font-family:'Microsoft YaHei','PingFang SC',sans-serif;font-size:13px;",
        "border:1px solid #2a2a4a;}",
        "#zhs-deepseek-panel .ph{padding:12px 16px;background:rgba(255,255,255,.05);",
        "border-radius:12px 12px 0 0;display:flex;justify-content:space-between;",
        "align-items:center;cursor:move;border-bottom:1px solid #2a2a4a;}",
        "#zhs-deepseek-panel .pt{font-weight:bold;font-size:14px;color:#64b5f6;}",
        "#zhs-deepseek-panel .ptg{cursor:pointer;font-size:18px;color:#888;}",
        "#zhs-deepseek-panel .ptg:hover{color:#fff;}",
        "#zhs-deepseek-panel .pb{padding:12px 16px;display:flex;flex-direction:column;gap:8px;}",
        "#zhs-deepseek-panel .pb.hide{display:none;}",
        "#zhs-deepseek-panel input[type=text]{width:100%;padding:8px 10px;",
        "border:1px solid #3a3a5a;border-radius:6px;background:#0f0f23;color:#e0e0e0;",
        "font-size:12px;box-sizing:border-box;outline:none;}",
        "#zhs-deepseek-panel input[type=text]:focus{border-color:#64b5f6;}",
        "#zhs-deepseek-panel .btn{padding:8px 16px;border:none;border-radius:6px;",
        "cursor:pointer;font-size:13px;font-weight:bold;width:100%;}",
        "#zhs-deepseek-panel .btn-start{background:linear-gradient(135deg,#43a047,#66bb6a);color:#fff;}",
        "#zhs-deepseek-panel .btn-start:hover{box-shadow:0 4px 12px rgba(67,160,71,.4);}",
        "#zhs-deepseek-panel .btn-start:disabled{background:#555;cursor:not-allowed;box-shadow:none;}",
        "#zhs-deepseek-panel .btn-stop{background:linear-gradient(135deg,#e53935,#ef5350);color:#fff;}",
        "#zhs-deepseek-panel .btn-stop:hover{box-shadow:0 4px 12px rgba(229,57,53,.4);}",
        "#zhs-deepseek-panel .btn-save{background:#3a3a5a;color:#ccc;font-size:11px;",
        "padding:4px 10px;width:auto;border-radius:4px;}",
        "#zhs-deepseek-panel .btn-save:hover{background:#4a4a6a;}",
        "#zhs-deepseek-panel .log-area{max-height:150px;overflow-y:auto;background:#0f0f23;",
        "border-radius:6px;padding:8px 10px;font-size:11px;line-height:1.6;",
        "font-family:Consolas,monospace;border:1px solid #2a2a4a;}",
        "#zhs-deepseek-panel .log-area::-webkit-scrollbar{width:4px;}",
        "#zhs-deepseek-panel .log-area::-webkit-scrollbar-thumb{background:#3a3a5a;border-radius:2px;}",
        "#zhs-deepseek-panel .log-item{padding:2px 0;border-bottom:1px solid rgba(255,255,255,.03);}",
        "#zhs-deepseek-panel .log-i{color:#64b5f6;}",
        "#zhs-deepseek-panel .log-s{color:#66bb6a;}",
        "#zhs-deepseek-panel .log-w{color:#ffa726;}",
        "#zhs-deepseek-panel .log-e{color:#ef5350;}",
        "#zhs-deepseek-panel .log-h{color:#ce93d8;}",
        "#zhs-deepseek-panel .st{display:flex;align-items:center;gap:6px;font-size:11px;color:#888;}",
        "#zhs-deepseek-panel .st-dot{width:8px;height:8px;border-radius:50%;background:#555;display:inline-block;}",
        "#zhs-deepseek-panel .st-dot.run{background:#66bb6a;animation:z-pulse 1.5s infinite;}",
        "@keyframes z-pulse{0%,100%{opacity:1}50%{opacity:.3}}",
        "#zhs-deepseek-panel select{appearance:none;-webkit-appearance:none;padding:6px 8px;",
        "border:1px solid #3a3a5a;border-radius:6px;background:#0f0f23;color:#e0e0e0;",
        "font-size:12px;outline:none;cursor:pointer;flex:1;}",
        "#zhs-deepseek-panel select:focus{border-color:#64b5f6;}",
        "#zhs-deepseek-panel a#z-doc-link{cursor:pointer;}",
        "#zhs-deepseek-panel a#z-doc-link:hover{color:#90caf9;}",
    ].join(""));

    // ==================== 日志系统 ====================
    var logEl = null;

    function addLog(msg, type) {
        type = type || "i";
        console.log("[ZHS-V2] " + msg);
        if (!logEl) return;
        var div = document.createElement("div");
        div.className = "log-item log-" + type;
        var t = new Date().toLocaleTimeString();
        div.textContent = "[" + t + "] " + msg;
        logEl.appendChild(div);
        logEl.scrollTop = logEl.scrollHeight;
        if (logEl.children.length > 30) logEl.removeChild(logEl.firstChild);
    }

    // ==================== AI API 调用 ====================
    function callAI(question, options, questionType) {
        return new Promise(function (resolve, reject) {
            var apiKey = getEffectiveApiKey();
            var apiUrl = getEffectiveApiUrl();
            var model = getEffectiveModel();

            if (!apiKey) { reject(new Error("请先输入API Key")); return; }
            if (!apiUrl) { reject(new Error("API地址为空，请选择供应商或填写自定义地址")); return; }
            if (!model) { reject(new Error("模型名称为空")); return; }
            var letters = options.map(function (_, i) { return String.fromCharCode(65 + i); });
            var optText = options.map(function (opt, i) { return letters[i] + ". " + opt; }).join("\n");

            var systemPrompt = [
                "你是一个考试答题助手。请根据题目和选项，选择正确答案。",
                "",
                "重要规则：",
                "1. 仔细分析题目，从选项中选出最正确的答案",
                "2. 单选题：只返回一个答案字母，如 A",
                "3. 多选题：返回多个答案字母，用逗号分隔，如 A,C,D",
                "4. 判断题：如果是对/正确/是，返回 A；如果是错/错误/否，返回 B",
                "5. 只返回答案字母，不要有任何解释或其他文字",
                "6. 必须在给定的选项中选择，不要编造答案",
            ].join("\n");

            var userPrompt = "【题型】" + questionType + "\n【题目】" + question + "\n【选项】\n" + optText + "\n\n请给出正确答案：";

            function doRequest(retry) {
                GM_xmlhttpRequest({
                    method: "POST",
                    url: apiUrl,
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": "Bearer " + apiKey,
                    },
                    data: JSON.stringify({
                        model: model,
                        messages: [
                            { role: "system", content: systemPrompt },
                            { role: "user", content: userPrompt },
                        ],
                        temperature: 0.1,
                        max_tokens: 100,
                    }),
                    timeout: 30000,
                    onload: function (resp) {
                        var status = resp.status;
                        var rawText = resp.responseText || resp.response || "";

                        if (!rawText || rawText.length < 10) {
                            addLog("API返回空响应(length=" + rawText.length + ")，状态码=" + status, "e");
                            if (retry < CONFIG.maxRetries) {
                                addLog("第" + (retry + 1) + "次重试(" + (CONFIG.maxRetries - retry) + "次剩余)...", "w");
                                setTimeout(function () { doRequest(retry + 1); }, 2000);
                                return;
                            }
                            reject(new Error("API返回空响应"));
                            return;
                        }

                        if (rawText.charAt(0) === "<") {
                            addLog("API返回HTML页面而非JSON(可能是代理重定向)", "e");
                            var preview3 = rawText.replace(/<[^>]+>/g, "").slice(0, 200).replace(/\s+/g, " ");
                            addLog("内容: " + preview3, "e");
                            reject(new Error("API返回HTML页面"));
                            return;
                        }

                        if (status !== 200) {
                            var preview = rawText.slice(0, 200).replace(/\n/g, " ");
                            addLog("HTTP " + status + ": " + preview, "e");
                            if (status === 401) {
                                reject(new Error("API Key 无效或已过期"));
                            } else if (status === 403) {
                                reject(new Error("API Key 无权访问，请检查账户余额"));
                            } else if (status === 429) {
                                reject(new Error("请求太频繁，请稍后重试"));
                            } else {
                                reject(new Error("HTTP错误 " + status));
                            }
                            return;
                        }

                        try {
                            var data = JSON.parse(rawText);
                            if (data.choices && data.choices[0] && data.choices[0].message) {
                                var answer = data.choices[0].message.content.trim().toUpperCase();
                                resolve(answer);
                            } else if (data.error) {
                                var errMsg = data.error.message || JSON.stringify(data.error);
                                addLog("API错误: " + errMsg, "e");
                                reject(new Error(errMsg));
                            } else {
                                addLog("响应格式异常: " + rawText.slice(0, 300), "e");
                                reject(new Error("未知响应格式"));
                            }
                        } catch (e) {
                            var preview2 = rawText.slice(0, 300).replace(/\n/g, " ");
                            addLog("JSON解析失败: " + preview2, "e");
                            addLog("完整响应长度: " + rawText.length + " 字符", "i");
                            reject(new Error("解析响应失败: " + e.message));
                        }
                    },
                    onerror: function (err) {
                        addLog("网络请求错误", "e");
                        if (retry < CONFIG.maxRetries) {
                            addLog("第" + (retry + 1) + "次重试(" + (CONFIG.maxRetries - retry) + "次剩余)...", "w");
                            setTimeout(function () { doRequest(retry + 1); }, 2000);
                        } else {
                            reject(new Error("网络请求失败，已重试" + CONFIG.maxRetries + "次"));
                        }
                    },
                    ontimeout: function () {
                        addLog("请求超时(30s)", "e");
                        if (retry < CONFIG.maxRetries) {
                            addLog("第" + (retry + 1) + "次重试(" + (CONFIG.maxRetries - retry) + "次剩余)...", "w");
                            setTimeout(function () { doRequest(retry + 1); }, 2000);
                        } else {
                            reject(new Error("请求超时，已重试" + CONFIG.maxRetries + "次"));
                        }
                    },
                });
            }
            doRequest(0);
        });
    }

    // ==================== 答案解析 ====================
    function parseAnswer(aiAnswer, optionCount, questionType) {
        var clean = aiAnswer.replace(/[^A-Da-d,]/g, "");
        var parts = clean.split(",").filter(function (s) { return s.trim(); })
            .map(function (s) { return s.trim().toUpperCase(); });

        var valid = parts.filter(function (ch) {
            var code = ch.charCodeAt(0);
            return code >= 65 && code < 65 + optionCount;
        });

        if (valid.length === 0) {
            addLog("AI返回无法解析: \"" + aiAnswer + "\"，智能匹配...", "w");
            var first = aiAnswer.trim().charAt(0).toUpperCase();
            var code = first.charCodeAt(0);
            if (code >= 65 && code < 65 + optionCount) return [first];
            return ["A"];
        }

        if (questionType.indexOf("单选") !== -1 || questionType.indexOf("判断") !== -1) {
            return [valid[0]];
        }

        var unique = [];
        valid.forEach(function (v) {
            if (unique.indexOf(v) === -1) unique.push(v);
        });
        return unique.sort();
    }

    // ==================== 题目读取（修正版） ====================
    function readQuestionTitle(subjectEl) {
        // 方法1: 从 Vue shadowDom 读取（.subject_describe div 上的 __Ivue__）
        try {
            var descDiv = subjectEl.querySelector(".subject_describe div");
            if (descDiv && descDiv.__Ivue__ && descDiv.__Ivue__._data) {
                var sd = descDiv.__Ivue__._data.shadowDom;
                if (sd && sd.textContent && sd.textContent.trim()) {
                    return sd.textContent.trim().replace(/\s+/g, " ");
                }
            }
        } catch (e) {}

        // 方法2: 从 VueHook 读取
        try {
            if (win.VueHookList && win.VueHookList.length) {
                for (var i = 0; i < win.VueHookList.length; i++) {
                    var vh = win.VueHookList[i];
                    try {
                        var el = vh.$el;
                        if (el && subjectEl.contains(el) &&
                            el.querySelector(".subject_describe")) {
                            if (vh.$data && vh.$data.shadowDom && vh.$data.shadowDom.textContent) {
                                var txt = vh.$data.shadowDom.textContent.trim();
                                if (txt) return txt.replace(/\s+/g, " ");
                            }
                        }
                    } catch (e2) {}
                }
            }
        } catch (e) {}

        // 方法3: 从 .subject_stem 提取题目文本
        try {
            var stem = subjectEl.querySelector(".subject_stem");
            if (stem) {
                var stemText = stem.textContent || "";
                // .subject_stem 格式: "1. 【单选题】 (2分)" 或 "1. 【单选题】 (2分) 题目文本"
                // 尝试去掉题号+类型前缀
                var cleaned = stemText.replace(/^\d+\.\s*【[^】]+】\s*\(\d+分\)\s*/, "").trim();
                if (cleaned && cleaned.length > 3) {
                    return cleaned.replace(/\s+/g, " ");
                }
            }
        } catch (e) {}

        // 方法4: 遍历 .subject_describe 的所有子元素，从 Vue 实例读取
        try {
            var desc = subjectEl.querySelector(".subject_describe");
            if (desc) {
                var children = desc.querySelectorAll("*");
                for (var j = 0; j < children.length; j++) {
                    var c = children[j];
                    try {
                        if (c.__Ivue__ && c.__Ivue__._data && c.__Ivue__._data.shadowDom) {
                            var t = c.__Ivue__._data.shadowDom.textContent;
                            if (t && t.trim()) return t.trim().replace(/\s+/g, " ");
                        }
                    } catch (e2) {}
                    try {
                        if (c.VueHook && c.VueHook.$data && c.VueHook.$data.shadowDom) {
                            var t2 = c.VueHook.$data.shadowDom.textContent;
                            if (t2 && t2.trim()) return t2.trim().replace(/\s+/g, " ");
                        }
                    } catch (e3) {}
                }
            }
        } catch (e) {}

        return "";
    }

    function readQuestionType(subjectEl) {
        try {
            var typeEl = subjectEl.querySelector(".subject_type span");
            if (typeEl) {
                var raw = typeEl.textContent || "";
                // "【单选题】 (2分)" -> "单选题"
                var m = raw.match(/【(.+?)】/);
                if (m) return m[1];
                return raw.slice(1, 4) || raw;
            }
        } catch (e) {}
        try {
            var stem = subjectEl.querySelector(".subject_stem");
            if (stem) {
                var t = (stem.textContent || "");
                var m2 = t.match(/【(.+?)】/);
                if (m2) return m2[1];
            }
        } catch (e) {}
        return "单选题";
    }

    function readOptions(subjectEl) {
        var optionEls = subjectEl.querySelectorAll(".label");
        var options = [];
        optionEls.forEach(function (optEl) {
            var detail = optEl.querySelector(".node_detail");
            var text = detail ? (detail.textContent || "").trim() : (optEl.textContent || "").trim();
            options.push({ text: text, element: optEl });
        });
        return options;
    }

    function findCurrentSubject() {
        var subjects = document.querySelectorAll(".examPaper_subject");
        if (!subjects || subjects.length === 0) return null;

        // 找到第一个可见的（display != none，且高度 > 0）
        for (var i = 0; i < subjects.length; i++) {
            var el = subjects[i];
            var style = window.getComputedStyle(el);
            if (style.display !== "none" && el.offsetHeight > 0) {
                return { element: el, index: i };
            }
        }

        // fallback：逐个检查 offsetParent
        for (i = 0; i < subjects.length; i++) {
            var el2 = subjects[i];
            if (el2.offsetParent !== null && el2.offsetHeight > 0) {
                return { element: el2, index: i };
            }
        }

        // 最后兜底
        return { element: subjects[0], index: 0 };
    }

    function readCurrentQuestion() {
        var result = findCurrentSubject();
        if (!result) return null;

        var subjectEl = result.element;
        var questionTitle = readQuestionTitle(subjectEl);

        if (!questionTitle) {
            return null;
        }

        var questionType = readQuestionType(subjectEl);
        var options = readOptions(subjectEl);

        if (options.length === 0) {
            addLog("未找到选项元素", "w");
            return null;
        }

        addLog("题目(" + (result.index + 1) + "/60): " + questionTitle.slice(0, 50), "i");
        addLog("类型: " + questionType + " | 选项数: " + options.length, "i");

        return {
            title: questionTitle,
            type: questionType,
            options: options,
            subjectElement: subjectEl,
            questionIndex: result.index,
        };
    }

    function getQuestionProgress() {
        var subjects = document.querySelectorAll(".examPaper_subject");
        var current = findCurrentSubject();
        if (!current) return "?/?" + "条";
        return (current.index + 1) + "/" + subjects.length;
    }

    function checkExamFinished() {
        var switchers = document.querySelectorAll(".switch-btn-box > button");
        if (switchers.length < 2) return true;
        var nextBtn = switchers[1];
        if (nextBtn.disabled || nextBtn.classList.contains("disabled")) return true;
        var style = window.getComputedStyle(nextBtn);
        return style.display === "none" || style.visibility === "hidden";
    }

    function clickOption(el) {
        try {
            el.click();
            // 派发额外事件确保 Vue 能响应
            try {
                el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
                el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
            } catch (e2) {}
            return true;
        } catch (e) {
            addLog("点击选项失败: " + e.message, "e"); return false;
        }
    }

    function clickNext() {
        var switchers = document.querySelectorAll(".switch-btn-box > button");
        if (switchers.length >= 2) { switchers[1].click(); return true; }
        return false;
    }

    function randDelay() {
        return CONFIG.minDelay + Math.random() * (CONFIG.maxDelay - CONFIG.minDelay);
    }

    function sleep(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    function waitForQuestion(timeout) {
        timeout = timeout || 20000;
        return new Promise(function (resolve) {
            var start = Date.now();
            function check() {
                var q = readCurrentQuestion();
                if (q && q.title) { resolve(q); return; }
                if (Date.now() - start > timeout) {
                    addLog("等待题目超时(" + (timeout / 1000) + "s)", "e");
                    resolve(null);
                    return;
                }
                setTimeout(check, 800);
            }
            check();
        });
    }

    // ==================== 主流程 ====================
    var running = false;
    var stopRequested = false;
    var qCount = 0, okCount = 0, ngCount = 0;

    function updatePanelStatus(active) {
        var dot = document.getElementById("z-dot");
        var txt = document.getElementById("z-status");
        var progress = getQuestionProgress();
        if (dot) dot.className = "st-dot" + (active ? " run" : "");
        if (txt) txt.textContent = active
            ? "运行中 | " + progress + " | 成功:" + okCount + " | 失败:" + ngCount
            : "已停止 | " + progress + " | 成功:" + okCount + " | 失败:" + ngCount;
    }

    async function startExam() {
        if (running) return;
        running = true;
        stopRequested = false;
        qCount = 0; okCount = 0; ngCount = 0;

        document.getElementById("z-start").style.display = "none";
        document.getElementById("z-stop").style.display = "block";
        updatePanelStatus(true);

        addLog("========================================", "h");
        addLog("开始自动答题", "h");
        addLog("API: " + currentProvider.name + " | Key: " + getEffectiveApiKey().slice(0, 8) + "...", "i");

        while (running && !stopRequested) {
            if (checkExamFinished()) {
                addLog("考试已结束或没有更多题目！", "s");
                break;
            }

            addLog("正在读取题目...", "i");
            var question = await waitForQuestion(20000);
            if (!question) {
                if (checkExamFinished()) {
                    addLog("考试已结束！", "s");
                    break;
                }
                addLog("读取失败，5秒后重试...", "e");
                await sleep(5000);
                continue;
            }

            qCount++;

            try {
                var optTexts = question.options.map(function (o) { return o.text; });
                addLog("调用 " + currentProvider.name + "...", "i");
                var aiAnswer = await callAI(question.title, optTexts, question.type);
                var answers = parseAnswer(aiAnswer, optTexts.length, question.type);

                addLog("AI答案: " + answers.join(", "), "h");

                var allOk = true;
                answers.forEach(function (letter) {
                    var idx = letter.charCodeAt(0) - 65;
                    if (idx >= 0 && idx < question.options.length) {
                        if (clickOption(question.options[idx].element)) {
                            addLog("已选择: " + letter + " - " + optTexts[idx].slice(0, 30), "s");
                        } else {
                            allOk = false;
                        }
                    } else {
                        addLog("答案 " + letter + " 超出选项范围(" + question.options.length + ")", "w");
                    }
                });

                if (allOk) okCount++;
                else { ngCount++; }
            } catch (e) {
                ngCount++;
                addLog("答题出错: " + e.message, "e");
            }

            updatePanelStatus(true);

            // 等待选项点击生效（Vue 更新内部状态需要时间）
            await sleep(800);

            var delay = randDelay();
            addLog("等待 " + (delay / 1000).toFixed(1) + "s...", "i");
            await sleep(delay);
            if (stopRequested) break;

            if (!clickNext()) {
                if (checkExamFinished()) {
                    addLog("所有题目已完成！", "s");
                } else {
                    addLog("找不到下一题按钮", "w");
                }
                break;
            }
            addLog("已跳转到下一题", "i");
            await sleep(1200);
        }

        running = false;
        updatePanelStatus(false);
        document.getElementById("z-start").style.display = "block";
        document.getElementById("z-stop").style.display = "none";
        addLog("========================================", "h");
        addLog("答题结束！共" + qCount + "题 | 成功:" + okCount + " | 失败:" + ngCount, "h");
    }

    function stopExam() {
        stopRequested = true;
        addLog("正在停止...", "w");
    }

    // ==================== UI 面板 ====================
    function buildPanel() {
        var panel = document.createElement("div");
        panel.id = "zhs-deepseek-panel";
        panel.innerHTML = [
            '<div class="ph" id="z-drag-handle">',
            '<span class="pt">答题助手 v3</span>',
            '<span class="ptg" id="z-toggle">\u2212</span>',
            '</div>',
            '<div class="pb" id="z-body">',
            '<div class="z-api-section" id="z-custom-fields" style="display:none;">',
            '<div style="font-size:11px;color:#888;">API 地址</div>',
            '<input type="text" id="z-custom-url" placeholder="https://api.example.com/v1/chat/completions">',
            '<div style="font-size:11px;color:#888;margin-top:4px;">模型名称</div>',
            '<input type="text" id="z-custom-model" placeholder="gpt-3.5-turbo">',
            '</div>',
            '<div style="font-size:11px;color:#888;">API Key</div>',
            '<div style="display:flex;gap:6px;">',
            '<input type="text" id="z-api-key" style="flex:1;">',
            '<button class="btn btn-save" id="z-save-key">保存</button>',
            '</div>',
            '<button class="btn btn-start" id="z-start" disabled>开始自动答题</button>',
            '<button class="btn btn-stop" id="z-stop" style="display:none;">停止答题</button>',
            '<div style="display:flex;gap:4px;">',
            '<button class="btn btn-save" id="z-test-api" style="flex:1;font-size:10px;padding:4px 8px;border-radius:4px;">测试连接</button>',
            '<button class="btn btn-save" id="z-copy-log" style="flex:1;font-size:10px;padding:4px 8px;border-radius:4px;">复制日志</button>',
            '</div>',
            '<div class="st">',
            '<span class="st-dot" id="z-dot"></span>',
            '<span id="z-status">就绪</span>',
            '</div>',
            '<div class="log-area" id="z-log">',
            '<div class="log-item log-i">等待页面加载...</div>',
            '</div>',
            '</div>',
        ].join("");
        document.body.appendChild(panel);

        // 插入供应商选择器
        var body = panel.querySelector("#z-body");
        var selContainer = document.createElement("div");
        selContainer.style.cssText = "display:flex;gap:4px;align-items:center;";
        selContainer.innerHTML = [
            '<select id="z-provider" style="flex:1;padding:6px 8px;border:1px solid #3a3a5a;border-radius:6px;',
            'background:#0f0f23;color:#e0e0e0;font-size:12px;outline:none;cursor:pointer;">',
            PROVIDERS.map(function (p) {
                var sel = p.id === currentProviderId ? " selected" : "";
                return '<option value="' + p.id + '"' + sel + '>' + p.name + '</option>';
            }).join(""),
            '</select>',
            '<a id="z-doc-link" style="font-size:10px;color:#64b5f6;text-decoration:none;white-space:nowrap;" target="_blank">获取Key</a>',
        ].join("");
        body.insertBefore(selContainer, body.querySelector("#z-custom-fields"));

        var handle = panel.querySelector("#z-drag-handle");
        var toggle = panel.querySelector("#z-toggle");
        var dragging = false, ox = 0, oy = 0;

        handle.addEventListener("mousedown", function (e) {
            if (e.target === toggle) return;
            dragging = true;
            ox = e.clientX - panel.offsetLeft;
            oy = e.clientY - panel.offsetTop;
            handle.style.cursor = "grabbing";
        });
        document.addEventListener("mousemove", function (e) {
            if (!dragging) return;
            panel.style.left = (e.clientX - ox) + "px";
            panel.style.top = (e.clientY - oy) + "px";
            panel.style.right = "auto";
        });
        document.addEventListener("mouseup", function () {
            dragging = false;
            handle.style.cursor = "move";
        });

        toggle.addEventListener("click", function () {
            var hide = body.classList.toggle("hide");
            toggle.textContent = hide ? "+" : "\u2212";
        });

        return panel;
    }

    // ==================== 入口 ====================
    function waitForDOM() {
        return new Promise(function (resolve) {
            if (document.body && document.querySelector(".examPaper_subject")) {
                resolve();
                return;
            }
            var iv = setInterval(function () {
                if (document.body && document.querySelector(".examPaper_subject")) {
                    clearInterval(iv);
                    resolve();
                }
            }, 500);
            setTimeout(function () {
                clearInterval(iv);
                resolve();
            }, 30000);
        });
    }

    function switchProvider(newId) {
        var newProv = PROVIDERS.find(function (p) { return p.id === newId; });
        if (!newProv) return;

        currentProviderId = newId;
        currentProvider = newProv;
        GM_setValue("zhs_provider_id", newId);

        apiKeyInputEl.value = getProviderApiKey();
        apiKeyInputEl.placeholder = newProv.keyHint;

        var docLink = document.getElementById("z-doc-link");
        if (docLink) {
            if (newProv.docUrl) {
                docLink.href = newProv.docUrl;
                docLink.textContent = "获取Key";
                docLink.style.display = "";
            } else {
                docLink.style.display = "none";
            }
        }

        var customFields = document.getElementById("z-custom-fields");
        if (newId === "custom") {
            customFields.style.display = "block";
            document.getElementById("z-custom-url").value = GM_getValue("zhs_custom_url", "");
            document.getElementById("z-custom-model").value = GM_getValue("zhs_custom_model", "");
        } else {
            customFields.style.display = "none";
            GM_setValue("zhs_custom_url", "");
            GM_setValue("zhs_custom_model", "");
        }

        var startBtn = document.getElementById("z-start");
        var hasKey = getEffectiveApiKey();
        startBtn.disabled = !hasKey;
    }

    function updateStartButton() {
        var startBtn = document.getElementById("z-start");
        var key = apiKeyInputEl.value.trim();
        startBtn.disabled = !key;
    }

    async function init() {
        addLog("等待 DOM 渲染...", "i");
        await waitForDOM();

        buildPanel();
        logEl = document.getElementById("z-log");

        addLog("========================================", "h");
        addLog("答题助手 v3 已就绪 | 供应商: " + currentProvider.name, "h");

        var hasSubjects = document.querySelectorAll(".examPaper_subject").length > 0;
        if (!hasSubjects) {
            addLog("未检测到 .examPaper_subject，可能不是考试页面", "w");
            addLog("请进入考试页面后刷新", "w");
            return;
        }
        addLog("检测到 " + hasSubjects + " 个题目", "s");

        apiKeyInputEl = document.getElementById("z-api-key");
        apiKeyInputEl.placeholder = currentProvider.keyHint;

        var savedKey = getProviderApiKey();
        if (savedKey) {
            apiKeyInputEl.value = savedKey;
            addLog("已加载 " + currentProvider.name + " 的 API Key", "s");
        } else if (currentProviderId === "deepseek") {
            var oldKey = GM_getValue("deepseek_api_key", "");
            if (oldKey) {
                apiKeyInputEl.value = oldKey;
                GM_setValue("zhs_apikey_deepseek", oldKey);
            }
        }

        document.getElementById("z-save-key").addEventListener("click", function () {
            var key = apiKeyInputEl.value.trim();
            if (!key) {
                addLog("API Key 不能为空", "e");
                return;
            }
            GM_setValue("zhs_apikey_" + currentProviderId, key);
            if (currentProviderId === "custom") {
                var customUrl = document.getElementById("z-custom-url").value.trim();
                var customModel = document.getElementById("z-custom-model").value.trim();
                GM_setValue("zhs_custom_url", customUrl);
                GM_setValue("zhs_custom_model", customModel);
            }
            addLog("API Key 已保存 (" + currentProvider.name + "): " + key.slice(0, 10) + "...", "s");
            updateStartButton();
        });

        apiKeyInputEl.addEventListener("input", updateStartButton);

        document.getElementById("z-provider").addEventListener("change", function () {
            switchProvider(this.value);
        });

        updateStartButton();
        document.getElementById("z-start").addEventListener("click", startExam);
        document.getElementById("z-stop").addEventListener("click", stopExam);

        document.getElementById("z-copy-log").addEventListener("click", function () {
            var text = "";
            var items = logEl.querySelectorAll(".log-item");
            items.forEach(function (item) { text += item.textContent + "\n"; });
            if (!text) { addLog("日志为空", "w"); return; }
            try {
                GM_setClipboard(text, "text");
                addLog("日志已复制到剪贴板！", "s");
            } catch (e) {
                try {
                    navigator.clipboard.writeText(text).then(function () {
                        addLog("日志已复制！", "s");
                    });
                } catch (e2) {
                    addLog("复制失败，请手动选中日志复制", "w");
                }
            }
        });

        document.getElementById("z-test-api").addEventListener("click", function () {
            var key = getEffectiveApiKey();
            var testUrl = getEffectiveApiUrl();
            var testModel = getEffectiveModel();

            if (!key) { addLog("请先输入 API Key", "e"); return; }
            if (!testUrl) { addLog("API 地址为空", "e"); return; }
            if (!testModel) { addLog("模型名称为空", "e"); return; }

            addLog("测试 " + currentProvider.name + " 连接...", "i");
            GM_xmlhttpRequest({
                method: "POST",
                url: testUrl,
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer " + key,
                },
                data: JSON.stringify({
                    model: testModel,
                    messages: [{ role: "user", content: "Hi" }],
                    max_tokens: 5,
                }),
                timeout: 15000,
                onload: function (resp) {
                    var s = resp.status;
                    var fullText = resp.responseText || "";
                    addLog("HTTP " + s + " | 长度: " + fullText.length, "i");
                    if (s === 200) {
                        try {
                            var d = JSON.parse(fullText);
                            if (d.choices && d.choices[0]) {
                                addLog(currentProvider.name + " 连接成功！模型: " + (d.model || testModel), "s");
                            } else if (d.error) {
                                addLog("API错误: " + JSON.stringify(d.error).slice(0, 200), "e");
                            } else {
                                addLog("响应异常: " + fullText.slice(0, 200), "w");
                            }
                        } catch (e) {
                            addLog("JSON解析失败: " + fullText.slice(0, 200), "e");
                        }
                    } else if (s === 401) {
                        addLog("API Key 无效 (401)", "e");
                    } else if (s === 403) {
                        addLog("访问被拒 (403)，检查余额或权限", "e");
                    } else {
                        addLog("HTTP " + s + ": " + fullText.slice(0, 200), "e");
                    }
                },
                onerror: function () {
                    addLog("网络连接失败，检查防火墙或 API 地址", "e");
                },
                ontimeout: function () {
                    addLog("连接超时", "e");
                },
            });
        });

        if (getEffectiveApiKey()) {
            addLog("已加载 " + currentProvider.name + " API Key", "s");
        } else {
            addLog("请选择 AI 供应商并输入 API Key", "w");
        }

        // 等待 Vue 实例挂载
        addLog("等待 Vue 组件挂载...", "i");
        var vueReady = false;
        var waitStart = Date.now();
        var vueCheck = setInterval(function () {
            var subjects = document.querySelectorAll(".examPaper_subject");
            if (subjects.length > 0) {
                var question = readCurrentQuestion();
                if (question && question.title) {
                    vueReady = true;
                    clearInterval(vueCheck);
                    addLog("Vue 组件已挂载，可以开始答题！", "s");
                    document.getElementById("z-status").textContent = "就绪 - 可点击开始答题";
                }
            }
            if (Date.now() - waitStart > 45000) {
                clearInterval(vueCheck);
                if (!vueReady) {
                    addLog("Vue 挂载超时(45s)，请确认是否在考试页面", "e");
                    addLog("如果题目能正常显示请直接点击开始", "w");
                    document.getElementById("z-status").textContent = "就绪（Vue挂载超时，但仍可尝试）";
                }
            }
        }, 1000);
    }

    if (document.readyState === "complete") {
        init();
    } else {
        window.addEventListener("load", function () {
            setTimeout(init, 1000);
        });
    }

})();
